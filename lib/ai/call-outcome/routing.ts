/**
 * Roteamento puro do desfecho → board/stage/flag + fallback de reabordagem (§6/§6.1).
 */
import type { Desfecho } from './schemas';
import type { MotivoTag } from '@/lib/ai/taxonomy/motivos';
import {
  IMPLANTACAO_ADM_BOARD_ID, IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID,
  NUTRICAO_REATIVACAO_BOARD_ID, NUTRICAO_RECONTATO_STAGE_ID, NEGOCIACAO_STAGE_ID,
} from '@/lib/config/boards';

export interface Route {
  boardId?: string;      // undefined = mesmo board
  stageId?: string;      // undefined = não move
  mark: 'won' | 'lost' | null;
  reabordagem: boolean;  // true = criar lembrete de reabordagem
}

export function routeForDesfecho(desfecho: Desfecho['desfecho']): Route {
  switch (desfecho) {
    case 'fechou':
      return { boardId: IMPLANTACAO_ADM_BOARD_ID, stageId: IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID, mark: 'won', reabordagem: false };
    case 'perdeu':
      return { boardId: NUTRICAO_REATIVACAO_BOARD_ID, stageId: NUTRICAO_RECONTATO_STAGE_ID, mark: 'lost', reabordagem: true };
    case 'vai_pensar':
      return { stageId: NEGOCIACAO_STAGE_ID, mark: null, reabordagem: false };
    default: // remarcar, nao_atendeu
      return { mark: null, reabordagem: false };
  }
}

// Fallback de meses por motivo (§6.1). A IA prioriza o sinal real (reabordar_em do schema).
const REABORDAR_MESES: Record<MotivoTag, number> = {
  sem_oportunidade: 6,
  ficou_na_atual: 11,
  carencia: 3,
  rede: 6,
  concorrente: 12,
  timing: 1,
  reembolso: 6,
  confianca: 2,
  burocracia: 1,
  sem_resposta: 1,
  fora_icp: 6,
  decisor: 0, // tratado como +2 semanas abaixo
  outro: 3,
};

export function reabordarEmFallback(motivo: MotivoTag, now: Date): string {
  const d = new Date(now.getTime());
  if (motivo === 'decisor') {
    d.setUTCDate(d.getUTCDate() + 14);
    return d.toISOString();
  }
  d.setUTCMonth(d.getUTCMonth() + REABORDAR_MESES[motivo]);
  return d.toISOString();
}
