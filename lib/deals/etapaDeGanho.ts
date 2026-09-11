/**
 * @fileoverview "Mover para ESTA etapa é fechar a venda?" — a pergunta, num lugar só.
 *
 * A regra já existia dentro do `useMoveDeal` (é ela que liga `is_won`). Virou módulo em
 * 11/09/2026, quando a TELA passou a precisar da mesma resposta ANTES de mover, para perguntar
 * ao consultor se o valor do card é o valor da venda.
 *
 * Duas cópias da regra seria o pior desfecho possível: a tela perguntaria o prêmio de um move
 * que não carimba venda nenhuma, ou — o lado caro — deixaria de perguntar justamente no move que
 * carimba, e a venda voltaria a nascer sem prêmio sem ninguém notar.
 *
 * @module lib/deals/etapaDeGanho
 */

import type { Board } from '@/types';

/**
 * Precedência deliberada (mesma do `useMoveDeal`): quando o funil declara `wonStageId`, é ELE
 * quem manda e o `linkedLifecycleStage` não opina. O palpite por ciclo de vida é só o fallback
 * dos funis antigos, que não têm etapa de ganho configurada.
 *
 * O `board.linkedLifecycleStage !== 'CUSTOMER'` do fallback existe porque num funil que é
 * inteiro de clientes (Clientes Ativos) TODA etapa é 'CUSTOMER' — ali, mover não é vender.
 */
export const ehEtapaDeGanho = (board: Board | null | undefined, targetStageId: string): boolean => {
  if (!board) return false;
  if (board.wonStageId) return targetStageId === board.wonStageId;
  const targetStage = board.stages?.find((s) => s.id === targetStageId);
  return (
    board.linkedLifecycleStage !== 'CUSTOMER' &&
    targetStage?.linkedLifecycleStage === 'CUSTOMER'
  );
};
