/**
 * POST /api/deals/[dealId]/proximo-funil — automação "ao ganhar, o card muda de funil".
 *
 * MOVE o MESMO card (não copia). Até 26/08/2026 a automação chamava `dealsService.create` e
 * criava um card NOVO no destino: as atividades, notas e a conversa de WhatsApp continuavam
 * presas ao card antigo e a Implantação recebia card EM BRANCO (Richard Gois: 0 itens de
 * timeline contra 3 no original; Mavie Ramunno: 1 contra 4). Movendo o mesmo deal, o histórico
 * viaja junto e o card deixa de existir em dois lugares — "não tem como o mesmo card estar
 * aberto em vários funis" (Thalita, 26/08).
 *
 * POR QUE ROTA DE SERVIDOR E NÃO UM UPDATE PELO CLIENTE (migração
 * 20260824210000_acesso_por_funil.sql):
 * - `boards_select` = `pode_ver_board(id)`. O Pedro (vendedor) só tem `board_access` do
 *   'Comercial — Consultor', então ler o funil 'Implantação — ADM' pelo cliente devolve NULL e a
 *   automação abortaria, deixando o card preso no Comercial marcado como ganho.
 * - `deals_update` tem WITH CHECK `pode_ver_board(NEW.board_id) and (...)`, avaliado na LINHA
 *   NOVA: mesmo que o funil de destino fosse legível, o UPDATE que joga o card para lá seria
 *   REJEITADO pela RLS.
 * Por isso: a permissão é conferida com o cliente DO USUÁRIO (conseguir LER o deal já prova, pela
 * RLS, que ele enxerga o funil de ORIGEM) e só depois disso a escrita usa service role.
 *
 * "Cada funil vai ser um dono diferente; assim que é dado como ganho, o time de implantação é o
 * novo responsável" (Thalita, 26/08) — daí o `owner_id` passar para o `responsavel_user_id` do
 * funil de destino, e daí o CARIMBO da venda, que congela quem vendeu ANTES da troca de dono
 * ("quando o card for pra implantação já tem que identificar quem fez a venda, para termos essas
 * métricas nos relatórios").
 *
 * A ROTA NÃO LÊ NADA DO CORPO DA REQUISIÇÃO: quem responde "esse card acabou de ser ganho?" é o
 * BANCO. Como um POST repetido (clique duplo, retry, chamada solta) cairia de novo aqui, existe o
 * guard da etapa de ganho — sem ele a segunda chamada leria o `next_board_id` do DESTINO e
 * empurraria o card da Implantação para Clientes Ativos sem ninguém ter pedido.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

export const maxDuration = 30;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Etapas que disparam a automação SEM ser venda (promoção de lead) — mesma lista do
 * `useMoveDeal`, que é quem chama esta rota.
 */
const ETAPAS_DE_PROMOCAO = ['MQL', 'SALES_QUALIFIED'];

/** Contrato fixo de `deals.custom_fields.venda` (já existe em produção nos cards recuperados). */
interface CarimboVenda {
  vendedor_id: string | null;
  vendedor_nome: string | null;
  vendido_em: string;
  board_id_da_venda: string;
  funil_da_venda: string;
  etapa_da_venda: string;
  valor_na_venda: number;
}

interface DealRow {
  id: string;
  board_id: string | null;
  stage_id: string | null;
  owner_id: string | null;
  value: number | null;
  is_won: boolean | null;
  custom_fields: Record<string, unknown> | null;
  organization_id: string | null;
  contact_id: string | null;
}

interface BoardRow {
  id: string;
  name: string | null;
  next_board_id: string | null;
}

interface StageRow {
  id: string;
  name: string | null;
  label: string | null;
  linked_lifecycle_stage: string | null;
}

interface PerfilRow {
  id: string;
  name: string | null;
  nickname: string | null;
  first_name: string | null;
  role: string | null;
  ve_todos_os_leads: boolean | null;
}

