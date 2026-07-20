import { describe, it, expect } from 'vitest';
import { buildRescueMessage } from '@/lib/ai/scheduling/no-show-message';
import type { Slot } from '@/lib/ai/scheduling/types';

const slot = (label: string): Slot => ({ startIso: '2026-07-20T18:00:00.000Z', endIso: '2026-07-20T18:40:00.000Z', label });

describe('buildRescueMessage', () => {
  it('2+ slots → oferece os 2 primeiros com "qual fica melhor?"', () => {
    const msg = buildRescueMessage('Ana', [slot('segunda, 20/07, às 15h'), slot('terça, 21/07, às 9h'), slot('quarta, 22/07, às 10h')]);
    expect(msg).toContain('Oi Ana,');
    expect(msg).toContain('segunda, 20/07, às 15h');
    expect(msg).toContain('terça, 21/07, às 9h');
    expect(msg).not.toContain('quarta, 22/07, às 10h'); // só os 2 primeiros
    expect(msg).toContain('Qual fica melhor');
  });

  it('1 slot → oferece o único com "te serve?"', () => {
    const msg = buildRescueMessage('João', [slot('sexta, 24/07, às 16h')]);
    expect(msg).toContain('sexta, 24/07, às 16h');
    expect(msg).toContain('Te serve?');
  });

  it('0 slots → fallback pro texto genérico (sem oferecer horário)', () => {
    const msg = buildRescueMessage('Maria', []);
    expect(msg).toContain('Consigo reagendar pra gente não perder essa conversa.');
    expect(msg).not.toContain('encaixar');
    expect(msg).not.toContain('Qual fica melhor');
  });

  it('sem nome → começa com "O consultor" (maiúsculo), sem saudação', () => {
    const msg = buildRescueMessage(null, []);
    expect(msg.startsWith('O consultor tentou')).toBe(true);
    expect(msg).not.toContain('Oi ');
  });
});
