/**
 * POST /api/deals/[dealId]/call-outcome/apply
 *
 * Aplica o desfecho CONFIRMADO da call. F2: nota-resumo + tarefas (todas na
 * agenda) + dados do negócio + objeções/motivo_perda + voice_calls. Carimba
 * `enviado_em` (now) em tudo. custom_fields é REPLACE → spread seguro.
 * (Move de board = F3; marcar realizada = F4.)
 *
 * Ordem: lê o deal → idempotência → UPDATE do deal (23505→409, carimba
 * call_outcome_applied_at) → só então escreve activities/voice_calls (best-effort).
 * Assim um conflito no move (F3) não deixa activities órfãs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { DesfechoSchema } from '@/lib/ai/call-outcome/schemas';
import { MOTIVO_LABELS } from '@/lib/ai/taxonomy/motivos';
import { routeForDesfecho, reabordarEmFallback, deveCriarLembrete } from '@/lib/ai/call-outcome/routing';
import { montarCarimboVenda } from '@/lib/deals/carimboVenda';

export const maxDuration = 60;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    audioFilePath?: string; transcricao?: string; desfecho?: unknown;
  };
  const parsed = DesfechoSchema.safeParse(body.desfecho);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid desfecho payload' }, { status: 400 });
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // RLS é o gate de autorização.
  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id, organization_id, owner_id, board_id, stage_id, value, custom_fields, contact_id')
    .eq('id', dealId)
    .single();
  if (dealErr || !deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });

  const existingCf = (deal.custom_fields as Record<string, unknown> | null) ?? {};
  if (existingCf.call_outcome_applied_at) {
    return NextResponse.json({ dealId, applied: true, already_applied: true }, { status: 200 });
  }

  const enviadoEm = new Date().toISOString();
  const orgId = deal.organization_id as string;
  const ownerId = (deal.owner_id as string | null) ?? user.id;

  // --- Monta o UPDATE do deal (custom_fields REPLACE → spread) ---------------
  const qual = { ...((existingCf.qualificacao as Record<string, unknown> | undefined) ?? {}) };
  if (d.dados_negocio.operadora) qual.operadora = d.dados_negocio.operadora;
  if (typeof d.dados_negocio.vidas === 'number') qual.vidas = d.dados_negocio.vidas;
  // ⚠️ `valor_pago_exato` é o que o lead paga HOJE no plano ANTIGO — o gatilho da conversa, não
  // receita. Quando o desfecho é FECHOU, o valor dito é outro número: o do plano COMPRADO, que vai
  // para `venda.premio_mensal` mais abaixo. Gravar os dois no mesmo campo (era o que acontecia)
  // corrompia a qualificação e inflava o "valor em jogo" do funil. Ver lib/deals/premioFechado.ts.
  const fechou = d.desfecho === 'fechou';
  const valorDito = typeof d.dados_negocio.valor === 'number' && d.dados_negocio.valor > 0
    ? d.dados_negocio.valor
    : null;
  if (valorDito !== null && !fechou) qual.valor_pago_exato = valorDito;

  // objecoes: acumula estruturado (tolera formato antigo string[] da Ana).
  const prevObjecoes = Array.isArray(existingCf.objecoes)
    ? (existingCf.objecoes as unknown[]).map((o) =>
        typeof o === 'string' ? { categoria: 'outro', detalhe: o, origem: 'ana' } : o,
      )
    : [];
  const newObjecoes = d.objecoes.map((categoria) => ({ categoria, detalhe: null, origem: 'consultor' as const }));

  const nextCf: Record<string, unknown> = {
    ...existingCf,
    qualificacao: qual,
    objecoes: [...prevObjecoes, ...newObjecoes],
    call_outcome_applied_at: enviadoEm,
  };
  if (d.desfecho === 'perdeu' && d.motivo_perda) {
    nextCf.motivo_perda = { categoria: d.motivo_perda, detalhe: d.motivo_perda_detalhe ?? null };
  }

  // Reunião realizada: todo desfecho de call ATENDIDA marca realizada
  // (remarcar/nao_atendeu não — a reunião não aconteceu). Par do botão manual.
  const marcaRealizada = d.desfecho !== 'remarcar' && d.desfecho !== 'nao_atendeu';
  if (marcaRealizada && !existingCf.reuniao_realizada) {
    nextCf.reuniao_realizada = { realizada: true, at: enviadoEm, by: user.id };
  }

  // FECHOU → carimbo da venda, com o prêmio já dentro quando o consultor disse o valor.
  //
  // Sem este carimbo, fechar pelo desfecho produzia uma venda INVISÍVEL: a barra de meta do mês lê
  // `custom_fields.venda` (não `is_won`, porque o card ganho sai do funil), a regra "venda sem o
  // prêmio informado" do gestor filtra por ele, e a rota do prêmio recusa card sem ele. Quem o
  // criava era só o caminho do kanban (`proximo-funil`), por onde este fluxo não passa.
  //
  // Não sobrescreve carimbo existente: `vendedor_id`/`vendido_em` são o "de quem é esta venda", e
  // reescrever isso num segundo desfecho mudaria o dono da venda.
  if (fechou && !existingCf.venda) {
    const { data: perfil } = await supabase
      .from('profiles').select('name, nickname').eq('id', deal.owner_id ?? user.id).maybeSingle();
    const { data: boardRow } = await supabase
      .from('boards').select('name').eq('id', deal.board_id as string).maybeSingle();
    const { data: stageRow } = await supabase
      .from('board_stages').select('label, name').eq('id', deal.stage_id as string).maybeSingle();

    nextCf.venda = montarCarimboVenda({
      vendedorId: (deal.owner_id as string | null) ?? user.id,
      vendedorNome: (perfil?.nickname as string | null) ?? (perfil?.name as string | null) ?? null,
      vendidoEm: enviadoEm,
      boardIdDaVenda: deal.board_id as string,
      funilDaVenda: (boardRow?.name as string | null) ?? 'Funil',
      etapaDaVenda: (stageRow?.label as string | null) ?? (stageRow?.name as string | null) ?? 'Etapa',
      valorNaVenda: (deal.value as number | null) ?? 0,
      premioMensal: valorDito ?? undefined,
      operadora: d.dados_negocio.operadora ?? undefined,
    });
  }

  const dealUpdate: Record<string, unknown> = { custom_fields: nextCf, updated_at: enviadoEm };
  // `deals.value` NÃO recebe o valor da venda.
  //
  // Era `if (fechou) dealUpdate.value = valor` — e por desenho (lib/deals/premioFechado.ts)
  // `deals.value` nesta operação é a mensalidade do plano ANTIGO, apurada pela Ana. Escrever o
  // prêmio ali apagava o número que sustenta o argumento da conversa e inflava o "valor em jogo" do
  // funil com receita que já foi ganha. O prêmio agora tem lugar próprio: `venda.premio_mensal`.
  // loss_reason = detalhe livre, senão o rótulo da categoria (spec §4.9:
  // "detalhe||rótulo" — mantém a UI de perda funcionando mesmo sem detalhe).
  if (d.desfecho === 'perdeu') {
    const rotulo = d.motivo_perda ? MOTIVO_LABELS[d.motivo_perda] : null;
    const lossReason = d.motivo_perda_detalhe ?? rotulo;
    if (lossReason) dealUpdate.loss_reason = lossReason;
  }

  // Roteamento por desfecho (§6): fechou→Implantação+won, perdeu→Nutrição+lost,
  // vai_pensar→Negociação (mesmo board), remarcar/nao_atendeu não movem.
  // is_won/is_lost são setados NO DESFECHO (registram a venda/perda na hora).
  const route = routeForDesfecho(d.desfecho);
  if (route.stageId) {
    dealUpdate.stage_id = route.stageId;
    dealUpdate.last_stage_change_date = enviadoEm;
    if (route.boardId) dealUpdate.board_id = route.boardId;
  }
  if (route.mark === 'won') {
    dealUpdate.is_won = true;
    dealUpdate.is_lost = false;
    dealUpdate.closed_at = enviadoEm;
  }
  if (route.mark === 'lost') {
    dealUpdate.is_lost = true;
    dealUpdate.is_won = false;
    dealUpdate.closed_at = enviadoEm;
  }

  const { error: updErr } = await supabase.from('deals').update(dealUpdate).eq('id', dealId);
  if (updErr) {
    if ((updErr as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Deal duplicado na etapa de destino.' }, { status: 409 });
    }
    console.error('[call-outcome/apply] deal update failed:', updErr.message);
    return NextResponse.json({ error: 'Failed to apply outcome' }, { status: 500 });
  }

  // --- Side effects (best-effort; o desfecho já valeu no deal) ----------------
  const admin = createStaticAdminClient();

  // 0. Reunião realizada → completa a CALL agendada da Ana (alimenta a métrica).
  if (marcaRealizada) {
    const agendada = existingCf.reuniao_agendada as { activity_id?: string } | undefined;
    if (agendada?.activity_id) {
      // .eq('deal_id') e obrigatorio: activity_id sai de custom_fields, campo do usuario.
      await admin
        .from('activities')
        .update({ completed: true })
        .eq('id', agendada.activity_id)
        .eq('deal_id', dealId);
    }
  }

  // 1. Nota-resumo → activity NOTE completed.
  await admin.from('activities').insert({
    organization_id: orgId, deal_id: dealId, owner_id: ownerId,
    type: 'NOTE', title: 'Desfecho da call', description: d.nota_resumo,
    date: enviadoEm, completed: true,
  });

  // 2. Tarefas → 1 TASK por item (nunca CALL — evita o índice único de CALL).
  for (const t of d.tarefas) {
    await admin.from('activities').insert({
      organization_id: orgId, deal_id: dealId, owner_id: ownerId,
      type: 'TASK', title: t.descricao, description: t.descricao,
      date: t.data ?? enviadoEm, completed: false,
    });
  }

  // 2b. Perdeu → lembrete de reabordagem (§6.1): a IA sugere a data pelo sinal
  //     da conversa (reabordar_em); sem sinal, fallback por motivo de perda.
  //
  //     `deveCriarLembrete` alinha este caminho ao da tela, que já filtrava por motivo. Aqui
  //     `route.reabordagem` é true para QUALQUER desfecho "perdeu", então um lead marcado como
  //     `engano` por áudio ganhava a tarefa que o mesmo lead, descartado pelo kanban, não ganhava.
  //     A segunda metade da guarda é o contato: sem `contact_id` não existe a quem ligar.
  if (route.reabordagem && deveCriarLembrete(d.motivo_perda ?? 'outro', Boolean(deal.contact_id))) {
    const reabordarEm = d.reabordar_em ?? reabordarEmFallback(d.motivo_perda ?? 'outro', new Date(enviadoEm));
    await admin.from('activities').insert({
      organization_id: orgId, deal_id: dealId, owner_id: ownerId,
      type: 'TASK', title: 'Reabordar lead (reativação)',
      description: d.motivo_perda_detalhe ?? (d.motivo_perda ? MOTIVO_LABELS[d.motivo_perda] : 'Reabordagem por motivo de perda'),
      date: reabordarEm, completed: false,
    });
  }

  // 3. Persistir a call em voice_calls (FORCE RLS → admin/service role).
  await admin.from('voice_calls').insert({
    organization_id: orgId, deal_id: dealId, mode: 'human_call', status: 'completed',
    initiated_by: user.id, channel: 'phone', direction: 'outbound',
    started_at: enviadoEm, ended_at: enviadoEm,
    transcript: { text: body.transcricao ?? '' },
    analysis: d,
    metadata: { audio_path: body.audioFilePath ?? null },
  });

  return NextResponse.json({ dealId, applied: true }, { status: 200 });
}
