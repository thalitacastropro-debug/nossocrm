/**
 * @fileoverview Booker determinístico da agenda real: cria/cancela/remarca a
 * reunião como `activity` (type CALL) e grava o estado no deal. Sem LLM.
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
  reason?: 'taken' | 'db_error';
}

export async function bookSlot(params: BookSlotParams): Promise<BookSlotResult> {
  const { supabase, dealId, contactId, organizationId, consultantUserId, leadName, summary, slot } = params;

  // Remarcação: cancela a anterior antes de criar a nova.
  if (params.previousActivityId) {
    await supabase
      .from('activities')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', params.previousActivityId);
  }

  // Cria a ligação. A unique index (owner_id, date) WHERE type='CALL' é a trava de corrida.
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

  // Grava o estado no deal (merge no custom_fields + tag).
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
        },
      },
      tags,
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);

  if (updErr) {
    console.error('[Booker] update do deal falhou (activity criada):', updErr);
    // A activity existe; devolvemos ok — o estado no deal é reconciliável, mas não confirmamos falso.
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
