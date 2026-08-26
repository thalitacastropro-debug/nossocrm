import { describe, it, expect } from 'vitest';
import {
  validarPremioFechado,
  precisaInformarPremio,
  lerPremioFechado,
  LIMITE_PREMIO_MENSAL,
} from '@/lib/deals/premioFechado';

/**
 * O prêmio do plano VENDIDO — o número que o CRM nunca guardou.
 *
 * `deals.value` nesta operação é a mensalidade que o lead paga no plano ANTIGO
 * (vem de `custom_fields.qualificacao.valor_pago_exato`, apurado pela Ana). Sem
 * o prêmio fechado, "Já ganho no mês" soma o plano velho e comissão nenhuma pode
 * ser calculada sem inventar número (niva-os-visao.md §1).
 */
describe('validarPremioFechado', () => {
  it('aceita prêmio e operadora, devolvendo o valor normalizado', () => {
    const r = validarPremioFechado({ premio_mensal: 2000, operadora: ' Bradesco ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.premio_mensal).toBe(2000);
    expect(r.valor.operadora).toBe('Bradesco');
    expect(r.valor.vigencia_em).toBeNull();
  });

  it('aceita valor em string com vírgula decimal (é o que o input manda)', () => {
    const r = validarPremioFechado({ premio_mensal: '1.234,50', operadora: 'AMIL' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.premio_mensal).toBe(1234.5);
  });

  it('recusa prêmio zerado — venda sem valor não fecha meta nenhuma', () => {
    const r = validarPremioFechado({ premio_mensal: 0, operadora: 'AMIL' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/maior que zero/i);
  });

  it('recusa prêmio negativo', () => {
    expect(validarPremioFechado({ premio_mensal: -10, operadora: 'AMIL' }).ok).toBe(false);
  });

  it('recusa prêmio absurdo — protege a meta do mês de um erro de digitação', () => {
    const r = validarPremioFechado({ premio_mensal: LIMITE_PREMIO_MENSAL + 1, operadora: 'AMIL' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/mensal/i);
  });

  it('recusa operadora vazia — sem ela a comissão não tem percentual', () => {
    const r = validarPremioFechado({ premio_mensal: 2000, operadora: '   ' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/operadora/i);
  });

  it('aceita vigência em formato ISO de data', () => {
    const r = validarPremioFechado({ premio_mensal: 2000, operadora: 'Porto Seguro', vigencia_em: '2026-09-01' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.vigencia_em).toBe('2026-09-01');
  });

  it('recusa vigência com data que não existe', () => {
    const r = validarPremioFechado({ premio_mensal: 2000, operadora: 'Porto Seguro', vigencia_em: '2026-02-31' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/vig[êe]ncia/i);
  });

  it('vigência vazia é ausência, não erro — nem toda venda já tem a data', () => {
    const r = validarPremioFechado({ premio_mensal: 2000, operadora: 'Porto Seguro', vigencia_em: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.vigencia_em).toBeNull();
  });
});

describe('precisaInformarPremio', () => {
  it('é verdadeiro no card carimbado como venda e sem prêmio — é a pendência da tela', () => {
    expect(precisaInformarPremio({ vendido_em: '2026-08-25T16:56:34.267Z', valor_na_venda: 350 })).toBe(true);
  });

  it('é falso quando o prêmio já foi informado', () => {
    expect(precisaInformarPremio({ vendido_em: '2026-08-25T16:56:34.267Z', premio_mensal: 2000 })).toBe(false);
  });

  it('é falso em card sem carimbo de venda — card comum não tem pendência de prêmio', () => {
    expect(precisaInformarPremio(undefined)).toBe(false);
    expect(precisaInformarPremio(null)).toBe(false);
    expect(precisaInformarPremio('venda' as unknown)).toBe(false);
  });

  it('prêmio zero ou negativo gravado no banco ainda é pendência', () => {
    expect(precisaInformarPremio({ vendido_em: 'x', premio_mensal: 0 })).toBe(true);
    expect(precisaInformarPremio({ vendido_em: 'x', premio_mensal: -5 })).toBe(true);
  });
});

describe('lerPremioFechado', () => {
  it('devolve os três campos do carimbo', () => {
    const p = lerPremioFechado({
      vendido_em: 'x',
      premio_mensal: 2000,
      operadora: 'Bradesco',
      vigencia_em: '2026-09-01',
    });
    expect(p).toEqual({ premio_mensal: 2000, operadora: 'Bradesco', vigencia_em: '2026-09-01' });
  });

  it('devolve null quando o carimbo não tem prêmio', () => {
    expect(lerPremioFechado({ vendido_em: 'x' })).toBeNull();
  });

  it('ignora prêmio não numérico gravado à mão no banco', () => {
    expect(lerPremioFechado({ vendido_em: 'x', premio_mensal: 'dois mil' })).toBeNull();
  });
});
