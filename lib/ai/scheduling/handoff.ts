/**
 * @fileoverview Handoff server-side Ana->Consultor. Quando o booker confirma uma reunião
 * REAL, cria uma cópia do deal no próximo board da jornada (`boards.next_board_id`, ex.:
 * SDR — IA Qualificação → Comercial — Consultor) para o consultor receber o lead agendado.
 *
 * Por que existe: `next_board_id` só era consumido pela automação "NextBoard" do
 * `useMoveDeal` (client-side), que roda apenas quando um humano ARRASTA o card na UI. A Ana
 * agenda 100% no servidor (booker + avaliador inline), então o deal ficava preso no funil
 * dela e o Denilson nunca recebia o card. Este módulo é o gatilho server-side que faltava.
 *
 * Gatilho = BOOKING REAL (`reuniao_agendada.status='confirmada'`), NÃO "chegou na etapa
 * agendado" — o avaliador de IA pode alcançar a etapa "agendado" sem reunião marcada (bug do
 * Cleysson), e esses não devem ir pro consultor.
 *
 * Idempotência em 2 camadas (espelha a filosofia do booker):
 *   1. índice único parcial `deals_handoff_origin_uniq` em (custom_fields->>'originDealId')
 *      WHERE originAutomation='NEXT_BOARD_SCHEDULING' — a trava ATÔMICA real (23505 na corrida);
 *   2. flag `custom_fields.handoff_consultor` no deal de origem — fast-path que evita o INSERT.
 *
 * @module lib/ai/scheduling/handoff
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Namespace da automação — distinto do 'NEXT_BOARD' do useMoveDeal (cópias manuais). */
export const HANDOFF_AUTOMATION = 'NEXT_BOARD_SCHEDULING';

export interface HandoffToNextBoardParams {
  supabase: SupabaseClient;
  /** Deal de origem (o card no funil da Ana). */
  dealId: string;
  /** Board de origem. Se null/sem `next_board_id` → no-op. */
  sourceBoardId: string | null | undefined;
  organizationId: string;
}

export interface HandoffResult {
  handedOff: boolean;
  reason?: 'no_next_board' | 'already_done' | 'source_missing' | 'no_target_stage' | 'db_error';
  /** ID do deal criado no board destino (quando handedOff=true). */
  newDealId?: string;
  targetBoardId?: string;
}

export async function handoffToNextBoard(params: HandoffToNextBoardParams): Promise<HandoffResult> {
  const { supabase, dealId, sourceBoardId, organizationId } = params;
  if (!sourceBoardId) return { handedOff: false, reason: 'no_next_board' };

  // 1. Próximo board da jornada. Sem ele, não há pra onde entregar.
  const { data: srcBoard } = await supabase
    .from('boards')
    .select('next_board_id')
    .eq('id', sourceBoardId)
    .maybeSingle();
  const nextBoardId = ((srcBoard?.next_board_id as string | null | undefined) ?? null) as string | null;
  if (!nextBoardId) return { handedOff: false, reason: 'no_next_board' };

  // 2. Deal de origem + fast-path de idempotência (evita o INSERT quando já entregue).
  const { data: srcDeal } = await supabase
    .from('deals')
    .select('title, value, contact_id, owner_id, priority, tags, custom_fields')
    .eq('id', dealId)
    .maybeSingle();
  if (!srcDeal) return { handedOff: false, reason: 'source_missing' };
  const srcCustom = (srcDeal.custom_fields as Record<string, unknown>) || {};
  if (srcCustom.handoff_consultor) return { handedOff: false, reason: 'already_done' };

  // 3. Etapa de entrada do board destino (menor order) — mesmo critério do useMoveDeal (stages[0]).
  const { data: stages } = await supabase
    .from('board_stages')
    .select('id')
    .eq('board_id', nextBoardId)
    .order('order', { ascending: true })
    .limit(1);
  const entryStageId = (Array.isArray(stages) && stages[0]?.id ? String(stages[0].id) : undefined) as
    | string
    | undefined;
  if (!entryStageId) return { handedOff: false, reason: 'no_target_stage' };

  // 4. Cria a cópia no board destino, preservando os dados do card de origem
  //    (lead_form/qualificacao/tier/reuniao_agendada) + rastreio de origem.
  const now = new Date().toISOString();
  const { data: newDeal, error: insErr } = await supabase
    .from('deals')
    .insert({
      organization_id: organizationId,
      title: srcDeal.title,
      value: (srcDeal.value as number | null) ?? 0,
      board_id: nextBoardId,
      stage_id: entryStageId,
      contact_id: (srcDeal.contact_id as string | null) ?? null,
      owner_id: (srcDeal.owner_id as string | null) ?? null,
      priority: (srcDeal.priority as string | null) ?? null,
      tags: Array.isArray(srcDeal.tags) ? srcDeal.tags : [],
      probability: 0,
      is_won: false,
      is_lost: false,
      custom_fields: {
        ...srcCustom,
        originDealId: dealId,
        originBoardId: sourceBoardId,
        originAutomation: HANDOFF_AUTOMATION,
      },
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (insErr) {
    // 23505 = colidiu com o índice único parcial → outra execução (corrida/re-run) já entregou.
    if ((insErr as { code?: string }).code === '23505') return { handedOff: false, reason: 'already_done' };
    console.error('[Handoff] falha ao criar deal no board destino:', insErr);
    return { handedOff: false, reason: 'db_error' };
  }

  // 5. Carimba a idempotência no deal de ORIGEM. Best-effort: o índice único já garante
  //    não-duplicação; se o stamp falhar, a próxima execução colide no 23505 → already_done.
  const { error: stampErr } = await supabase
    .from('deals')
    .update({
      custom_fields: {
        ...srcCustom,
        handoff_consultor: { deal_id: newDeal!.id, board_id: nextBoardId, at: now },
      },
      updated_at: now,
    })
    .eq('id', dealId);
  if (stampErr) console.error('[Handoff] stamp de idempotência falhou (não-fatal, índice cobre):', stampErr);

  // 6. Log de atividade no deal de origem (best-effort, pra rastreabilidade na timeline).
  const { error: actErr } = await supabase.from('activities').insert({
    deal_id: dealId,
    organization_id: organizationId,
    type: 'STATUS_CHANGE',
    title: 'Enviado para o funil do Consultor',
    description: 'Automação: reunião agendada → card criado no board Comercial — Consultor',
    date: now,
    completed: true,
  });
  if (actErr) console.error('[Handoff] log de atividade falhou (não-fatal):', actErr);

  return { handedOff: true, newDealId: newDeal!.id, targetBoardId: nextBoardId };
}
