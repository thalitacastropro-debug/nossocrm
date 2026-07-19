import { describe, it, expect } from 'vitest';
import { getCurrentMonthRange, countScheduledMeetings } from '@/lib/boards/goalMetrics';

describe('getCurrentMonthRange', () => {
  it('cobre do 1º dia 00:00 ao último dia 23:59 do mês da data dada', () => {
    // 18/07/2026 (mês de 31 dias)
    const { start, end } = getCurrentMonthRange(new Date(2026, 6, 18, 15, 30));
    expect(new Date(start).getFullYear()).toBe(2026);
    expect(new Date(start).getMonth()).toBe(6); // julho
    expect(new Date(start).getDate()).toBe(1);
    expect(new Date(end).getMonth()).toBe(6);
    expect(new Date(end).getDate()).toBe(31); // último dia de julho
  });

  it('vira o ano correto em dezembro (fim = 31/12, não janeiro)', () => {
    const { end } = getCurrentMonthRange(new Date(2026, 11, 5));
    expect(new Date(end).getFullYear()).toBe(2026);
    expect(new Date(end).getMonth()).toBe(11);
    expect(new Date(end).getDate()).toBe(31);
  });

  it('fevereiro de ano não-bissexto termina no dia 28', () => {
    const { end } = getCurrentMonthRange(new Date(2026, 1, 10));
    expect(new Date(end).getDate()).toBe(28);
  });
});

describe('countScheduledMeetings', () => {
  it('conta só atividades CALL', () => {
    const acts = [
      { type: 'CALL' },
      { type: 'MEETING' },
      { type: 'CALL' },
      { type: 'NOTE' },
      { type: 'STATUS_CHANGE' },
    ];
    expect(countScheduledMeetings(acts)).toBe(2);
  });

  it('lista vazia => 0', () => {
    expect(countScheduledMeetings([])).toBe(0);
  });
});
