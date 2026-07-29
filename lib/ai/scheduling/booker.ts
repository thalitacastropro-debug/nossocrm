/**
 * @fileoverview Booker determinístico da agenda real: cria/cancela/remarca a
 * reunião como `activity` (type CALL) e grava o estado no deal. Sem LLM.
 *
 * Ordem à prova de falha (revisão adversarial 2026-07-02):
 * 1. re-check explícito do slot (spec §6) — a unique index é a trava real, isto evita INSERT à toa;
 * 2. INSERT da nova activity ANTES de cancelar a antiga (remarcação) — se o novo slot encheu, a
 *    reunião antiga fica intacta;
 * 3. UPDATE do deal — se falhar, ROLLBACK da activity nova e retorna não-marcou (nunca confirma falso);
 * 4. só então cancela a antiga (best-effort) — o deal já aponta pra nova.
 *
 * @module lib/ai/scheduling/booker
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Slot } from './types';

export interface BookSlotParams {
  supabase: SupabaseClient;
  dealId: string;
  contactId: string | null;
  organizationId: string;
  consultantUserId: string;
  leadName: string;
  summary: string;
  slot: Slot;
  previousActivityId?: string | null;
}

export interface BookSlotResult {
  ok: boolean;
  activityId?: string;
  reason?: 'taken' | 'db_error' | 'already_confirmed';
  /** Quando reason='already_confirmed': label/ISO da reunião que JÁ estava marcada (p/ reafirmar). */
  confirmedLabel?: string;
  confirmedIso?: string;
}

