/**
 * @fileoverview Escalação "precisa humano" (Fix 2, 27/07). Quando um lead QUALIFICADO recusa os
 * horários oferecidos 2x, ele não pode morrer calado (caso Arthur: a Ana dizia "vou ver com o
 * consultor" e nada acontecia). Aqui:
 *   - `noteDeclineAndCheckEscalation`: conta a recusa no deal e diz se é hora de escalar (2ª recusa,
 *     lead qualificado, ainda não escalado).
 *   - `escalateToConsultor`: MOVE o deal pro board do Consultor (`next_board_id`) na etapa
 *     "Qualificação" (não "Call Agendada" — não há call marcada) pra o consultor fazer o contato.
 *
 * O ALERTA (Telegram + handoff pendente no inbox) fica no agent.service via `handleHandoff`, pra não
 * duplicar a notificação. Lead FORA do perfil não passa por aqui (recusa dele → perdido, não escala).
 *
 * @module lib/ai/scheduling/escalation
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Nº de recusas de horário a partir do qual um lead qualificado é escalado ao consultor. */
const DECLINE_ESCALATION_THRESHOLD = 2;

/**
 * Registra uma recusa de horário no deal e retorna se deve escalar pro consultor AGORA.
 * Escala quando: lead QUALIFICADO (tier != fora_icp) + atingiu o limite de recusas + ainda não
 * escalado. Sempre persiste o contador (best-effort). Lê o deal FRESCO pra não depender do contexto
 * (que é montado no início do turno).
 */
export async function noteDeclineAndCheckEscalation(
  supabase: SupabaseClient,
  dealId: string,
): Promise<boolean> {
  const { data: deal } = await supabase
    .from('deals')
    .select('custom_fields')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return false;

  const cf = (deal.custom_fields as Record<string, unknown>) ?? {};
  // Já escalado uma vez → não conta nem re-escala (idempotente).
  if (cf.escalated_consultor != null) return false;

  const tierValue = (cf.tier as { value?: unknown } | undefined)?.value;
  const qualificado = typeof tierValue === 'string' && tierValue !== 'fora_icp';

  const anterior = typeof cf.scheduling_declines === 'number' ? cf.scheduling_declines : 0;
  const recusas = anterior + 1;

  // Persiste o contador (merge do custom_fields fresco). A corrida de sobrescrita de custom_fields
  // é pré-existente e tolerável aqui: no pior caso o contador erra por 1 num turno concorrente raro.
  const { error } = await supabase
    .from('deals')
    .update({ custom_fields: { ...cf, scheduling_declines: recusas }, updated_at: new Date().toISOString() })
    .eq('id', dealId);
  if (error) console.error('[Escalation] falha ao gravar contador de recusas:', error);

  return qualificado && recusas >= DECLINE_ESCALATION_THRESHOLD;
}

/**
 * MOVE o deal pro board do Consultor (`next_board_id`), etapa "Qualificação", pro consultor assumir
 * o contato manual. Idempotente (flag `escalated_consultor`); reseta o contador de recusas e carimba
 * a origem. Retorna true se moveu (pra o agent.service disparar o alerta só quando moveu de fato).
 */
export async function escalateToConsultor(
  supabase: SupabaseClient,
  dealId: string,
  sourceBoardId: string | null | undefined,
  organizationId: string,
): Promise<boolean> {
  if (!sourceBoardId) return false;

  // 1. Board destino (Consultor) — mesmo caminho do handoff.
  const { data: srcBoard } = await supabase
    .from('boards')
    .select('next_board_id')
    .eq('id', sourceBoardId)
    .maybeSingle();
  const nextBoardId = ((srcBoard?.next_board_id as string | null | undefined) ?? null) as string | null;
  if (!nextBoardId) return false;

  // 2. Deal + idempotência.
  const { data: deal } = await supabase
    .from('deals')
    .select('board_id, custom_fields')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return false;
  const cf = (deal.custom_fields as Record<string, unknown>) ?? {};
  if (cf.escalated_consultor != null) return false; // já escalado
  if (deal.board_id && deal.board_id !== sourceBoardId) return false; // já saiu do SDR (ex.: booking)

  // 3. Etapa "Qualificação" do board destino (por nome; fallback: 2ª por ordem; senão a entrada).
  const { data: stages } = await supabase
    .from('board_stages')
    .select('id, name')
    .eq('board_id', nextBoardId)
    .order('order', { ascending: true });
  const list = Array.isArray(stages) ? stages : [];
  const qualStageId =
    (list.find((s) => typeof s.name === 'string' && /qualific/i.test(s.name))?.id as string | undefined) ??
    (list[1]?.id as string | undefined) ??
    (list[0]?.id as string | undefined);
  if (!qualStageId) return false;

  // 4. MOVE (mesmo id): board + etapa Qualificação + flag de idempotência + reset do contador.
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('deals')
    .update({
      board_id: nextBoardId,
      stage_id: qualStageId,
      last_stage_change_date: now,
      updated_at: now,
      // Escalar é sinal positivo forte: REEXIBE o card caso ele tenha sido escondido antes
      // (is_lost=true por classificação fora-ICP num turno anterior, antes de o lead se recuperar e
      // travar no agendamento). Sem isto, o card entraria OCULTO no Consultor e a escalação falharia
      // no seu propósito (anti-morte-calada). Mesmo tratamento do booker.ts (revisão adversarial 27/07).
      is_lost: false,
      closed_at: null,
      custom_fields: {
        ...cf,
        originBoardId: sourceBoardId,
        scheduling_declines: 0,
        escalated_consultor: { board_id: nextBoardId, from: sourceBoardId, at: now, motivo: 'sem_encaixe_2_recusas' },
      },
    })
    .eq('id', dealId);
  if (error) {
    console.error('[Escalation] falha ao mover deal pro Consultor/Qualificação:', error);
    return false;
  }

  // 5. Log de atividade (best-effort, pra timeline).
  const { error: actErr } = await supabase.from('activities').insert({
    deal_id: dealId,
    organization_id: organizationId,
    type: 'STATUS_CHANGE',
    title: 'Escalado ao Consultor (sem encaixe de horário)',
    description: 'Automação: lead qualificado recusou os horários 2x → movido para o funil do Consultor (Qualificação) para contato humano.',
    date: now,
    completed: true,
  });
  if (actErr) console.error('[Escalation] log de atividade falhou (não-fatal):', actErr);

  return true;
}
