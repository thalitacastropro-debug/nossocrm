/**
 * PATCH /api/deals/[dealId]/venda — informar (ou corrigir) o PRÊMIO DO PLANO VENDIDO.
 *
 * O buraco que esta rota fecha: o CRM sabia que a venda aconteceu, mas não por quanto.
 * `deals.value` nesta operação é a mensalidade do plano ANTIGO do lead (o que a Ana apura
 * na qualificação); o prêmio do plano COMPRADO não existia em campo nenhum. Sem ele, "Já
 * ganho no mês" somava o plano velho e a comissão — percentual do prêmio, variável por
 * operadora — seria chute (niva-os-visao.md §1, roadmap §6c).
 *
 * POR QUE ROTA DE SERVIDOR E NÃO UM UPDATE PELO CLIENTE (como a aba "Origem" faz):
 * desde 26/08/2026 o card ganho é MOVIDO para a Implantação, e `deals_select` exige
 * `pode_ver_board(board_id)` (migração 20260824210000_acesso_por_funil.sql). Quem vendeu
 * PERDE o card de vista: pelo navegador, o consultor não conseguiria nem LER o próprio card
 * para informar o prêmio da própria venda. Ele também não conseguiria escrever — o
 * WITH CHECK de `deals_update` roda sobre a linha, que agora vive num funil que ele não vê.
 *
 * O GATE É O MESMO DA ROTA DE VENDAS (`GET /api/boards/[boardId]/vendas`), e é ele que
 * substitui a RLS aqui, já que service role passa por cima dela:
 * 1) o card tem que ser da organização de quem chama (service role enxerga todas);
 * 2) quem não tem `ve_tudo()` (admin ou `ve_todos_os_leads`) só mexe na venda em que ELE é
 *    o `vendedor_id` do carimbo. Sem isso, uma rota que contorna RLS de propósito viraria
 *    porta aberta para editar o número que vai virar a comissão de outra pessoa.
 *
 * ⚠️ O CARIMBO DA VENDA NÃO É REESCRITO. `vendedor_id`, `vendido_em`, `board_id_da_venda` e
 * companhia são congelados no ganho (ver a automação em `proximo-funil/route.ts`) e é deles
 * que sai "de quem é esta venda". Aqui só entram os campos do plano vendido — e cada
 * gravação deixa nota na timeline, porque a comissão depende deste número.
 *
 * ⚠️ COMISSÃO NÃO PASSA POR AQUI. A tabela de percentuais por operadora é confidencial
 * (em 26/08 o `goal_description` do funil expôs pró-labore e comissão para o time inteiro).
 * Esta rota grava o PRÊMIO; o cálculo vive na tela restrita de fechamento do mês.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { lerPremioFechado, validarPremioFechado } from '@/lib/deals/premioFechado';

export const maxDuration = 30;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PerfilRow {
  id: string;
  role: string | null;
  ve_todos_os_leads: boolean | null;
  organization_id: string | null;
}

interface DealRow {
  id: string;
  title: string | null;
  organization_id: string | null;
  custom_fields: Record<string, unknown> | null;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
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
      .select('id, role, ve_todos_os_leads, organization_id')
      .eq('id', user.id)
      .single();
    const perfil = perfilRaw as PerfilRow | null;
    if (!perfil?.organization_id) {
      return NextResponse.json({ error: 'Perfil sem organização. Fale com o administrador.' }, { status: 403 });
    }
    const orgId = perfil.organization_id;
    // Espelha `ve_tudo()` da RLS — a mesma conta feita na rota de vendas.
    const veTudo = perfil.role === 'admin' || perfil.ve_todos_os_leads === true;

    let corpo: unknown;
    try {
      corpo = await request.json();
    } catch {
      return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
    }
    if (typeof corpo !== 'object' || corpo === null) {
      return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
    }

    const admin = createStaticAdminClient();

    // Leitura FRESCA e com service role: o card ganho pode estar num funil que quem vendeu
    // não enxerga, e é daqui que sai o `custom_fields` a ser mesclado (a Ana e os crons
    // escrevem na mesma coluna — sobrescrever o objeto inteiro apagaria o trabalho deles).
    const { data: dealRaw, error: dealErr } = await admin
      .from('deals')
      .select('id, title, organization_id, custom_fields')
      .eq('id', dealId)
      .maybeSingle();
    if (dealErr) {
      console.error('[deals/venda] leitura do card falhou:', dealErr.message);
      return NextResponse.json({ error: 'Não foi possível abrir o card.' }, { status: 500 });
    }
    const deal = dealRaw as DealRow | null;
    // Organização diferente responde 404 (e não 403) de propósito: card de outra empresa
    // não deve nem confirmar que existe.
    if (!deal || deal.organization_id !== orgId) {
      return NextResponse.json({ error: 'Card não encontrado.' }, { status: 404 });
    }

    const customFields: Record<string, unknown> = { ...(deal.custom_fields ?? {}) };
    const carimboBruto = customFields.venda;
    if (typeof carimboBruto !== 'object' || carimboBruto === null) {
      return NextResponse.json(
        {
          error: 'Este card não tem venda registrada. O prêmio só existe depois que o card é dado '
            + 'como ganho — dê o ganho primeiro.',
        },
        { status: 422 },
      );
    }
    const carimbo = { ...(carimboBruto as Record<string, unknown>) };

    // GATE DE POSSE DA VENDA: sem `ve_tudo()`, só mexe no que ele mesmo vendeu.
    const vendedorId = typeof carimbo.vendedor_id === 'string' ? carimbo.vendedor_id : null;
    if (!veTudo && vendedorId !== user.id) {
      return NextResponse.json(
        { error: 'Esta venda não é sua. Só quem fechou (ou o administrador) informa o prêmio.' },
        { status: 403 },
      );
    }

    const validacao = validarPremioFechado(corpo as Record<string, unknown>);
    if (!validacao.ok) {
      return NextResponse.json({ error: validacao.erro }, { status: 400 });
    }
    const { premio_mensal, operadora, vigencia_em } = validacao.valor;

    // O que havia antes — serve para a nota dizer que foi CORREÇÃO, e não primeira informação.
    const anterior = lerPremioFechado(carimbo);

    const agora = new Date().toISOString();
    carimbo.premio_mensal = premio_mensal;
    carimbo.operadora = operadora;
    carimbo.vigencia_em = vigencia_em;
    carimbo.premio_informado_por = user.id;
    carimbo.premio_informado_em = agora;
    customFields.venda = carimbo;

    const { data: gravadoRaw, error: updErr } = await admin
      .from('deals')
      .update({ custom_fields: customFields, updated_at: agora })
      // Organização no WHERE também: cerco obrigatório com service role.
      .eq('id', dealId)
      .eq('organization_id', orgId)
      .select('id');
    if (updErr) {
      console.error('[deals/venda] gravação do prêmio falhou:', updErr.message);
      return NextResponse.json({ error: 'Não foi possível salvar o prêmio.' }, { status: 500 });
    }
    // Update de 0 linhas não é erro no PostgREST: sem esta checagem a tela diria "salvo"
    // com o banco intacto.
    if (((gravadoRaw ?? []) as { id: string }[]).length === 0) {
      console.error('[deals/venda] o update do prêmio não atingiu nenhuma linha:', dealId);
      return NextResponse.json({ error: 'Não foi possível salvar o prêmio.' }, { status: 500 });
    }

    // Nota na timeline (best-effort: nota perdida não desfaz a gravação). A jornada do card é
    // REGISTRO — e a comissão sai deste número, então trocar 1.000 por 2.500 tem que deixar
    // rastro de quem trocou.
    try {
      const vigenciaTexto = vigencia_em ? `, vigência ${vigencia_em.split('-').reverse().join('/')}` : '';
      const descricao = anterior
        ? `Prêmio do plano vendido CORRIGIDO de ${BRL.format(anterior.premio_mensal)} para `
          + `${BRL.format(premio_mensal)} — ${operadora}${vigenciaTexto}.`
        : `Prêmio do plano vendido informado: ${BRL.format(premio_mensal)}/mês — ${operadora}${vigenciaTexto}.`;
      const { error: notaErr } = await admin.from('activities').insert({
        organization_id: orgId,
        deal_id: dealId,
        owner_id: user.id,
        type: 'NOTE',
        title: anterior ? 'Prêmio da venda corrigido' : 'Prêmio da venda informado',
        description: descricao,
        date: agora,
        completed: true,
      });
      if (notaErr) console.error('[deals/venda] nota do prêmio falhou (não-fatal):', notaErr.message);
    } catch (err) {
      console.error('[deals/venda] nota do prêmio falhou (não-fatal):', err);
    }

    return NextResponse.json(
      { ok: true, venda: { premio_mensal, operadora, vigencia_em } },
      { status: 200 },
    );
  } catch (error) {
    console.error('[deals/venda]', error instanceof Error ? error.message : 'Erro desconhecido');
    return NextResponse.json({ error: 'Erro interno ao salvar o prêmio da venda.' }, { status: 500 });
  }
}
