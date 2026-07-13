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
import { routeForDesfecho, reabordarEmFallback } from '@/lib/ai/call-outcome/routing';

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
    .select('id, organization_id, owner_id, board_id, stage_id, value, custom_fields')
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
  if (typeof d.dados_negocio.valor === 'number' && d.dados_negocio.valor > 0) qual.valor_pago_exato = d.dados_negocio.valor;

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

  const dealUpdate: Record<string, unknown> = { custom_fields: nextCf, updated_at: enviadoEm };
  if (d.desfecho === 'fechou' && typeof d.dados_negocio.valor === 'number' && d.dados_negocio.valor > 0) {
    dealUpdate.value = d.dados_negocio.valor;
  }
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
  if (route.reabordagem) {
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
