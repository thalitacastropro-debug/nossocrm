import { describe, it, expect } from 'vitest';
import { conferirCoerenciaDoMove } from '@/lib/deals/coerenciaDoMove';

/**
 * O CARD ÓRFÃO de 27/08/2026 (Richard Gois).
 *
 * Cadeia real: às 10:49 o desfecho da call moveu o card da Implantação para a Nutrição
 * (mudou `board_id` no servidor). A TELA de quem operava continuou mostrando o card na
 * Implantação. Às 10:50 ele foi marcado como perdido na etapa "Cancelado" — que é da
 * IMPLANTAÇÃO — e o `stage_id` foi gravado por cima de um `board_id` que já era da
 * Nutrição. Resultado: `board_id` de um funil + `stage_id` de outro = card que não
 * renderiza em kanban NENHUM. Só apareceu por SQL.
 *
 * A defesa é falhar ALTO: melhor um "recarregue a página" do que um card sumido.
 */
describe('conferirCoerenciaDoMove', () => {
  const BOARD_IMPLANTACAO = {
    id: 'board-implantacao',
    stages: [{ id: 'etapa-cancelado' }, { id: 'etapa-analise' }],
  };

  it('deixa passar o move normal (card e tela no mesmo funil)', () => {
    const r = conferirCoerenciaDoMove({
      deal: { boardId: 'board-implantacao' },
      board: BOARD_IMPLANTACAO,
      targetStageId: 'etapa-analise',
    });
    expect(r.ok).toBe(true);
  });

  it('BLOQUEIA quando o card já saiu do funil que a tela mostra — o caso do Richard', () => {
    const r = conferirCoerenciaDoMove({
      deal: { boardId: 'board-nutricao' },       // servidor já moveu o card
      board: BOARD_IMPLANTACAO,                   // tela ainda mostra a Implantação
      targetStageId: 'etapa-cancelado',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/recarregue/i);
  });

  it('BLOQUEIA etapa que não pertence ao funil da tela', () => {
    const r = conferirCoerenciaDoMove({
      deal: { boardId: 'board-implantacao' },
      board: BOARD_IMPLANTACAO,
      targetStageId: 'etapa-de-outro-funil',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toMatch(/etapa/i);
  });

  it('card sem boardId conhecido não trava a operação (só a etapa é exigida)', () => {
    // Deal recém-criado no cache pode não ter boardId ainda; travar aqui seria pior que
    // o problema — a etapa continua sendo validada.
    const r = conferirCoerenciaDoMove({
      deal: { boardId: undefined },
      board: BOARD_IMPLANTACAO,
      targetStageId: 'etapa-analise',
    });
    expect(r.ok).toBe(true);
  });
});