export async function bookSlot(params: BookSlotParams): Promise<BookSlotResult> {
  const { supabase, dealId, contactId, organizationId, consultantUserId, leadName, summary, slot } = params;

  // 0. Anti-corrida (fecha o duplo-agendamento em mensagens quase simultâneas): relê o estado
  // FRESCO do deal. O guard do scheduling.service usa `reuniao_agendada` do contexto montado no
  // INÍCIO do turno — se duas mensagens do lead forem processadas em paralelo, ambas veem "sem
  // reunião" e marcariam 2 horários. Esta releitura pega o commit do outro processamento: se já
  // há reunião confirmada e NÃO é remarcação explícita, não marca outra — reafirma a existente.
  if (!params.previousActivityId) {
    const { data: fresh } = await supabase
      .from('deals')
      .select('custom_fields')
      .eq('id', dealId)
      .single();
    const ra = ((fresh?.custom_fields as Record<string, unknown> | null)?.reuniao_agendada ?? null) as
      | { status?: string; activity_id?: string; data_hora?: string; label?: string }
      | null;
    if (ra?.status === 'confirmada') {
      return {
        ok: false,
        reason: 'already_confirmed',
        activityId: ra.activity_id,
        confirmedLabel: ra.label,
        confirmedIso: ra.data_hora,
      };
    }
  }

  // 1. Re-check explícito (spec §6): o slot ainda está livre AGORA? A unique index
  // (owner_id, date) WHERE type='CALL' é a trava atômica real; este SELECT só evita um
  // INSERT inútil e honra o "re-check" da spec. Não conta como garantia (TOCTOU coberto pela index).
  const { data: clash } = await supabase
    .from('activities')
    .select('id')
    .eq('owner_id', consultantUserId)
    .eq('type', 'CALL')
    .eq('date', slot.startIso)
    .is('deleted_at', null)
    .limit(1);
  if (clash && clash.length > 0) return { ok: false, reason: 'taken' };

  // 2. Cria a nova ligação PRIMEIRO (antes de cancelar a antiga, em remarcação): se o novo slot
  // já encheu (23505), a reunião antiga permanece intacta e o lead não fica sem horário.
  const { data: act, error: insErr } = await supabase
    .from('activities')
    .insert({
      title: `Ligação diagnóstica — ${leadName}`,
      description: summary,
      type: 'CALL',
      date: slot.startIso,
      completed: false,
      deal_id: dealId,
      contact_id: contactId,
      owner_id: consultantUserId,
      organization_id: organizationId,
      participant_contact_ids: contactId ? [contactId] : null,
    })
    .select('id')
    .single();

  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') return { ok: false, reason: 'taken' };
    console.error('[Booker] insert falhou:', insErr);
    return { ok: false, reason: 'db_error' };
  }

  // 3. Grava o estado no deal (merge no custom_fields + tag). Se falhar, ROLLBACK: deleta a
  // activity nova e retorna não-marcou — NUNCA confirma falso (spec §8). Sem isto, a Ana diria
  // "fechado" com o deal desatualizado e a remarcação/cancelamento futuro não acharia a activity.
  const { data: deal } = await supabase
    .from('deals')
    .select('custom_fields, tags')
    .eq('id', dealId)
    .single();

  const customFields = (deal?.custom_fields as Record<string, unknown>) || {};
  const prevTags = Array.isArray(deal?.tags) ? (deal!.tags as unknown[]).map(String) : [];
  const tags = Array.from(new Set([...prevTags, 'reuniao:agendada']));

  const { error: updErr } = await supabase
    .from('deals')
    .update({
      custom_fields: {
        ...customFields,
        reuniao_agendada: {
          data_hora: slot.startIso,
          activity_id: act!.id,
          status: 'confirmada',
          criada_em: new Date().toISOString(),
          // Label PT-BR do horário marcado — permite reafirmar a reunião sem re-marcar
          // (idempotência: nova mensagem do lead confirma o mesmo horário, não desliza).
          label: slot.label,
        },
      },
      tags,
      // Agendar é sinal positivo forte: REEXIBE o card se ele tiver sido escondido antes
      // (is_lost=true por classificação fora-ICP num turno ANTERIOR, antes de o lead ceder e marcar).
      // O guard da extração impede um NOVO is_lost quando há reunião, mas não LIMPA um is_lost já
      // gravado — sem isto, um card com reunião REAL continuaria oculto (revisão adversarial 27/07).
      is_lost: false,
      closed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);

  if (updErr) {
    console.error('[Booker] update do deal falhou — rollback da activity nova:', updErr);
    await supabase.from('activities').update({ deleted_at: new Date().toISOString() }).eq('id', act!.id);
    return { ok: false, reason: 'db_error' };
  }

  // 4. Remarcação: agora que a nova está confirmada e o deal aponta pra ela, cancela a antiga
  // (best-effort). Se falhar, sobra uma activity extra no calendário — reconciliável, mas o deal
  // está correto e a Ana confirmou com verdade.
  if (params.previousActivityId) {
    const { error: delErr } = await supabase
      .from('activities')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', params.previousActivityId);
    if (delErr) console.error('[Booker] falha ao cancelar activity antiga (deal já aponta pra nova):', delErr);
  }

  return { ok: true, activityId: act!.id };
}

export interface CancelMeetingParams {
  supabase: SupabaseClient;
  dealId: string;
  activityId: string;
}

export async function cancelMeeting(params: CancelMeetingParams): Promise<void> {
  const { supabase, dealId, activityId } = params;
  await supabase.from('activities').update({ deleted_at: new Date().toISOString() }).eq('id', activityId);

  const { data: deal } = await supabase.from('deals').select('custom_fields, tags').eq('id', dealId).single();
  const customFields = (deal?.custom_fields as Record<string, unknown>) || {};
  const ra = (customFields.reuniao_agendada as Record<string, unknown>) || {};
  const prevTags = Array.isArray(deal?.tags) ? (deal!.tags as unknown[]).map(String) : [];

  await supabase
    .from('deals')
    .update({
      custom_fields: { ...customFields, reuniao_agendada: { ...ra, status: 'cancelada' } },
      tags: prevTags.filter((t) => t !== 'reuniao:agendada'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);
}
