/**
 * @fileoverview Handoff server-side Ana->Consultor. Quando uma reunião REAL é confirmada, MOVE
 * o deal para o próximo board da jornada (`boards.next_board_id`, ex.: SDR — IA Qualificação →
 * Comercial — Consultor) para o consultor assumir o lead agendado.
 *
 * MOVE, não copia (decisão da Thalita 2026-07-19, após revisão adversarial): uma cópia deixava
 * DUAS fontes de verdade — a activity CALL e as mutações (remarcação/cancelamento) ficam sempre
 * no deal, então o card copiado congelava (horário velho, "reunião realizada"/"cancelar" agindo
 * na activity errada, anti-no-show caçando reunião já feita). Movendo o PRÓPRIO deal, a CALL, o
 * `reuniao_agendada`, o lead_form/tier/qualificacao viajam juntos → o consultor trabalha o card
 * real, uma fonte de verdade só. A cadência anti-no-show é board-agnóstica (ancora em activities),
 * então segue disparando após o move; a barra de agendamentos conta CALL (também board-agnóstica).
 *
 * Gatilho = reunião REAL confirmada (chamado pelo agent.service DEPOIS do avanço de etapa, quando
 * `scheduling_status.kind==='confirmed'`), NÃO "chegou na etapa agendado" (o avaliador de IA pode
 * alcançar "agendado" sem booking — bug do Cleysson). Idempotente: flag `custom_fields.handoff_consultor`
 * no deal (uma vez movido/flagado, nunca re-move — cobre remarcação e re-runs).
 *
 * @module lib/ai/scheduling/handoff
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { slotLabelFromIso } from './availability';

export interface HandoffToNextBoardParams {
  supabase: SupabaseClient;
  /** Deal a mover (o card no funil da Ana). */
  dealId: string;
  /** Board de origem. Se null/sem `next_board_id` → no-op. */
  sourceBoardId: string | null | undefined;
  organizationId: string;
}

export interface HandoffResult {
  handedOff: boolean;
  reason?: 'no_next_board' | 'already_done' | 'source_missing' | 'no_target_stage' | 'db_error';
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

  // 2. Deal + guard de idempotência. A flag `handoff_consultor` (uma vez movido) impede re-move —
  //    cobre remarcação/re-run. Defensivo: se o deal já saiu do board de origem, também não mexe.
  const { data: srcDeal } = await supabase
    .from('deals')
    .select('board_id, title, custom_fields')
    .eq('id', dealId)
    .maybeSingle();
  if (!srcDeal) return { handedOff: false, reason: 'source_missing' };
  const srcCustom = (srcDeal.custom_fields as Record<string, unknown>) || {};
  if (srcCustom.handoff_consultor) return { handedOff: false, reason: 'already_done' };
  if (srcDeal.board_id && srcDeal.board_id !== sourceBoardId) return { handedOff: false, reason: 'already_done' };

  // 3. Etapa de entrada do board destino (menor order).
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

  // 4. MOVE o deal (mesmo id): board_id + stage_id + carimbo de origem/idempotência. A activity CALL
  //    (owner=consultor) e o custom_fields (reuniao_agendada/lead_form/tier/qualificacao) ficam no
  //    MESMO deal — o consultor abre o card real, com o horário e o histórico. Sem cópia congelada.
  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('deals')
    .update({
      board_id: nextBoardId,
      stage_id: entryStageId,
      last_stage_change_date: now,
      updated_at: now,
      custom_fields: {
        ...srcCustom,
        originBoardId: sourceBoardId,
        handoff_consultor: { board_id: nextBoardId, from: sourceBoardId, at: now },
      },
    })
    .eq('id', dealId);

  if (updErr) {
    console.error('[Handoff] falha ao mover deal p/ o board destino:', updErr);
    return { handedOff: false, reason: 'db_error' };
  }

  // 5. Log de atividade (best-effort, pra rastreabilidade na timeline).
  const { error: actErr } = await supabase.from('activities').insert({
    deal_id: dealId,
    organization_id: organizationId,
    type: 'STATUS_CHANGE',
    title: 'Movido para o funil do Consultor',
    description: 'Automação: reunião agendada → card movido para o board Comercial — Consultor',
    date: now,
    completed: true,
  });
  if (actErr) console.error('[Handoff] log de atividade falhou (não-fatal):', actErr);

  // 6. Aviso POSITIVO no Telegram pro consultor ("✅ Novo lead agendado — {nome}, reunião {label}").
  //    Busca token/chat_id em organization_settings, igual ao handleHandoff do agent.service. Com o
  //    MOVE, o notify_team da etapa "agendado" ficou inócuo (o deal sai na hora) — este é o alerta que
  //    avisa o consultor que caiu um lead agendado no funil dele. Best-effort: NUNCA falha o handoff.
  //    Caveat (LOW, aceito): o guard de idempotência (passo 2) é read-then-write não-atômico; no
  //    double-run CONCORRENTE conhecido do agent.service, os 2 runs podem passar o guard e enviar 2
  //    pings idênticos. Raiz é o double-run (não este código); dup de notificação é inócua.
  try {
    const { data: orgTelegram } = await supabase
      .from('organization_settings')
      .select('telegram_bot_token, telegram_chat_id')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (orgTelegram?.telegram_bot_token && orgTelegram?.telegram_chat_id) {
      const leadForm = srcCustom.lead_form as { mapped?: { name?: string } } | undefined;
      const reuniao = srcCustom.reuniao_agendada as { data_hora?: string } | undefined;
      const contactName =
        leadForm?.mapped?.name?.trim() ||
        (typeof srcDeal.title === 'string' ? srcDeal.title.trim() : '') ||
        'Novo lead';
      const meetingLabel = slotLabelFromIso(reuniao?.data_hora, '-03:00');

      const { sendTelegramMessage, formatMeetingHandoffMessage } = await import('@/lib/notifications/telegram');
      await sendTelegramMessage(
        orgTelegram.telegram_bot_token,
        orgTelegram.telegram_chat_id,
        formatMeetingHandoffMessage({
          contactName,
          meetingLabel,
          appUrl: process.env.NEXT_PUBLIC_APP_URL,
          dealId,
        }),
      );
    }
  } catch (err) {
    console.error('[Handoff] notificação Telegram falhou (não-fatal):', err);
  }

  return { handedOff: true, targetBoardId: nextBoardId };
}