/** Mesma ordem de preferência do dropdown do time e da rota `/api/deals/[dealId]/owner`. */
const nomeDoPerfil = (p: PerfilRow | null | undefined): string | null =>
  p ? (p.nickname || p.name || p.first_name || null) : null;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Card inválido.' }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    const { data: perfilRaw } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();
    const orgId = (perfilRaw as { organization_id: string | null } | null)?.organization_id ?? null;
    if (!orgId) {
      return NextResponse.json({ error: 'Perfil sem organização. Fale com o administrador.' }, { status: 403 });
    }

    // GATE DE PERMISSÃO: ler o deal com o cliente do usuário. Passar por `deals_select` já prova
    // que ele enxerga o funil de ORIGEM (a policy exige `pode_ver_board(board_id)`). Daqui para a
    // frente é service role, porque o DESTINO é justamente o funil que ele não vê.
    const { data: dealDoUsuarioRaw, error: leituraErr } = await supabase
      .from('deals')
      .select('id, organization_id')
      .eq('id', dealId)
      .single();
    const dealDoUsuario = dealDoUsuarioRaw as { id: string; organization_id: string | null } | null;
    if (leituraErr || !dealDoUsuario) {
      return NextResponse.json({ error: 'Card não encontrado.' }, { status: 404 });
    }
    // `deals_select` NÃO filtra por organização — a conferência é NOSSA (mesmo cuidado da rota
    // `/api/deals/[dealId]/owner`), senão o service role logo abaixo escreveria em card de outra org.
    if (dealDoUsuario.organization_id !== orgId) {
      return NextResponse.json({ error: 'Card não encontrado.' }, { status: 404 });
    }

    const admin = createStaticAdminClient();

    // Leitura FRESCA: o cliente pode estar com o cache do board minutos atrasado, e é daqui que
    // sai o `custom_fields` a ser mesclado (a Ana e os crons escrevem nessa mesma coluna).
    const { data: dealRaw, error: dealErr } = await admin
      .from('deals')
      .select('id, board_id, stage_id, owner_id, value, is_won, custom_fields, organization_id, contact_id')
      .eq('id', dealId)
      .single();
    const deal = dealRaw as DealRow | null;
    if (dealErr || !deal) return NextResponse.json({ error: 'Card não encontrado.' }, { status: 404 });
    if (!deal.board_id) {
      return NextResponse.json({ movido: false, motivo: 'sem_funil_de_origem' }, { status: 200 });
    }
    // Fixa o funil de ORIGEM numa constante: ele é usado depois de vários `await` (carimbo, move,
    // nota) e é obrigatório no carimbo — deixar o compilador depender do estreitamento de
    // `deal.board_id` lá embaixo é frágil à toa.
    const boardOrigemId: string = deal.board_id;

    // ------------------------------------------------------ 1) funil de origem e o próximo dele
    const { data: origemRaw, error: origemErr } = await admin
      .from('boards')
      .select('id, name, next_board_id')
      .eq('id', boardOrigemId)
      .maybeSingle();
    if (origemErr) {
      console.error('[deals/proximo-funil] leitura do funil de origem falhou:', origemErr.message);
      return NextResponse.json({ error: 'Não foi possível ler o funil de origem do card.' }, { status: 500 });
    }
    const origem = origemRaw as BoardRow | null;
    const nextBoardId = origem?.next_board_id ?? null;
    // Sem próximo funil configurado não é erro: a maioria dos funis termina neles mesmos. Funil que
    // aponta para si mesmo cai aqui também — mover para a própria etapa de entrada seria zerar o
    // card no lugar de entregá-lo.
    if (!nextBoardId || nextBoardId === boardOrigemId) {
      return NextResponse.json({ movido: false, motivo: 'sem_proximo_funil' }, { status: 200 });
    }

    // ------------------------------------------------- 2) a etapa ATUAL do card (antes do move)
    // Serve para duas coisas: o guard logo abaixo e o nome da etapa que vai no carimbo da venda.
    let etapaAtual: StageRow | null = null;
    if (deal.stage_id) {
      const { data: etapaAtualRaw, error: etapaAtualErr } = await admin
        .from('board_stages')
        .select('id, name, label, linked_lifecycle_stage')
        .eq('id', deal.stage_id)
        .maybeSingle();
      if (etapaAtualErr) {
        console.error('[deals/proximo-funil] leitura da etapa atual falhou:', etapaAtualErr.message);
        return NextResponse.json({ error: 'Não foi possível ler a etapa atual do card.' }, { status: 500 });
      }
      etapaAtual = etapaAtualRaw as StageRow | null;
    }

    // ------------------------------------------------------------------ 3) guard de re-entrada
    // O card só sai do funil quando ACABOU de ser ganho (o `is_won` que o cliente gravou antes de
    // chamar) ou quando a etapa é de promoção de lead. Isto é o que impede o efeito cascata:
    // depois do move o card fica na etapa de ENTRADA do destino com `is_won = false`, então uma
    // segunda chamada cai aqui, vê uma etapa comum e ABSTÉM-SE. Sem o guard ela leria o
    // `next_board_id` da Implantação e empurraria o card para Clientes Ativos sozinha.
    const houveVenda = deal.is_won === true;
    const ehPromocaoDeLead = ETAPAS_DE_PROMOCAO.includes(String(etapaAtual?.linked_lifecycle_stage ?? ''));
    if (!houveVenda && !ehPromocaoDeLead) {
      // Devolve onde o card está DE VERDADE, para a tela não jogá-lo de volta no funil de origem.
      return NextResponse.json(
        { movido: false, motivo: 'nao_e_etapa_de_ganho', boardId: boardOrigemId, stageId: deal.stage_id },
        { status: 200 },
      );
    }

    // ------------------------------------------------------------------- 4) funil de destino
    const { data: destinoRaw, error: destinoErr } = await admin
      .from('boards')
      .select('id, name, deleted_at, organization_id')
      .eq('id', nextBoardId)
      .maybeSingle();
    if (destinoErr) {
      console.error('[deals/proximo-funil] leitura do funil de destino falhou:', destinoErr.message);
      return NextResponse.json({ error: 'Não foi possível abrir o funil de destino.' }, { status: 500 });
    }
    const destino = destinoRaw as
      | { id: string; name: string | null; deleted_at: string | null; organization_id: string | null }
      | null;
    if (!destino) {
      return NextResponse.json(
        { error: 'O funil de destino configurado neste funil não existe mais. Ajuste a automação em Configurações.' },
        { status: 422 },
      );
    }
    // Service role enxerga funil APAGADO e funil de outra organização — a RLS que barraria os dois
    // está desligada aqui. Mandar o card para um funil soft-deletado é sumiço garantido: a tela só
    // lista funil com `deleted_at is null`, e aí ninguém mais acha o card em lugar nenhum.
    if (destino.deleted_at || destino.organization_id !== orgId) {
      return NextResponse.json(
        {
          error: 'O funil de destino desta automação foi apagado (ou é de outra organização). '
            + 'Ajuste o próximo funil em Configurações e mova este card na mão.',
        },
        { status: 422 },
      );
    }
    const destinoNome = destino.name ?? 'o próximo funil';

    // `boards.responsavel_user_id` é lida À PARTE e em best-effort, de propósito. A migração dela
    // existe (20260826140000_boards_responsavel), mas o repo tem migrações a mais do que o banco
    // registra — e pedir a coluna no mesmo select do resto derrubaria a rota INTEIRA numa base onde
    // ela ainda não tivesse subido. Sem a coluna, o card muda de funil mantendo o dono atual: pior
    // que o ideal, muito melhor que ficar preso no funil de origem marcado como ganho.
    let responsavelDoDestino: string | null = null;
    try {
      const { data: respRaw, error: respErr } = await admin
        .from('boards')
        .select('responsavel_user_id')
        .eq('id', destino.id)
        .maybeSingle();
      if (respErr) {
        console.error('[deals/proximo-funil] responsavel_user_id indisponível (não-fatal):', respErr.message);
      } else {
        responsavelDoDestino = ((respRaw as { responsavel_user_id: string | null } | null)?.responsavel_user_id) ?? null;
      }
    } catch (err) {
      console.error('[deals/proximo-funil] responsavel_user_id indisponível (não-fatal):', err);
    }

    // ------------------------------------------------------------ 5) etapa de entrada do destino
    // Menor `"order"` (a coluna se chama `order`, palavra reservada) — mesmo critério do
    // `handoffToNextBoard` e do `useMoveDealToBoard`.
    const { data: etapasRaw, error: etapasErr } = await admin
      .from('board_stages')
      .select('id, name, label, linked_lifecycle_stage')
      .eq('board_id', destino.id)
      .order('order', { ascending: true })
      .limit(1);
    if (etapasErr) {
      console.error('[deals/proximo-funil] leitura das etapas do destino falhou:', etapasErr.message);
      return NextResponse.json({ error: `Não foi possível ler as etapas de "${destinoNome}".` }, { status: 500 });
    }
    const entryStageId = ((etapasRaw ?? []) as StageRow[])[0]?.id ?? null;
    if (!entryStageId) {
      return NextResponse.json(
        { error: `O funil "${destinoNome}" não tem nenhuma etapa. Crie a etapa de entrada antes de usar a automação.` },
        { status: 422 },
      );
    }

    const agora = new Date().toISOString();
    const novoDonoId = responsavelDoDestino ?? deal.owner_id;

    // ------------------------------------------------------ 6) os dois nomes que a nota precisa
    // Um SELECT só: quem vendeu (dono de ANTES do move, vai para o carimbo) e quem recebe o card.
    const idsDosPerfis = [deal.owner_id, novoDonoId].filter(
      (id, i, todos): id is string => typeof id === 'string' && todos.indexOf(id) === i,
    );
    let perfis: PerfilRow[] = [];
    if (idsDosPerfis.length > 0) {
      const { data: perfisRaw, error: perfisErr } = await admin
        .from('profiles')
        .select('id, name, nickname, first_name, role, ve_todos_os_leads')
        .in('id', idsDosPerfis);
      if (perfisErr) {
        // Best-effort: quem identifica de verdade no relatório é o `vendedor_id`; o nome é conforto
        // de leitura. Perder o nome não pode impedir a venda de ser carimbada.
        console.error('[deals/proximo-funil] leitura dos perfis falhou (não-fatal):', perfisErr.message);
      } else {
        perfis = (perfisRaw ?? []) as PerfilRow[];
      }
    }
    const perfilVendedor = deal.owner_id ? perfis.find((p) => p.id === deal.owner_id) ?? null : null;
    const perfilNovoDono = novoDonoId ? perfis.find((p) => p.id === novoDonoId) ?? null : null;

    // ------------------------------------------------------------------------ 7) carimbo da venda
    // MERGE a partir do banco, nunca de snapshot do cliente: o card carrega lead_form,
    // qualificacao, tier, handoff_consultor, reuniao_realizada — sobrescrever o objeto inteiro
    // apagaria o que a Ana e os crons escreveram nesse meio-tempo.
    const customFields: Record<string, unknown> = { ...(deal.custom_fields ?? {}) };

    // E NUNCA sobrescreve carimbo existente: 'Implantação — ADM' também tem etapa de ganho e
    // `next_board_id` para 'Clientes Ativos', então esta mesma automação roda de novo quando a
    // implantação conclui. Sem este guard, o segundo ganho trocaria o vendedor pelo time de
    // Implantação e apagaria exatamente a métrica que a Thalita pediu.
    const carimboExistente = customFields.venda;
    const jaTemCarimbo = typeof carimboExistente === 'object' && carimboExistente !== null;

    let venda: CarimboVenda | null = jaTemCarimbo ? (carimboExistente as CarimboVenda) : null;
    let carimboFalhou = false;

    // Só carimba em ganho DE VERDADE. A automação também dispara em promoção de lead
    // (MQL/SALES_QUALIFIED), que não é venda.
    if (houveVenda && !jaTemCarimbo) {
      // `owner_id` de ANTES do move: logo abaixo ele passa a ser o responsável do destino.
      venda = {
        vendedor_id: deal.owner_id,
        vendedor_nome: nomeDoPerfil(perfilVendedor),
        vendido_em: agora,
        board_id_da_venda: boardOrigemId,
        funil_da_venda: origem?.name ?? 'Funil',
        // Nome da etapa em que a venda foi fechada (a etapa atual do card, antes do move).
        etapa_da_venda: etapaAtual?.label || etapaAtual?.name || 'Ganho',
        valor_na_venda: deal.value ?? 0,
      };
      customFields.venda = venda;

      // Escrita própria (e não só junto do move) para que, se o move falhar — card duplicado no
      // destino, por exemplo —, o relatório ainda saiba quem fechou. Não-fatal. Seguro contra o
      // trigger de duplicidade: o deal está `is_won = true` aqui, e o trigger só olha cards abertos.
      const { error: carimboErr } = await admin
        .from('deals')
        .update({ custom_fields: customFields, updated_at: agora })
        .eq('id', dealId)
        .eq('organization_id', orgId);
      if (carimboErr) {
        carimboFalhou = true;
        console.error('[deals/proximo-funil] carimbo da venda falhou (segue o move):', carimboErr.message);
      }
    }

    // ------------------------------------------- 8) aviso: o novo dono vai enxergar o contato?
    // A posse na Niva é da PESSOA, não do card (20260822120000_multiusuario_posse_na_pessoa.sql):
    // `contacts_select` = `ve_tudo() or owner_id = auth.uid()`. Trocar só `deals.owner_id` entrega
    // um CARD OCO — o card aparece, o contato e a conversa de WhatsApp não. Hoje a Implantação é do
    // Denilson, que tem `ve_todos_os_leads`, então não dói; no dia em que entrar um implantador
    // comum, dói. Aqui só AVISA (na nota da timeline e no corpo da resposta): repassar a PESSOA
    // junto é decisão de quem administra, e já existe caminho próprio para isso
    // (`POST /api/deals/[dealId]/owner`, que move card + contato + conversas de uma vez).
    let avisoCardOco = false;
    if (deal.contact_id && novoDonoId && novoDonoId !== deal.owner_id) {
      const novoDonoVeTudo = perfilNovoDono?.role === 'admin' || perfilNovoDono?.ve_todos_os_leads === true;
      if (!novoDonoVeTudo) {
        const { data: contatoRaw, error: contatoErr } = await admin
          .from('contacts')
          .select('owner_id')
          .eq('id', deal.contact_id)
          .maybeSingle();
        if (contatoErr) {
          console.error('[deals/proximo-funil] leitura do dono do contato falhou (não-fatal):', contatoErr.message);
        } else {
          avisoCardOco = ((contatoRaw as { owner_id: string | null } | null)?.owner_id ?? null) !== novoDonoId;
        }
      }
    }

    // ------------------------------------------------------------------------------- 9) o MOVE
    const { data: movidoRaw, error: moveErr } = await admin
      .from('deals')
      .update({
        board_id: destino.id,
        stage_id: entryStageId,
        last_stage_change_date: agora,
        updated_at: agora,
        // Entra num funil novo → reabre. O ganho não se perde: fica no carimbo `venda`.
        is_won: false,
        is_lost: false,
        closed_at: null,
        custom_fields: {
          ...customFields,
          originBoardId: boardOrigemId,
          originAutomation: 'NEXT_BOARD',
        },
        owner_id: novoDonoId,
      })
      .eq('id', dealId)
      .eq('organization_id', orgId)
      .select('id');

    if (moveErr) {
      // O trigger `check_deal_duplicate` roda em INSERT **e UPDATE**: se já houver card ABERTO do
      // mesmo contato na etapa de entrada do destino, o move estoura unique_violation. Sem esta
      // tradução a operação recebia um erro cru de Postgres e não sabia o que fazer.
      const ehDuplicado =
        String(moveErr.code ?? '') === '23505' || String(moveErr.message ?? '').includes('Já existe um negócio');

      if (ehDuplicado) {
        return NextResponse.json(
          {
            movido: false,
            venda,
            carimboFalhou,
            error: `Não deu para enviar este negócio para "${destinoNome}": já existe um card aberto deste mesmo contato na etapa de entrada desse funil. Resolva o duplicado lá (feche ou mova o card antigo) e mova este na mão.`,
          },
          { status: 409 },
        );
      }

      console.error('[deals/proximo-funil] falha ao mover o card:', moveErr.message);
      return NextResponse.json(
        {
          movido: false,
          venda,
          carimboFalhou,
          error: `Não deu para enviar este negócio para "${destinoNome}": ${moveErr.message}`,
        },
        { status: 500 },
      );
    }

    // Update de 0 linhas não é erro no Postgrest: sem esta checagem a tela diria "movido" com o
    // card exatamente onde estava.
    if (((movidoRaw ?? []) as { id: string }[]).length === 0) {
      console.error('[deals/proximo-funil] o update do move não atingiu nenhuma linha:', dealId);
      return NextResponse.json(
        {
          movido: false,
          venda,
          carimboFalhou,
          error: `Não deu para enviar este negócio para "${destinoNome}".`,
        },
        { status: 500 },
      );
    }

    // --------------------------------------------------------------------------- 10) timeline
    // Best-effort: nota perdida não desfaz o move. Diz que o histórico foi JUNTO (era exatamente o
    // que se perdia na cópia) e quem foi o vendedor, porque o dono do card muda aqui.
    try {
      const creditoVenda = venda
        ? ` Venda creditada a ${venda.vendedor_nome ?? 'quem era o responsável no fechamento'}.`
        : '';
      const trocaDeDono =
        novoDonoId && novoDonoId !== deal.owner_id
          ? ` O responsável passou a ser ${nomeDoPerfil(perfilNovoDono) ?? 'o dono do funil de destino'}.`
          : '';
      const alertaOco = avisoCardOco
        ? ' ATENÇÃO: o contato e a conversa de WhatsApp seguem no nome de quem vendeu, então o novo'
          + ' responsável vê o card mas não vê o contato. Repasse a pessoa pelo botão de responsável'
          + ' do card.'
        : '';
      const alertaCarimbo = carimboFalhou
        ? ' ATENÇÃO: o carimbo da venda NÃO foi gravado — esta venda não vai aparecer na meta do mês.'
        : '';
      const { error: notaErr } = await admin.from('activities').insert({
        organization_id: orgId,
        deal_id: dealId,
        owner_id: novoDonoId,
        type: 'STATUS_CHANGE',
        title: `Movido para ${destinoNome}`,
        description: `Automação de ganho: o card saiu de "${origem?.name ?? 'funil anterior'}" levando o histórico junto (atividades, notas e conversa).${trocaDeDono}${creditoVenda}${alertaOco}${alertaCarimbo}`,
        date: agora,
        completed: true,
      });
      if (notaErr) console.error('[deals/proximo-funil] nota do move falhou (não-fatal):', notaErr.message);
    } catch (err) {
      console.error('[deals/proximo-funil] nota do move falhou (não-fatal):', err);
    }

    return NextResponse.json(
      {
        movido: true,
        boardId: destino.id,
        boardNome: destinoNome,
        stageId: entryStageId,
        ownerId: novoDonoId,
        venda,
        carimboFalhou,
        avisoCardOco,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[deals/proximo-funil]', error instanceof Error ? error.message : 'Erro desconhecido');
    return NextResponse.json({ error: 'Erro interno ao enviar o card para o próximo funil.' }, { status: 500 });
  }
}
