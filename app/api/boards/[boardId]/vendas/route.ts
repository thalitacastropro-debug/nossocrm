/**
 * GET /api/boards/[boardId]/vendas?inicio=<ISO>&fim=<ISO>
 * Vendas CARIMBADAS naquele funil dentro do período — o número da barra de meta
 * ("Fechamentos / mês") e do bloco "Já ganho no mês" do topo do funil.
 *
 * POR QUE ROTA DE SERVIDOR E NÃO UMA CONSULTA PELO CLIENTE:
 * desde o conserto de 26/08/2026 o card dado como ganho é MOVIDO para o próximo
 * funil (regra da dona: "assim que é dado como ganho, o time de implantação é o
 * novo responsável" e "não tem como o mesmo card estar aberto em vários funis").
 * O card ganho no Comercial passa a VIVER na Implantação — e
 * `deals_select` exige `pode_ver_board(board_id)` (migração
 * 20260824210000_acesso_por_funil.sql). O Pedro, que só tem `board_access` do
 * 'Comercial — Consultor', NÃO consegue mais ler os cards que ele próprio
 * vendeu: a mesma consulta feita pelo navegador dele devolveria ZERO vendas
 * justamente para quem vendeu, e a barra de meta do Comercial ficaria zerada na
 * tela dele. Por isso a varredura acontece aqui, com service role.
 *
 * A PERMISSÃO CONTINUA SENDO A DA RLS, em duas camadas:
 * 1) para pedir o número de um funil é preciso conseguir LER aquele funil com o
 *    cliente do próprio usuário (prova de `board_access`), e o funil tem que ser
 *    da organização dele — `pode_ver_board()` libera qualquer funil para
 *    `e_admin()`, sem olhar organização, então essa conferência é NOSSA;
 * 2) quem NÃO tem `ve_tudo()` (não é admin e não tem `ve_todos_os_leads`) só
 *    recebe as vendas em que ELE é o `vendedor_id` do carimbo. Sem isso, uma
 *    rota que contorna a RLS de propósito viraria um vazamento da carteira do
 *    time inteiro por uma query string.
 *
 * A FONTE É O CARIMBO, não `is_won` nem `board_id`: `custom_fields.venda` viaja
 * junto com o card (por isso o bug de origem doía tanto — a automação antiga
 * CRIAVA card novo no destino e a Implantação recebia card em branco: Richard
 * Gois chegou com 0 itens de timeline contra 3 no original, Mavie Ramunno 1
 * contra 4) e guarda em QUE funil a venda foi fechada, por quem e por quanto. O
 * card contado aqui pode estar hoje na Implantação, com outro dono e reaberto —
 * a venda continua sendo do Comercial.
 *
 * FALHA PARCIAL É VISÍVEL: carimbo com data ilegível não derruba a request — sai
 * contado em `ignorados` no corpo da resposta e vai para o log. Venda sumindo em
 * silêncio da meta do mês é pior do que número com ressalva. (Carimbo sem
 * `board_id_da_venda` é o único que não tem como aparecer aqui: sem esse campo não dá
 * para dizer de qual funil a venda é.)
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
}

/** Linha crua do PostgREST: `venda` é o objeto JSON do carimbo, do jeito que estiver. */
interface LinhaDeVenda {
  id: string | null;
  value: number | null;
  venda: Record<string, unknown> | null;
}

/** Item da lista enxuta que a tela consome (o hook useVendasDoFunil espelha isto). */
interface VendaDaResposta {
  deal_id: string;
  vendedor_id: string | null;
  vendedor_nome: string | null;
  vendido_em: string;
  valor_na_venda: number;
}

/** Campo de texto do carimbo; devolve null quando veio vazio, nulo ou de outro tipo. */
const texto = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.trim() !== '' ? valor : null;

