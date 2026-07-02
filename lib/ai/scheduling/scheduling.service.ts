/**
 * @fileoverview Orquestrador da agenda real. Junta config→busy→available e,
 * quando aplicável, detect→book. Gated por board. NÃO marca em observe.
 * @module lib/ai/scheduling/scheduling.service
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIProvider } from '../config';
import type { Slot, SchedulingStatus, DetectResult } from './types';
import { getSchedulingConfig } from './config';
import { loadBusyIntervals } from './busy';
import { getAvailableSlots } from './availability';
import { detectSchedulingIntent, validateDetectedSlot } from './detect';
import { bookSlot, cancelMeeting } from './booker';

export interface RunSchedulingParams {
  supabase: SupabaseClient;
  boardId: string | null | undefined;
  organizationId: string;
  conversationId: string;
  dealId: string;
  contactId: string | null;
  leadName: string;
  summary: string;
  /** custom_fields.reuniao_agendada atual, se houver. */
  reuniaoAgendada: { activity_id?: string; status?: string; data_hora?: string } | null;
  aiConfig: { provider: AIProvider; apiKey: string; model: string };
  /** false => respond (pode marcar); true => observe (só calcula/loga). */
  dryRun: boolean;
  /** consultant_user_id da board (null => cai no interino, não marca). */
  consultantUserId: string | null;
  now: Date;
  /** Se true, já houve oferta de horário na conversa (a persona controla). */
  offeredBefore: boolean;
}

export interface RunSchedulingResult {
  available: Slot[];
  status: SchedulingStatus;
  /** Intenção detectada (pra logar em observe / debug). Ausente quando não rodou detecção. */
  detected?: DetectResult;
}

export async function runScheduling(params: RunSchedulingParams): Promise<RunSchedulingResult> {
  const cfg = getSchedulingConfig(params.boardId);
  if (!cfg || !params.consultantUserId) {
    return { available: [], status: { kind: 'none' } };
  }
  const consultantUserId = params.consultantUserId;

  const busy = await loadBusyIntervals({
    supabase: params.supabase,
    organizationId: params.organizationId,
    consultantUserId,
    now: params.now,
    config: cfg.availability,
  });
  const available = getAvailableSlots({ now: params.now, busy, config: cfg.availability });

  const alreadyBooked = params.reuniaoAgendada?.status === 'confirmada';

  // Só detecta/marca quando faz sentido: houve oferta na conversa.
  if (!params.offeredBefore) return { available, status: { kind: 'none' } };

  const detect = await detectSchedulingIntent({
    supabase: params.supabase,
    conversationId: params.conversationId,
    offered: available,
    aiConfig: params.aiConfig,
  });

  // Observe: não age; devolve os slots + a detecção (o agent.service loga pra validação).
  if (params.dryRun) return { available, status: { kind: 'none' }, detected: detect };

  if (detect.intent === 'cancel' && alreadyBooked && params.reuniaoAgendada?.activity_id) {
    await cancelMeeting({ supabase: params.supabase, dealId: params.dealId, activityId: params.reuniaoAgendada.activity_id });
    return { available, status: { kind: 'cancelled' }, detected: detect };
  }

  if (detect.intent === 'accept' || detect.intent === 'reschedule') {
    const slot = validateDetectedSlot(detect.slotIso, available);
    if (!slot) return { available, status: { kind: 'none' }, detected: detect }; // horário inválido/tomado já saiu da lista

    // Idempotência (spec §6): se já há reunião confirmada pro MESMO slot, no-op — confirma sem re-marcar
    // (evita colidir na unique index e a Ana dizer "encheu" pro próprio horário do lead).
    if (alreadyBooked && params.reuniaoAgendada?.data_hora === slot.startIso) {
      return { available, status: { kind: 'confirmed', label: slot.label }, detected: detect };
    }

    const result = await bookSlot({
      supabase: params.supabase,
      dealId: params.dealId,
      contactId: params.contactId,
      organizationId: params.organizationId,
      consultantUserId,
      leadName: params.leadName,
      summary: params.summary,
      slot,
      previousActivityId: detect.intent === 'reschedule' ? params.reuniaoAgendada?.activity_id : null,
    });
    if (result.ok) return { available, status: { kind: 'confirmed', label: slot.label }, detected: detect };
    if (result.reason === 'taken') {
      // Slot encheu entre a oferta e a reserva. Re-query do busy (outro consultor pode ter marcado
      // no meio) e recalcula do zero — não confia no estado carregado no início.
      const freshBusy = await loadBusyIntervals({
        supabase: params.supabase,
        organizationId: params.organizationId,
        consultantUserId,
        now: params.now,
        config: cfg.availability,
      });
      const fresh = getAvailableSlots({ now: params.now, busy: freshBusy, config: cfg.availability });
      return { available: fresh, status: { kind: 'slot_taken', alternatives: fresh.slice(0, 3) }, detected: detect };
    }
  }

  return { available, status: { kind: 'none' }, detected: detect };
}
