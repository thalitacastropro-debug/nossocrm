/**
 * @fileoverview Motor de disponibilidade — função PURA.
 * Calcula slots livres = janela (dias úteis, horas candidatas) − busy − antecedência.
 * Fuso via offset fixo -03:00 (Brasil sem DST). Sem I/O, sem deps externas.
 * @module lib/ai/scheduling/availability
 */

import type { AvailabilityConfig, BusyInterval, Slot } from './types';

const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export interface GetAvailableSlotsParams {
  now: Date;
  busy: BusyInterval[];
  config: AvailabilityConfig;
}

/** epoch ms de um horário local SP (offset fixo). ex.: buildUtcMs(2026,7,1,9,'-03:00') */
function buildUtcMs(year: number, month: number, day: number, hour: number, offset: string): number {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  return new Date(`${year}-${mm}-${dd}T${hh}:00:00${offset}`).getTime();
}

/** Dia da semana (0=dom..6=sáb) do dia SP, avaliado ao meio-dia pra evitar borda de meia-noite. */
function weekdaySp(year: number, month: number, day: number, offset: string): number {
  const noonUtc = new Date(buildUtcMs(year, month, day, 12, offset));
  return noonUtc.getUTCDay();
}

/** Componentes {year,month,day} de um instante, no fuso SP (UTC-3). */
function spParts(ms: number): { year: number; month: number; day: number } {
  const d = new Date(ms - 3 * 60 * 60 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function overlaps(startMs: number, endMs: number, busy: BusyInterval[]): boolean {
  return busy.some((b) => startMs < b.endMs && endMs > b.startMs);
}

export function getAvailableSlots(params: GetAvailableSlotsParams): Slot[] {
  const { now, busy, config } = params;
  const nowMs = now.getTime();
  const minStartMs = nowMs + config.minLeadMinutes * 60 * 1000;
  const slotMs = config.slotMinutes * 60 * 1000;

  const slots: Slot[] = [];
  const startParts = spParts(nowMs);
  let cursor = new Date(buildUtcMs(startParts.year, startParts.month, startParts.day, 12, config.utcOffset));
  let businessDaysSeen = 0;

  while (businessDaysSeen < config.horizonBusinessDays && slots.length < config.maxSlots) {
    const { year, month, day } = spParts(cursor.getTime());
    const dow = weekdaySp(year, month, day, config.utcOffset);
    const isBusinessDay = dow >= 1 && dow <= 5;

    if (isBusinessDay) {
      businessDaysSeen++;
      for (const hour of config.candidateStartHours) {
        if (slots.length >= config.maxSlots) break;
        const startMs = buildUtcMs(year, month, day, hour, config.utcOffset);
        const endMs = startMs + slotMs;
        if (startMs < minStartMs) continue;
        if (overlaps(startMs, endMs, busy)) continue;
        slots.push({
          startIso: new Date(startMs).toISOString(),
          endIso: new Date(endMs).toISOString(),
          label: `${WEEKDAYS_PT[dow]}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}, às ${hour}h`,
        });
      }
    }
    // Avança 1 dia (SP) — soma 24h ao cursor (meio-dia → meio-dia, seguro).
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return slots;
}

/**
 * Reconstrói o label PT-BR ("segunda, 13/07, às 10h") de um horário já marcado, a partir
 * do ISO (UTC) gravado em `reuniao_agendada.data_hora`. Usado quando a reunião JÁ está
 * confirmada e precisamos reafirmar o horário sem re-marcar (idempotência do booker).
 * Mesmo fuso fixo do resto do módulo (offset -03:00).
 */
export function slotLabelFromIso(iso: string | undefined | null, utcOffset: string): string {
  if (!iso) return 'o horário combinado';
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(utcOffset);
  const offMin = m ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : -180;
  const local = new Date(new Date(iso).getTime() + offMin * 60 * 1000);
  const dow = local.getUTCDay();
  return `${WEEKDAYS_PT[dow]}, ${String(local.getUTCDate()).padStart(2, '0')}/${String(local.getUTCMonth() + 1).padStart(2, '0')}, às ${local.getUTCHours()}h`;
}
