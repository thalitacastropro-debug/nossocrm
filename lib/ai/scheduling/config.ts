/**
 * @fileoverview Config do agendamento, gated por board (só a Niva por ora).
 * Mesmo padrão do domain-extraction/registry: quando o CRM virar multi-cliente,
 * trocar este lookup por leitura de board_ai_config.
 * @module lib/ai/scheduling/config
 */

import type { AvailabilityConfig } from './types';
import { NIVA_SDR_BOARD_ID } from '../extraction/domain/niva-health';

/** Config padrão da Niva (§2 da spec). */
export const NIVA_AVAILABILITY: AvailabilityConfig = {
  utcOffset: '-03:00',
  candidateStartHours: [9, 10, 11, 13, 14, 15, 16, 17], // 12h cai no almoço
  slotMinutes: 40,
  minLeadMinutes: 120,
  horizonBusinessDays: 5,
  maxSlots: 12,
};

export interface SchedulingConfig {
  availability: AvailabilityConfig;
}

/** Retorna config de agendamento aplicável ao board, ou null (zero impacto noutras boards). */
export function getSchedulingConfig(boardId: string | null | undefined): SchedulingConfig | null {
  if (boardId === NIVA_SDR_BOARD_ID) return { availability: NIVA_AVAILABILITY };
  return null;
}
