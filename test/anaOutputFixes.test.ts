import { describe, it, expect } from 'vitest';
import { stripDashTells, splitIntoBubbles } from '@/lib/ai/agent/agent.service';
import { probabilityForStage } from '@/lib/ai/agent/stage-evaluator';
import { slotLabelFromIso } from '@/lib/ai/scheduling/availability';

// #3/#6 — o travessão "—" denuncia IA; tem que sumir das mensagens da Ana.
describe('stripDashTells', () => {
  it('troca o travessão que separa orações por vírgula', () => {
    expect(stripDashTells('Qual dia funciona melhor pra você — segunda ou terça?')).toBe(
      'Qual dia funciona melhor pra você, segunda ou terça?',
    );
  });

  it('cobre en-dash, barra horizontal e travessão colado', () => {
    expect(stripDashTells('a–b')).toBe('a, b');
    expect(stripDashTells('a―b')).toBe('a, b');
    expect(stripDashTells('então—veja')).toBe('então, veja');
  });

  it('trata "--" usado como travessão', () => {
    expect(stripDashTells('isso -- aquilo')).toBe('isso, aquilo');
  });

  it('NÃO toca no hífen simples de datas e compostos', () => {
    expect(stripDashTells('a reunião é 13-07, plano bem-estar')).toBe('a reunião é 13-07, plano bem-estar');
  });

  it('não deixa vírgula solta no início/fim', () => {
    expect(stripDashTells('— pode ser')).toBe('pode ser');
    expect(stripDashTells('fechado —')).toBe('fechado');
  });
});

describe('splitIntoBubbles remove travessão em cada bolha', () => {
  it('bolha única', () => {
    expect(splitIntoBubbles('Segunda às 9h — pode ser?')).toEqual(['Segunda às 9h, pode ser?']);
  });

  it('múltiplas bolhas (linha em branco) cada uma limpa', () => {
    expect(splitIntoBubbles('Perfeito — fechado.\n\nO consultor liga segunda — às 10h.')).toEqual([
      'Perfeito, fechado.',
      'O consultor liga segunda, às 10h.',
    ]);
  });
});

// Probabilidade acompanha o avanço no funil (antes ficava 0% pra sempre).
describe('probabilityForStage', () => {
  it('mapeia os estágios do funil da SDR', () => {
    expect(probabilityForStage('novo-lead')).toBe(10);
    expect(probabilityForStage('em-qualificacao')).toBe(30);
    expect(probabilityForStage('qualificado')).toBe(60);
    expect(probabilityForStage('agendado')).toBe(90);
  });

  it('estágio desconhecido devolve null (não mexe no probability de outros boards)', () => {
    expect(probabilityForStage('resgate-no-show')).toBeNull();
    expect(probabilityForStage('qualquer-coisa')).toBeNull();
    expect(probabilityForStage(null)).toBeNull();
    expect(probabilityForStage(undefined)).toBeNull();
  });
});

// Reconstrói o label do horário já marcado (idempotência: reafirma sem re-marcar).
describe('slotLabelFromIso', () => {
  it('formata o ISO UTC no fuso SP (-03:00)', () => {
    // 2026-07-13 13:00Z = 10h SP (segunda)
    expect(slotLabelFromIso('2026-07-13T13:00:00.000Z', '-03:00')).toBe('segunda, 13/07, às 10h');
    // 2026-07-13 12:00Z = 9h SP
    expect(slotLabelFromIso('2026-07-13T12:00:00.000Z', '-03:00')).toBe('segunda, 13/07, às 9h');
  });

  it('sem ISO devolve um fallback neutro', () => {
    expect(slotLabelFromIso(null, '-03:00')).toBe('o horário combinado');
    expect(slotLabelFromIso(undefined, '-03:00')).toBe('o horário combinado');
  });
});
