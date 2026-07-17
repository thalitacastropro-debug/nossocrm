import { describe, it, expect } from 'vitest';
import { validateDetectedSlot, mesmoSlot } from '@/lib/ai/scheduling/detect';
import type { Slot } from '@/lib/ai/scheduling/types';

const offered: Slot[] = [
  { startIso: '2026-07-03T13:00:00.000Z', endIso: '2026-07-03T13:40:00.000Z', label: 'quinta, 03/07, às 10h' },
  { startIso: '2026-07-03T17:00:00.000Z', endIso: '2026-07-03T17:40:00.000Z', label: 'quinta, 03/07, às 14h' },
];

describe('validateDetectedSlot', () => {
  it('aceita quando o slotIso bate exatamente com um oferecido', () => {
    expect(validateDetectedSlot('2026-07-03T13:00:00.000Z', offered)?.label).toBe('quinta, 03/07, às 10h');
  });
  it('rejeita horário não oferecido (anti-alucinação)', () => {
    expect(validateDetectedSlot('2026-07-03T20:00:00.000Z', offered)).toBeNull();
  });
  it('rejeita null', () => {
    expect(validateDetectedSlot(null, offered)).toBeNull();
  });
  it('tolera diferença de milissegundos/segundos no mesmo minuto', () => {
    expect(validateDetectedSlot('2026-07-03T13:00:30.000Z', offered)?.label).toBe('quinta, 03/07, às 10h');
  });
});

describe('mesmoSlot', () => {
  it('true quando é o mesmo minuto (tolera segundos/millis)', () => {
    expect(mesmoSlot('2026-07-20T18:00:00.000Z', '2026-07-20T18:00:59.999Z')).toBe(true);
  });

  it('false quando é outro horário — o caso Nathalia (sex 17h marcado, seg 15h aceito)', () => {
    expect(mesmoSlot('2026-07-20T18:00:00.000Z', '2026-07-17T20:00:00.000Z')).toBe(false);
  });

  it('false com null/undefined/lixo (nunca reafirma o que não dá pra comparar)', () => {
    expect(mesmoSlot(null, '2026-07-20T18:00:00.000Z')).toBe(false);
    expect(mesmoSlot('2026-07-20T18:00:00.000Z', undefined)).toBe(false);
    expect(mesmoSlot('não-é-data', '2026-07-20T18:00:00.000Z')).toBe(false);
  });
});
