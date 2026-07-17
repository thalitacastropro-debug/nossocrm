import { describe, it, expect } from 'vitest';
import { easterSunday, isFeriado } from '@/lib/ai/scheduling/holidays';
import { getAvailableSlots } from '@/lib/ai/scheduling/availability';
import { NIVA_AVAILABILITY } from '@/lib/ai/scheduling/config';

describe('easterSunday', () => {
  it('calcula o Domingo de Páscoa (Meeus/Butcher)', () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 });
  });
});

describe('isFeriado', () => {
  it('pega os feriados FIXOS', () => {
    expect(isFeriado(2026, 9, 7)).toBe(true);   // Independência — o bug real
    expect(isFeriado(2026, 12, 25)).toBe(true); // Natal
    expect(isFeriado(2027, 1, 1)).toBe(true);   // Confraternização
    expect(isFeriado(2026, 11, 20)).toBe(true); // Consciência Negra (nacional desde 2024)
  });

  it('pega os feriados MÓVEIS derivados da Páscoa de 2026 (05/04)', () => {
    expect(isFeriado(2026, 2, 17)).toBe(true); // Carnaval (Páscoa -47)
    expect(isFeriado(2026, 4, 3)).toBe(true);  // Sexta-feira Santa (Páscoa -2)
    expect(isFeriado(2026, 6, 4)).toBe(true);  // Corpus Christi (Páscoa +60)
  });

  it('não marca dia comum como feriado', () => {
    expect(isFeriado(2026, 9, 8)).toBe(false);
    expect(isFeriado(2026, 7, 20)).toBe(false);
    expect(isFeriado(2026, 2, 18)).toBe(false); // quarta de cinzas não é feriado nacional
  });
});

describe('getAvailableSlots x feriado', () => {
  it('NÃO oferta 07/09/2026 (Independência, uma segunda-feira) — regressão do bug real', () => {
    // quinta 03/09/2026 14h SP. Sem este fix, a lista traz "segunda, 07/09, às 9h".
    const now = new Date('2026-09-03T17:00:00.000Z');
    const slots = getAvailableSlots({ now, busy: [], config: NIVA_AVAILABILITY });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => s.label.includes('07/09'))).toBe(false);
  });

  it('o horizonte PULA o feriado em vez de encurtar (08/09 continua ofertável)', () => {
    const now = new Date('2026-09-03T17:00:00.000Z');
    const slots = getAvailableSlots({ now, busy: [], config: NIVA_AVAILABILITY });
    expect(slots.some((s) => s.label.includes('08/09'))).toBe(true);
  });
});
