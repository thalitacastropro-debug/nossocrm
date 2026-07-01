import { describe, it, expect } from 'vitest';
import { getAvailableSlots } from '@/lib/ai/scheduling/availability';
import { NIVA_AVAILABILITY } from '@/lib/ai/scheduling/config';
import type { BusyInterval } from '@/lib/ai/scheduling/types';

// Helper: instante UTC a partir de horário local SP (offset fixo -03:00).
const sp = (iso: string) => new Date(`${iso}-03:00`);
const spMs = (iso: string) => sp(iso).getTime();

// "Agora" fixo: quarta 01/07/2026, 06:00 SP — cedo o bastante pra incluir o slot das 9h
// (com antecedência de 2h, o corte é 08:00). O corte de 2h tem teste dedicado abaixo.
const NOW = sp('2026-07-01T06:00:00');

describe('getAvailableSlots', () => {
  it('gera 8 slots hora-cheia no primeiro dia útil, respeitando almoço (sem 12h)', () => {
    const slots = getAvailableSlots({ now: NOW, busy: [], config: NIVA_AVAILABILITY });
    const day1 = slots.filter((s) => s.startIso.startsWith('2026-07-01'));
    const horas = day1.map((s) => new Date(s.startIso).getUTCHours() - 3); // -3 => hora SP
    expect(horas).toEqual([9, 10, 11, 13, 14, 15, 16, 17]);
  });

  it('respeita antecedência mínima de 2h', () => {
    // Agora = quarta 10:30 SP → primeiro slot do dia deve ser >= 12:30 SP => 13h.
    const now = sp('2026-07-01T10:30:00');
    const slots = getAvailableSlots({ now, busy: [], config: NIVA_AVAILABILITY });
    const day1 = slots.filter((s) => s.startIso.startsWith('2026-07-01'));
    const horas = day1.map((s) => new Date(s.startIso).getUTCHours() - 3);
    expect(horas).toEqual([13, 14, 15, 16, 17]);
  });

  it('pula fim de semana (sexta → segunda)', () => {
    const now = sp('2026-07-03T17:30:00'); // sexta, tarde
    const slots = getAvailableSlots({ now, busy: [], config: NIVA_AVAILABILITY });
    const dias = Array.from(new Set(slots.map((s) => s.startIso.slice(0, 10))));
    expect(dias).not.toContain('2026-07-04'); // sábado
    expect(dias).not.toContain('2026-07-05'); // domingo
    expect(dias[0]).toBe('2026-07-06'); // segunda
  });

  it('remove slot que colide (parcial) com um busy', () => {
    // Ocupado 10:20–10:50 SP colide com o slot das 10h (10:00–10:40).
    const busy: BusyInterval[] = [
      { startMs: spMs('2026-07-01T10:20:00'), endMs: spMs('2026-07-01T10:50:00') },
    ];
    const slots = getAvailableSlots({ now: NOW, busy, config: NIVA_AVAILABILITY });
    const day1 = slots.filter((s) => s.startIso.startsWith('2026-07-01'));
    const horas = day1.map((s) => new Date(s.startIso).getUTCHours() - 3);
    expect(horas).not.toContain(10);
    expect(horas).toContain(9);
    expect(horas).toContain(11);
  });

  it('respeita o teto maxSlots', () => {
    const slots = getAvailableSlots({ now: NOW, busy: [], config: NIVA_AVAILABILITY });
    expect(slots.length).toBeLessThanOrEqual(NIVA_AVAILABILITY.maxSlots);
  });

  it('label pt-BR legível', () => {
    const slots = getAvailableSlots({ now: NOW, busy: [], config: NIVA_AVAILABILITY });
    // 01/07/2026 é quarta.
    expect(slots[0].label).toBe('quarta, 01/07, às 9h');
  });
});