export async function GET(request: NextRequest, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  if (!boardId || !uuidRegex.test(boardId)) {
    return NextResponse.json({ error: 'Funil inválido.' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const inicio = searchParams.get('inicio') ?? '';
  const fim = searchParams.get('fim') ?? '';
  const de = Date.parse(inicio);
  const ate = Date.parse(fim);
  if (!inicio || !fim || Number.isNaN(de) || Number.isNaN(ate)) {
    return NextResponse.json(
      { error: 'Período inválido. Informe início e fim em formato ISO.' },
      { status: 400 },
    );
  }
  if (de > ate) {
    return NextResponse.json(
      { error: 'O início do período não pode ser depois do fim.' },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sessão expirada. Entre de novo.' }, { status: 401 });

    const { data: quemChamaRaw } = await supabase
      .from('profiles')
      .select('id, role, ve_todos_os_leads, organization_id')
      .eq('id', user.id)
      .single();
    const quemChama = quemChamaRaw as PerfilRow | null;
    if (!quemChama || !quemChama.organization_id) {
      return NextResponse.json({ error: 'Perfil sem organização. Fale com o administrador.' }, { status: 403 });
    }
    const orgId = quemChama.organization_id;

    // GATE 1 — ler o funil com o cliente DO USUÁRIO. `boards_select` é
    // `pode_ver_board(id)`: se voltar vazio, é porque não existe linha em
    // `board_access` para essa pessoa. Daqui para baixo a leitura é com service
    // role, então este é o único ponto em que a RLS ainda fala.
    const { data: boardRaw, error: boardErr } = await supabase
      .from('boards')
      .select('id, organization_id')
      .eq('id', boardId)
      .maybeSingle();
    if (boardErr) {
      console.error('[boards/vendas] leitura do funil falhou:', boardErr.message);
      return NextResponse.json({ error: 'Não foi possível conferir o acesso ao funil.' }, { status: 500 });
    }
    const board = boardRaw as { id: string; organization_id: string | null } | null;
    // `pode_ver_board()` libera TODO funil para admin, inclusive de outra
    // organização — a conferência de organização é nossa.
    if (!board || board.organization_id !== orgId) {
      return NextResponse.json(
        { error: 'Você não tem acesso a este funil. Peça a liberação ao administrador.' },
        { status: 403 },
      );
    }

    // Espelha `ve_tudo()` da RLS: admin e gestor veem a carteira do time; consultor
    // comum vê só o que ele mesmo vendeu.
    const veTudo = quemChama.role === 'admin' || quemChama.ve_todos_os_leads === true;

    const admin = createStaticAdminClient();

    const { data, error } = await admin
      .from('deals')
      // Só o mínimo: id (a tela deduplica contra o caminho antigo de `is_won`), value
      // (rede de segurança quando o carimbo veio sem `valor_na_venda`) e o próprio
      // carimbo. Nada de `select('*')`: o card ganho mora em outro funil, e devolver a
      // linha inteira daqui seria entregar pelo servidor o que a RLS esconde na tela.
      .select('id, value, venda:custom_fields->venda')
      // Organização é o cerco obrigatório: service role ignora RLS.
      .eq('organization_id', orgId)
      // O CARIMBO manda: `board_id` diria onde o card está HOJE (Implantação), e é
      // justamente isso que não interessa para "quantas vendas este funil fez".
      .eq('custom_fields->venda->>board_id_da_venda', boardId)
      // O PERÍODO NÃO É RECORTADO AQUI, de propósito. `->>` devolve TEXTO: filtrar data
      // por comparação de string só funciona enquanto TODO carimbo estiver no mesmo
      // formato UTC, e esta base já tem carimbo escrito à mão (o da Mavie Ramunno, o
      // único com `confirmado_por`, recuperado em 26/08). Um carimbo em outro formato
      // ("26/08/2026") cairia fora da janela de texto e a venda sumiria da meta EM
      // SILÊNCIO — exatamente o que esta rota existe para não deixar acontecer. O
      // recorte é feito no JS logo abaixo, com `Date.parse`, e o que ele não conseguir
      // ler aparece em `ignorados` em vez de evaporar. O custo é varrer todas as vendas
      // já carimbadas DESTE funil: a meta da Niva é 7 por mês.
      // Card soft-deletado não conta como venda (mesma regra do board).
      .is('deleted_at', null);

    if (error) {
      console.error('[boards/vendas] varredura das vendas falhou:', error.message);
      return NextResponse.json({ error: 'Não foi possível carregar as vendas do funil.' }, { status: 500 });
    }

    // Cliente Supabase é destipado: uma conversão única e controlada na borda, e daqui
    // para baixo tudo é validado campo a campo.
    const linhas = (data ?? []) as unknown as LinhaDeVenda[];

    const vendas: VendaDaResposta[] = [];
    let valorTotal = 0;
    let ignorados = 0;

    for (const linha of linhas) {
      const dealId = linha.id;
      const bruto = linha.venda;
      if (!dealId || !bruto || typeof bruto !== 'object') {
        ignorados += 1;
        continue;
      }

      const vendidoEm = texto(bruto.vendido_em);
      const boardDaVenda = texto(bruto.board_id_da_venda);
      if (!vendidoEm || !boardDaVenda) {
        ignorados += 1;
        continue;
      }

      // O recorte do período é TODO aqui (o banco não filtra data — ver a consulta acima).
      // `Date.parse` entende UTC e fuso ("2026-08-31T22:00:00-03:00"); o que ele não
      // entender vira `ignorados`, com log, em vez de sumir da meta calado.
      const quando = Date.parse(vendidoEm);
      if (Number.isNaN(quando)) {
        ignorados += 1;
        continue;
      }
      if (quando < de || quando > ate) continue;

      const vendedorId = texto(bruto.vendedor_id);

      // ISOLAMENTO (GATE 2): sem `ve_tudo()`, só as vendas da própria pessoa. Feito
      // aqui, e não no filtro do PostgREST, porque o `->>` compara texto e um carimbo
      // com `vendedor_id` nulo ou malformado sumiria do recorte sem aparecer em
      // `ignorados` — o que a gente esconde do consultor tem que ser decisão explícita.
      if (!veTudo && vendedorId !== user.id) continue;

      // Carimbo sem valor cai no valor atual do card: melhor um número aproximado do que
      // sumir com a venda da soma do mês. O `?? NaN` é para o carimbo escrito à mão sem o
      // campo (ou com null), que senão viraria R$ 0,00 silencioso.
      const valorDoCarimbo = Number(bruto.valor_na_venda ?? NaN);
      const valor = Number.isFinite(valorDoCarimbo) ? valorDoCarimbo : Number(linha.value) || 0;

      vendas.push({
        deal_id: dealId,
        vendedor_id: vendedorId,
        vendedor_nome: texto(bruto.vendedor_nome),
        vendido_em: vendidoEm,
        valor_na_venda: valor,
      });
      valorTotal += valor;
    }

    // Mais recente primeiro (a lista é curta: a meta da Niva é 7 vendas/mês).
    vendas.sort((a, b) => Date.parse(b.vendido_em) - Date.parse(a.vendido_em));

    if (ignorados > 0) {
      console.error(`[boards/vendas] ${ignorados} carimbo(s) ilegível(is) no funil ${boardId}`);
    }

    return NextResponse.json(
      {
        boardId,
        inicio,
        fim,
        // 'minhas' avisa a tela que o número é da pessoa, não do funil inteiro.
        escopo: veTudo ? 'todas' : 'minhas',
        vendas,
        contagem: vendas.length,
        valorTotal,
        ignorados,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[boards/vendas]', error instanceof Error ? error.message : 'Erro desconhecido');
    return NextResponse.json({ error: 'Erro interno ao carregar as vendas do funil.' }, { status: 500 });
  }
}
