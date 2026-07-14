import { describe, it, expect } from 'vitest';
import { COLD_TOUCHES, WARM_FALLBACK, WARM_FIXED_LAST_INDEX, FOLLOWUP_TAG, renderBubbles, firstName } from '@/lib/ai/followup/copy';
import { COLD_SCHEDULE_MS, WARM_SCHEDULE_MS } from '@/lib/ai/followup/schedule';

describe('estrutura da copy', () => {
  it('tem 1 bloco de copy por toque de cada schedule', () => {
    expect(COLD_TOUCHES).toHaveLength(COLD_SCHEDULE_MS.length);
    expect(WARM_FALLBACK).toHaveLength(WARM_SCHEDULE_MS.length);
  });
  it('o último toque quente é o índice fixo', () => {
    expect(WARM_FIXED_LAST_INDEX).toBe(WARM_SCHEDULE_MS.length - 1);
  });
  it('sem emoji e sem travessão na copy', () => {
    const all = COLD_TOUCHES.flat().join(' ') + ' ' + WARM_FALLBACK.join(' ');
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
  it('a tag é sem-resposta', () => expect(FOLLOWUP_TAG).toBe('sem-resposta'));
});

describe('renderBubbles', () => {
  it('interpola {nome} e junta bolhas com linha em branco', () => {
    const out = renderBubbles(['Oi {nome}, tudo bem?', 'Segunda bolha.'], 'Maria Silva');
    expect(out).toBe('Oi Maria, tudo bem?\n\nSegunda bolha.');
  });
  it('sem nome, limpa a pontuação órfã', () => {
    const out = renderBubbles(['Oi {nome}, consegue falar?'], null);
    expect(out).toBe('Oi, consegue falar?');
  });
});

describe('firstName', () => {
  it('pega só o primeiro nome', () => expect(firstName('João Pedro Souza')).toBe('João'));
  it('trata vazio', () => expect(firstName(null)).toBe(''));
});
