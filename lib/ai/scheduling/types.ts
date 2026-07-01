/**
 * @fileoverview Tipos compartilhados do agendamento (agenda real da Ana).
 * @module lib/ai/scheduling/types
 */

/** Um horário oferecível ao lead. Instantes em ISO UTC; label pt-BR pro prompt. */
export interface Slot {
  /** Início do slot em ISO UTC (ex.: '2026-07-03T13:00:00.000Z' = 10h SP). */
  startIso: string;
  /** Fim do slot (start + slotMinutes) em ISO UTC. */
  endIso: string;
  /** Rótulo humano pt-BR (ex.: 'quinta, 03/07, às 10h'). */
  label: string;
}

/** Intervalo ocupado do consultor, em epoch ms (comparação numérica simples). */
export interface BusyInterval {
  startMs: number;
  endMs: number;
}

/** Config do motor de disponibilidade. */
export interface AvailabilityConfig {
  /** Offset fixo do fuso (Brasil sem DST). */
  utcOffset: '-03:00';
  /** Horas de início candidatas por dia útil. */
  candidateStartHours: number[];
  /** Duração do slot em minutos. */
  slotMinutes: number;
  /** Antecedência mínima em minutos a partir de "agora". */
  minLeadMinutes: number;
  /** Quantos dias úteis varrer pra frente. */
  horizonBusinessDays: number;
  /** Teto de slots retornados. */
  maxSlots: number;
}

/** Intenção do lead detectada na conversa. */
export interface DetectResult {
  intent: 'accept' | 'reschedule' | 'cancel' | 'none';
  /** Horário aceito/desejado em ISO UTC, se houver — deve bater com um Slot oferecido. */
  slotIso: string | null;
}

/** Status da reunião pra injetar no contexto da Ana. */
export type SchedulingStatus =
  | { kind: 'none' }
  | { kind: 'confirmed'; label: string }
  | { kind: 'slot_taken'; alternatives: Slot[] }
  | { kind: 'cancelled' };
