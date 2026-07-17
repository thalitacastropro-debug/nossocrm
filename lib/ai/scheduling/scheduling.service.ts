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
import { getAvailableSlots, slotLabelFromIso } from './availability';
import { detectSchedulingIntent, validateDetectedSlot, mesmoSlot } from './detect';
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
  reuniaoAgendada: { activity_id?: string; status?: string; data_hora?: string; label?: string } | null;
  aiConfig: { provider: AIProvider; apiKey: string; model: string; structuredApiKey: string; structuredModel: string };
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
  const rawAvailable = getAvailableSlots({ now: params.now, busy, config: cfg.availability });

  const alreadyBooked = params.reuniaoAgendada?.status === 'confirmada';

  // O horário JÁ marcado é do PRÓPRIO lead: a Ana não pode re-oferecê-lo, mas o detector precisa
  // vê-lo. Em produção o busy.ts carrega a reunião do lead como ocupada e ela some de `available`;
  // montamos o Slot dela aqui para (1) garantir que sai da lista que a Ana OFERECE e (2) re-injetá-la
  // SÓ na lista que vai pro detector. Como o prompt manda "slotIso DEVE ser um dos oferecidos", sem
  // essa re-injeção o detector é FORÇADO a apontar outro horário quando o lead só reconfirma — era
  // o deslize 9h→10h.
  const slotMarcado: Slot | null =
    alreadyBooked && params.reuniaoAgendada?.data_hora
      ? {
          startIso: params.reuniaoAgendada.data_hora,
          endIso: new Date(
            new Date(params.reuniaoAgendada.data_hora).getTime() + cfg.availability.slotMinutes * 60_000,
          ).toISOString(),
          label:
            params.reuniaoAgendada.label ??
            slotLabelFromIso(params.reuniaoAgendada.data_hora, cfg.availability.utcOffset),
        }
      : null;

  // `available` = o que a Ana OFERECE, sempre SEM o horário já marcado (senão ela devolveria ao
  // lead um horário que já é dele).
  const available = slotMarcado
    ? rawAvailable.filter((s) => !mesmoSlot(s.startIso, slotMarcado.startIso))
    : rawAvailable;

  // Só detecta/marca quando faz sentido: houve oferta na conversa.
  if (!params.offeredBefore) return { available, status: { kind: 'none' } };

  const detect = await detectSchedulingIntent({
    supabase: params.supabase,
    conversationId: params.conversationId,
    // Re-injeta o horário marcado SÓ pra DETECÇÃO (ver comentário do slotMarcado).
    offered: slotMarcado ? [...available, slotMarcado] : available,
    aiConfig: params.aiConfig,
  });

  // Observe: não age; devolve os slots + a detecção (o agent.service loga pra validação).
  if (params.dryRun) return { available, status: { kind: 'none' }, detected: detect };

  if (detect.intent === 'cancel' && alreadyBooked && params.reuniaoAgendada?.activity_id) {
    await cancelMeeting({ supabase: params.supabase, dealId: params.dealId, activityId: params.reuniaoAgendada.activity_id });
    return { available, status: { kind: 'cancelled' }, detected: detect };
  }

  if (detect.intent === 'accept' || detect.intent === 'reschedule') {
    // Reafirma SÓ se o lead está reconfirmando O MESMO horário já marcado. Se ele apontou
    // OUTRO, é remarcação de fato — mesmo que o detector tenha rotulado 'accept' (ele rotula
    // pela frase do lead, "15", não pelo estado do deal). Sem comparar o slot, o lead que pede
    // outro dia e escolhe horário novo fica com o horário ANTIGO no banco enquanto a Ana
    // promete o novo: foi o bug da Nathalia (prometeu segunda 15h, banco ficou sexta 17h).
    if (alreadyBooked && detect.intent === 'accept' && mesmoSlot(detect.slotIso, params.reuniaoAgendada?.data_hora)) {
      const label =
        params.reuniaoAgendada?.label ??
        slotLabelFromIso(params.reuniaoAgendada?.data_hora, cfg.availability.utcOffset);
      return { available, status: { kind: 'confirmed', label }, detected: detect };
    }

    const slot = validateDetectedSlot(detect.slotIso, available);
    if (!slot) return { available, status: { kind: 'none' }, detected: detect }; // horário inválido/tomado já saiu da lista

    const result = await bookSlot({
      supabase: params.supabase,
      dealId: params.dealId,
      contactId: params.contactId,
      organizationId: params.organizationId,
      consultantUserId,
      leadName: params.leadName,
      summary: params.summary,
      slot,
      // Remarcação: tanto o 'reschedule' explícito quanto o 'accept' de um horário DIFERENTE
      // do que já está marcado precisam cancelar a activity antiga — senão sobram 2 ligações
      // na agenda do consultor.
      previousActivityId: alreadyBooked ? (params.reuniaoAgendada?.activity_id ?? null) : null,
    });
    if (result.ok) return { available, status: { kind: 'confirmed', label: slot.label }, detected: detect };
    // Corrida: outro processamento (mensagem quase simultânea) já confirmou a reunião. Reafirma
    // o horário REAL que ficou marcado — nunca cria uma 2ª ligação nem desliza o horário.
    if (result.reason === 'already_confirmed') {
      const label =
        result.confirmedLabel ?? slotLabelFromIso(result.confirmedIso, cfg.availability.utcOffset);
      return { available, status: { kind: 'confirmed', label }, detected: detect };
    }
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
