import { describe, it, expect } from 'vitest';
import { COLD_SCHEDULE_MS, WARM_SCHEDULE_MS } from '@/lib/ai/followup/schedule';
import { COLD_TOUCHES, WARM_FALLBACK } from '@/lib/ai/followup/copy';
import { TOQUES } from '@/features/settings/components/ai/FollowupAnexoSection';

const DIA = 24 * 60 * 60 * 1000;

/**
 * A cadência de 3 dias (Thalita, 09/09/2026) vive espalhada em QUATRO lugares que precisam
 * concordar: os prazos, os textos, a lista da Central de I.A e o teto da rota de anexo. Quando ela
 * caiu de 10 para 3 dias, três desses lugares passariam a mentir em silêncio — a tela continuaria
 * oferecendo "4º toque — 10 dias" para um toque que não existe mais, e a rota aceitaria anexo para
 * ele. Estes testes existem para que a próxima mudança de cadência quebre em vez de mentir.
 */
describe('cadência de 3 dias — as quatro fontes têm que concordar', () => {
  it('fria: 3 toques, fechando em 3 dias', () => {
    expect(COLD_SCHEDULE_MS).toHaveLength(3);
    expect(COLD_SCHEDULE_MS[COLD_SCHEDULE_MS.length - 1]).toBe(3 * DIA);
  });

  it('quente: 3 toques, fechando em 3 dias', () => {
    expect(WARM_SCHEDULE_MS).toHaveLength(3);
    expect(WARM_SCHEDULE_MS[WARM_SCHEDULE_MS.length - 1]).toBe(3 * DIA);
  });

  it('há exatamente um texto por toque nas duas cadências', () => {
    expect(COLD_TOUCHES).toHaveLength(COLD_SCHEDULE_MS.length);
    expect(WARM_FALLBACK).toHaveLength(WARM_SCHEDULE_MS.length);
  });

  it('a lista da Central de I.A cobre os toques que existem, e só eles', () => {
    expect(TOQUES).toHaveLength(COLD_SCHEDULE_MS.length);
    expect(TOQUES.map((t) => t.index)).toEqual(COLD_SCHEDULE_MS.map((_, i) => i));
  });

  it('o último toque da fria é a despedida — é ele que encerra e entrega ao consultor', () => {
    const ultimo = COLD_TOUCHES[COLD_TOUCHES.length - 1].join(' ');
    expect(ultimo).toContain('Paro por aqui');
  });

  it('nenhum texto promete prazo que a cadência não cumpre mais', () => {
    const todos = COLD_TOUCHES.flat().join(' ') + ' ' + WARM_FALLBACK.join(' ');
    expect(todos).not.toMatch(/10 dias|4 dias|5 dias/);
  });
});
