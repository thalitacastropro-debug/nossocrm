import { describe, it, expect } from 'vitest';
import { ehEtapaDeGanho } from '@/lib/deals/etapaDeGanho';
import { faltaOperadoraDaVenda, precisaInformarPremio } from '@/lib/deals/premioFechado';
import type { Board } from '@/types';

const board = (extra: Partial<Board>): Board =>
  ({
    id: 'b1',
    name: 'Comercial — Consultor',
    stages: [
      { id: 's1', label: 'Qualificação', linkedLifecycleStage: null },
      { id: 's2', label: 'Fechado/Ganho', linkedLifecycleStage: 'CUSTOMER' },
      { id: 's3', label: 'Perdido', linkedLifecycleStage: 'OTHER' },
    ],
    ...extra,
  }) as unknown as Board;

/**
 * A regra "mover para esta etapa é fechar a venda?" precisa dar a MESMA resposta na tela (que
 * pergunta o valor antes de mover) e no `useMoveDeal` (que liga `is_won`). Divergir para o lado
 * errado é a venda voltando a nascer sem prêmio, em silêncio.
 */
describe('ehEtapaDeGanho', () => {
  it('quando o funil declara wonStageId, é ELE quem manda', () => {
    const b = board({ wonStageId: 's2' } as Partial<Board>);
    expect(ehEtapaDeGanho(b, 's2')).toBe(true);
    expect(ehEtapaDeGanho(b, 's1')).toBe(false);
  });

  it('wonStageId configurado silencia o palpite por ciclo de vida', () => {
    // 's1' é CUSTOMER mas o funil diz que a etapa de ganho é outra: não é venda.
    const b = board({
      wonStageId: 's9',
      stages: [{ id: 's1', label: 'Etapa', linkedLifecycleStage: 'CUSTOMER' }],
    } as Partial<Board>);
    expect(ehEtapaDeGanho(b, 's1')).toBe(false);
  });

  it('sem wonStageId, cai no ciclo de vida CUSTOMER (funis antigos)', () => {
    expect(ehEtapaDeGanho(board({}), 's2')).toBe(true);
    expect(ehEtapaDeGanho(board({}), 's1')).toBe(false);
  });

  it('funil que É de clientes não vende ao mover: lá toda etapa é CUSTOMER', () => {
    const b = board({ linkedLifecycleStage: 'CUSTOMER' } as Partial<Board>);
    expect(ehEtapaDeGanho(b, 's2')).toBe(false);
  });

  it('sem funil, não é ganho (e não estoura)', () => {
    expect(ehEtapaDeGanho(null, 's2')).toBe(false);
    expect(ehEtapaDeGanho(undefined, 's2')).toBe(false);
  });
});

/**
 * As duas metades da pendência do plano vendido. Desde que a confirmação no move grava o prêmio
 * sozinho, "tem prêmio" deixou de implicar "tem operadora" — e é a operadora que define o
 * percentual da comissão.
 */
describe('pendências do plano vendido', () => {
  it('prêmio sem operadora: sai da cobrança do prêmio, entra na da operadora', () => {
    const venda = { premio_mensal: 1850 };
    expect(precisaInformarPremio(venda)).toBe(false);
    expect(faltaOperadoraDaVenda(venda)).toBe(true);
  });

  it('com prêmio e operadora, nenhuma das duas cobra', () => {
    const venda = { premio_mensal: 1850, operadora: 'Bradesco Saúde' };
    expect(precisaInformarPremio(venda)).toBe(false);
    expect(faltaOperadoraDaVenda(venda)).toBe(false);
  });

  it('sem prêmio, quem cobra é o selo do prêmio — não se pede operadora de venda sem valor', () => {
    const venda = { vendedor_id: 'x' };
    expect(precisaInformarPremio(venda)).toBe(true);
    expect(faltaOperadoraDaVenda(venda)).toBe(false);
  });

  it('card sem venda nenhuma não cobra nada', () => {
    expect(precisaInformarPremio(undefined)).toBe(false);
    expect(faltaOperadoraDaVenda(undefined)).toBe(false);
  });
});
