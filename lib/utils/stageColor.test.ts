import { describe, it, expect } from 'vitest';
import { stageAccentHex, withAlpha, isEtapaDeAlerta } from './stageColor';

describe('stageAccentHex', () => {
  it('aceita o hex que está gravado no banco', () => {
    expect(stageAccentHex('#dc2626')).toBe('#dc2626');
    expect(stageAccentHex('#6366F1')).toBe('#6366f1');
  });

  it('traduz a classe Tailwind que o código legado esperava', () => {
    // O Kanban usava stage.color direto como className. Etapas antigas podem
    // ter 'bg-blue-500' gravado; não podem virar cinza por causa disso.
    expect(stageAccentHex('bg-blue-500')).toBe('#3b82f6');
    expect(stageAccentHex('bg-red-500')).toBe('#ef4444');
    expect(stageAccentHex('bg-emerald-500')).toBe('#10b981');
  });

  it('cai num cinza legível quando não sabe o que é', () => {
    expect(stageAccentHex(null)).toBe('#6b7280');
    expect(stageAccentHex(undefined)).toBe('#6b7280');
    expect(stageAccentHex('')).toBe('#6b7280');
    expect(stageAccentHex('roxo-lindo')).toBe('#6b7280');
  });

  it('expande hex de 3 dígitos', () => {
    expect(stageAccentHex('#f00')).toBe('#ff0000');
  });
});

describe('withAlpha', () => {
  it('converte hex em rgba com a transparência pedida', () => {
    expect(withAlpha('#dc2626', 0.1)).toBe('rgba(220, 38, 38, 0.1)');
  });

  it('funciona com o fallback', () => {
    expect(withAlpha(stageAccentHex(null), 1)).toBe('rgba(107, 114, 128, 1)');
  });
});

describe('isEtapaDeAlerta', () => {
  it('reconhece a etapa pintada com o vermelho de alerta', () => {
    expect(isEtapaDeAlerta('#dc2626')).toBe(true);
    expect(isEtapaDeAlerta('#DC2626')).toBe(true);
  });

  it('não marca as demais etapas — elas continuam como sempre foram', () => {
    expect(isEtapaDeAlerta('#3b82f6')).toBe(false); // Qualificação
    expect(isEtapaDeAlerta('#f97316')).toBe(false); // Negociação
    expect(isEtapaDeAlerta('#ef4444')).toBe(false); // Perdido: vermelho, mas não é o de alerta
    expect(isEtapaDeAlerta(null)).toBe(false);
  });
});
