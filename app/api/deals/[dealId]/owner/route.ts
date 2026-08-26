/**
 * POST /api/deals/[dealId]/owner — troca o RESPONSÁVEL de um card.
 *
 * Até 26/08/2026 não havia jeito nenhum de repassar um card pela interface: a
 * Thalita procurou o controle e não achou porque ele nunca foi construído. Com
 * o Denilson recebendo todo lead novo e repassando na mão, virou bloqueio da
 * operação.
 *
 * POR QUE ROTA DE SERVIDOR E NÃO UM UPDATE PELO CLIENTE:
 * a posse na Niva é da PESSOA, não do card (migração
 * 20260822120000_multiusuario_posse_na_pessoa.sql). Trocar só `deals.owner_id`
 * entrega ao novo dono um CARD OCO — ele vê o card mas NÃO vê o contato nem a
 * conversa do WhatsApp, porque `contacts_select` é
 * `ve_tudo() or owner_id = auth.uid()` e `conversas_select` olha
 * `assigned_user_id` / `sou_dono_do_contato`. Por isso o repasse escreve em
 * TRÊS lugares: o card (deals.owner_id), a pessoa (contacts.owner_id) e a
 * conversa (messaging_conversations.assigned_user_id + assigned_at).
 *
 * QUEM PODE: só quem tem `ve_tudo()` (admin ou `ve_todos_os_leads`). Um
 * vendedor comum não conseguiria nem pela RLS — o WITH CHECK de
 * `contacts_update` é avaliado na LINHA NOVA, então ele perderia o acesso ao
 * contato no mesmo comando que tentasse repassá-lo.
 *
 * FALHA PARCIAL É VISÍVEL: contato e conversas são best-effort (não derrubam a
 * request), mas o corpo da resposta diz o que foi e o que não foi. Repasse pela
 * metade em silêncio é pior do que erro na cara.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

export const maxDuration = 30;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PerfilRow {
  id: string;
  role: string | null;
  ve_todos_os_leads: boolean | null;
  organization_id: string | null;
  name: string | null;
  nickname: string | null;
  first_name: string | null;
}

interface DealRow {
  id: string;
  contact_id: string | null;
  board_id: string | null;
  organization_id: string | null;
  owner_id: string | null;
}

/** Mesma ordem de preferência do dropdown do time (useOrgMembersQuery). */
const nomeDe = (p: PerfilRow | null | undefined): string =>
  p ? (p.nickname || p.name || p.first_name || 'Sem nome') : 'Sem dono';

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Card inválido.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { ownerId?: string | null };

  // `undefined` NÃO vale como "desatribuir": um corpo malformado tirando o dono
  // do card sem ninguém pedir é justamente o acidente que este endpoint pode
  // causar. Só `null` explícito desatribui.
  if (body.ownerId === undefined) {
    return NextResponse.json(
      { error: 'Informe o novo responsável (ou null para deixar sem dono).' },
      { status: 422 },
    );
  }
  const novoDonoId = body.ownerId;
  if (novoDonoId !== null && (typeof novoDonoId !== 'string' || !uuidRegex.test(novoDonoId))) {
    return NextResponse.json({ error: 'Responsável inválido.' }, { status: 422 });
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    const { data: quemChamaRaw } = await supabase
      .from('profiles')
      .select('id, role, ve_todos_os_leads, organization_id, name, nickname, first_name')
      .eq('id', user.id)
      .single();
    const quemChama = quemChamaRaw as PerfilRow | null;
    if (!quemChama || !quemChama.organization_id) {
      return NextResponse.json({ error: 'Perfil sem organização. Fale com o administrador.' }, { status: 403 });
    }

    // Espelha `ve_tudo()` da RLS. Consultor comum não repassa carteira.
    const veTudo = quemChama.role === 'admin' || quemChama.ve_todos_os_leads === true;
    if (!veTudo) {
      return NextResponse.json(
        { error: 'Só o administrador (ou quem enxerga a carteira do time) pode trocar o responsável de um card.' },
        { status: 403 },
      );
    }
    const orgId = quemChama.organization_id;

    // RLS é o primeiro gate; a comparação de org logo abaixo é o segundo,
    // porque daqui para a frente escrevemos com service role.
    const { data: dealRaw, error: dealErr } = await supabase
      .from('deals')
      .select('id, contact_id, board_id, organization_id, owner_id')
      .eq('id', dealId)
      .single();
    const deal = dealRaw as DealRow | null;
    if (dealErr || !deal) return NextResponse.json({ error: 'Card não encontrado.' }, { status: 404 });
    if (deal.organization_id !== orgId) {
      return NextResponse.json({ error: 'Card não encontrado.' }, { status: 404 });
    }

    if ((deal.owner_id ?? null) === novoDonoId) {
      return NextResponse.json(
        { dealId, ownerId: novoDonoId, deal: false, contato: null, conversas: 0, semMudanca: true },
        { status: 200 },
      );
    }

    const admin = createStaticAdminClient();

    // Um SELECT só para os dois nomes da nota (dono antigo e novo).
    const idsParaNome = [deal.owner_id, novoDonoId].filter((id): id is string => typeof id === 'string');
    let perfis: PerfilRow[] = [];
    if (idsParaNome.length > 0) {
      const { data: perfisRaw } = await admin
        .from('profiles')
        .select('id, role, ve_todos_os_leads, organization_id, name, nickname, first_name')
        .in('id', idsParaNome);
      perfis = (perfisRaw ?? []) as PerfilRow[];
    }
    const donoAntigo = deal.owner_id ? perfis.find((p) => p.id === deal.owner_id) ?? null : null;
    const novoDono = novoDonoId ? perfis.find((p) => p.id === novoDonoId) ?? null : null;

    // Service role ignora RLS: a checagem de organização do novo dono é NOSSA.
    if (novoDonoId && (!novoDono || novoDono.organization_id !== orgId)) {
      return NextResponse.json({ error: 'Essa pessoa não faz parte da sua organização.' }, { status: 422 });
    }

    const agora = new Date().toISOString();

    // ---------------------------------------------------------------- 1) card
    const { data: cardRaw, error: updDealErr } = await admin
      .from('deals')
      .update({ owner_id: novoDonoId, updated_at: agora })
      .eq('id', dealId)
      .eq('organization_id', orgId)
      .select('id');
    if (updDealErr) {
      console.error('[deals/owner] troca do dono do card falhou:', updDealErr.message);
      return NextResponse.json({ error: 'Não foi possível trocar o responsável do card.' }, { status: 500 });
    }
    // Update de 0 linhas não é erro no Postgrest: sem esta checagem a tela diria
    // "responsável atualizado" sem nada ter mudado no banco.
    if (((cardRaw ?? []) as { id: string }[]).length === 0) {
      console.error('[deals/owner] update do card não atingiu nenhuma linha:', dealId);
      return NextResponse.json({ error: 'Não foi possível trocar o responsável do card.' }, { status: 500 });
    }

    // ------------------------------------------------------------- 2) pessoa
    // Sem isto o novo dono abre um card oco: contato invisível pela RLS.
    // Sem filtro por organização de propósito: `contacts.organization_id` é
    // NULÁVEL (a própria policy de insert aceita `organization_id is null`, e a
    // base antiga tem contato assim). Filtrar por org deixaria justamente esses
    // contatos para trás EM SILÊNCIO. Quem autoriza aqui é a corrente
    // card→contato: o card já foi conferido como sendo da org.
    // O `.select('id')` existe para contar linha: update de 0 linhas não é erro
    // no Postgrest, e um repasse que não pegou tem que aparecer no relatório.
    let contato: boolean | null = null;
    if (deal.contact_id) {
      const { data: contatoRaw, error: updContatoErr } = await admin
        .from('contacts')
        .update({ owner_id: novoDonoId })
        .eq('id', deal.contact_id)
        .select('id');
      if (updContatoErr) {
        console.error('[deals/owner] troca do dono do contato falhou:', updContatoErr.message);
        contato = false;
      } else {
        contato = ((contatoRaw ?? []) as { id: string }[]).length > 0;
      }
    }

    // ------------------------------------------------------------ 3) conversa
    // TODAS as conversas do contato: a Niva atende por um número só, então a
    // thread é da pessoa — deixar uma para trás esconde o WhatsApp do Inbox.
    let conversas = 0;
    let conversasFalhou = false;
    if (deal.contact_id) {
      const { data: convsRaw, error: updConvErr } = await admin
        .from('messaging_conversations')
        .update({ assigned_user_id: novoDonoId, assigned_at: novoDonoId ? agora : null })
        .eq('contact_id', deal.contact_id)
        .eq('organization_id', orgId)
        .select('id');
      if (updConvErr) {
        console.error('[deals/owner] repasse das conversas falhou:', updConvErr.message);
        conversasFalhou = true;
      } else {
        conversas = ((convsRaw ?? []) as { id: string }[]).length;
      }
    }

    // ------------------------ 3b) aviso: a pessoa tem card no nome de outro colega?
    // A posse é da PESSOA, então trocar o dono do contato move a visibilidade INTEIRA.
    // Um card aberto daquele mesmo contato em outro funil, no nome de um colega, vira
    // card oco para ele na hora (contacts_select = ve_tudo() OR owner_id = eu) — e sem
    // este aviso ninguém fica sabendo. Só conta; não mexe nos outros cards, porque
    // decidir se eles vão junto é escolha de quem repassa, não do código.
    let outrosCardsComOutroDono = 0;
    if (deal.contact_id) {
      const { data: outrosRaw, error: outrosErr } = await admin
        .from('deals')
        .select('id, owner_id')
        .eq('contact_id', deal.contact_id)
        .eq('organization_id', orgId)
        .neq('id', dealId)
        .eq('is_won', false)
        .eq('is_lost', false)
        .is('deleted_at', null);
      if (outrosErr) {
        console.error('[deals/owner] contagem de outros cards do contato falhou:', outrosErr.message);
      } else {
        outrosCardsComOutroDono = ((outrosRaw ?? []) as { owner_id: string | null }[]).filter(
          (d) => (d.owner_id ?? null) !== novoDonoId,
        ).length;
      }
    }

    // ------------------------------------------- 4) aviso: enxerga o funil?
    // O admin enxerga todos os funis sem linha em `board_access`; os demais só
    // os concedidos. Sem acesso, o card SOME da tela do novo dono — avisa, mas
    // não bloqueia: o repasse continua correto, só falta liberar o funil.
    let avisoSemAcessoAoFunil = false;
    let funil: string | null = null;
    if (novoDono && novoDono.role !== 'admin' && deal.board_id) {
      const { data: acessoRaw, error: acessoErr } = await admin
        .from('board_access')
        .select('board_id')
        .eq('board_id', deal.board_id)
        .eq('user_id', novoDono.id)
        .maybeSingle();
      if (acessoErr) {
        console.error('[deals/owner] leitura de board_access falhou:', acessoErr.message);
      } else if (!acessoRaw) {
        avisoSemAcessoAoFunil = true;
        const { data: boardRaw } = await admin
          .from('boards')
          .select('name')
          .eq('id', deal.board_id)
          .maybeSingle();
        funil = ((boardRaw as { name: string | null } | null)?.name) ?? null;
      }
    }

    // --------------------------------------------------------- 5) rastro
    // Comissão depende de quem é o dono e até aqui não havia nenhum registro de
    // quem tirou lead de quem. Best-effort: nota perdida não desfaz o repasse.
    try {
      const { error: notaErr } = await admin.from('activities').insert({
        organization_id: orgId,
        deal_id: dealId,
        owner_id: novoDonoId ?? user.id,
        type: 'NOTE',
        title: 'Responsável alterado',
        description: `De ${nomeDe(donoAntigo)} para ${nomeDe(novoDono)}, por ${nomeDe(quemChama)}.`,
        date: agora,
        completed: true,
      });
      if (notaErr) console.error('[deals/owner] nota da troca falhou (não-fatal):', notaErr.message);
    } catch (err) {
      console.error('[deals/owner] nota da troca falhou (não-fatal):', err);
    }

    return NextResponse.json(
      {
        dealId,
        ownerId: novoDonoId,
        deal: true,
        contato,
        conversas,
        conversasFalhou,
        avisoSemAcessoAoFunil,
        funil,
        outrosCardsComOutroDono,
        novoDonoNome: novoDonoId ? nomeDe(novoDono) : null,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[deals/owner]', error instanceof Error ? error.message : 'Erro desconhecido');
    return NextResponse.json({ error: 'Erro interno ao trocar o responsável.' }, { status: 500 });
  }
}
