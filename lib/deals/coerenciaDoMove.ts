/**
 * @fileoverview Trava contra CARD ÓRFÃO: `board_id` de um funil + `stage_id` de outro.
 *
 * O card fica invisível quando os dois discordam — o kanban do funil A não acha coluna
 * para uma etapa do funil B, e o funil B não busca um card cujo `board_id` é o A. Foi
 * exatamente o que engoliu o card do Richard Gois em 27/08/2026:
 *
 *   10:49 — o desfecho da call moveu o card da Implantação para a Nutrição (servidor).
 *   10:50 — a tela, ainda mostrando a Implantação, marcou o card como perdido na etapa
 *           "Cancelado" (da Implantação). O update gravou só `stage_id`, por cima de um
 *           `board_id` que já era da Nutrição.
 *
 * `useMoveDeal` nunca escreve `boardId` (mover de funil é outro caminho), e a etapa-alvo
 * vem do objeto Board que a TELA passou — não do funil onde o card está no servidor. Sem
 * esta conferência, cache desatualizado vira corrupção silenciosa.
 *
 * A regra é falhar ALTO: um "recarregue a página" é muito melhor do que um card que some
 * da operação sem ninguém perceber.
 *
 * @module lib/deals/coerenciaDoMove
 */

export interface EntradaCoerenciaDoMove {
  /** O card como a tela o conhece. `boardId` pode faltar em card recém-criado no cache. */
  deal: { boardId?: string | null };
  /** O funil que a TELA está mostrando, com as etapas dele. */
  board: { id: string; stages: Array<{ id: string }> };
  /** Etapa de destino escolhida na tela. */
  targetStageId: string;
}

export type ResultadoCoerencia = { ok: true } | { ok: false; erro: string };

export const conferirCoerenciaDoMove = ({
  deal,
  board,
  targetStageId,
}: EntradaCoerenciaDoMove): ResultadoCoerencia => {
  // 1) A etapa tem que ser DESTE funil. Sem isto, gravar `stage_id` de outro board é
  // possível mesmo com o card no lugar certo.
  if (!board.stages.some((s) => s.id === targetStageId)) {
    return {
      ok: false,
      erro: 'Esta etapa não pertence a este funil. Recarregue a página e tente de novo.',
    };
  }

  // 2) O card ainda está NESTE funil? `boardId` ausente não trava: card recém-criado no
  // cache pode não tê-lo, e travar aí seria pior que o problema (a etapa já foi validada).
  if (deal.boardId && deal.boardId !== board.id) {
    return {
      ok: false,
      erro: 'Este card já foi movido para outro funil. Recarregue a página para ver onde ele está.',
    };
  }

  return { ok: true };
};
