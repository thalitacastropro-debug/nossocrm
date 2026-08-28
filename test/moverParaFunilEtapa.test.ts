import { describe, it, expect } from 'vitest';
import { resolverEtapaDoMove } from '@/lib/deals/moverParaFunil';

/**
 * "Não tem em qual etapa mover o lead" (Thalita, 28/08/2026).
 *
 * O move entre funis sempre jogava o card na PRIMEIRA etapa do funil de destino. No
 * Comercial, a primeira etapa é **"Call Agendada"** — então um lead que o consultor quer
 * apenas LIGAR (o caso da Flavia: o Denilson quis tirar da Ana e telefonar) aterrissava
 * como se já tivesse reunião marcada, sujando o funil e a métrica de agendamentos.
 *
 * Agora quem move ESCOLHE a etapa; a primeira continua sendo o padrão quando ninguém
 * escolhe (o comportamento antigo, para não quebrar os outros caminhos).
 */
const ETAPAS_COMERCIAL = [
  { id: 'etapa-call-agendada', name: 'call-agendada', label: 'Call Agendada' },
  { id: 'etapa-qualificacao', name: 'qualificacao', label: 'Qualificação' },
  { id: 'etapa-negociacao', name: 'negociacao', label: 'Negociação' },
];

describe('resolverEtapaDoMove', () => {
  it('usa a etapa escolhida quando ela pertence ao funil de destino', () => {
    const r = resolverEtapaDoMove(
      { id: 'board-comercial', name: 'Comercial', stages: ETAPAS_COMERCIAL },
      'etapa-qualificacao',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stageId).toBe('etapa-qualificacao');
  });

  it('sem escolha, cai na primeira etapa (comportamento antigo)', () => {
    const r = resolverEtapaDoMove(
      { id: 'board-comercial', name: 'Comercial', stages: ETAPAS_COMERCIAL },
      undefined,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stageId).toBe('etapa-call-agendada');
  });

  it('RECUSA etapa que não é do funil de destino — é o que criava card órfão', () => {
    const r = resolverEtapaDoMove(
      { id: 'board-comercial', name: 'Comercial', stages: ETAPAS_COMERCIAL },
      'etapa-de-outro-funil',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/etapa/i);
  });

  it('funil sem etapas dá erro explicando o que fazer, não silêncio', () => {
    const r = resolverEtapaDoMove({ id: 'board-vazio', name: 'Novo Funil', stages: [] }, undefined);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/Novo Funil/);
    expect(r.erro).toMatch(/etapa/i);
  });

  it('funil sem o array de etapas carregado também é erro claro', () => {
    const r = resolverEtapaDoMove({ id: 'b', name: 'Funil X' }, undefined);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/Funil X/);
  });
});
