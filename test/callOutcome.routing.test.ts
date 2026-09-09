import { describe, it, expect } from 'vitest';
import { routeForDesfecho, reabordarEmFallback, geraReabordagem } from '@/lib/ai/call-outcome/routing';
import { MOTIVO_TAGS } from '@/lib/ai/taxonomy/motivos';
import {
  IMPLANTACAO_ADM_BOARD_ID, IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID,
  NUTRICAO_REATIVACAO_BOARD_ID, NUTRICAO_RECONTATO_STAGE_ID, NEGOCIACAO_STAGE_ID,
} from '@/lib/config/boards';

describe('routeForDesfecho', () => {
  it('fechou → Implantação + won', () => {
    const r = routeForDesfecho('fechou');
    expect(r).toMatchObject({ boardId: IMPLANTACAO_ADM_BOARD_ID, stageId: IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID, mark: 'won', reabordagem: false });
  });
  it('perdeu → Nutrição + lost + reabordagem', () => {
    const r = routeForDesfecho('perdeu');
    expect(r).toMatchObject({ boardId: NUTRICAO_REATIVACAO_BOARD_ID, stageId: NUTRICAO_RECONTATO_STAGE_ID, mark: 'lost', reabordagem: true });
  });
  it('vai_pensar → Negociação (mesmo board), sem mark', () => {
    const r = routeForDesfecho('vai_pensar');
    expect(r).toMatchObject({ stageId: NEGOCIACAO_STAGE_ID, mark: null });
    expect(r.boardId).toBeUndefined();
  });
  it('remarcar / nao_atendeu não movem', () => {
    expect(routeForDesfecho('remarcar').stageId).toBeUndefined();
    expect(routeForDesfecho('nao_atendeu').stageId).toBeUndefined();
  });
});

describe('reabordarEmFallback', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  it('concorrente → +12 meses', () => {
    expect(reabordarEmFallback('concorrente', now)).toBe(new Date('2027-07-12T12:00:00.000Z').toISOString());
  });
  it('decisor → +2 semanas', () => {
    expect(reabordarEmFallback('decisor', now)).toBe(new Date('2026-07-26T12:00:00.000Z').toISOString());
  });
  it('outro → +3 meses', () => {
    expect(reabordarEmFallback('outro', now)).toBe(new Date('2026-10-12T12:00:00.000Z').toISOString());
  });
});

// Regra da Thalita (09/09/2026): todo perdido leva lembrete de reabordagem, MENOS quem nunca foi
// lead. Importa porque "Descartado" no funil da Ana serve para perda comercial E para engano — sem
// esta separação, um número errado (caso Natália Palmeira) ganharia tarefa de ligar em 2027.
describe('geraReabordagem', () => {
  it('engano (número errado) NÃO gera lembrete', () => {
    expect(geraReabordagem('engano')).toBe(false);
  });

  it('fora_icp NÃO gera lembrete (o tempo não muda a elegibilidade)', () => {
    expect(geraReabordagem('fora_icp')).toBe(false);
  });

  it('motivos comerciais geram lembrete', () => {
    for (const m of ['concorrente', 'ficou_na_atual', 'timing', 'decisor', 'outro'] as const) {
      expect(geraReabordagem(m)).toBe(true);
    }
  });

  // Trava de completude: tag nova na taxonomia tem que ser decidida aqui de propósito, não herdar
  // "gera lembrete" por omissão — senão a próxima categoria de não-lead volta a entulhar a agenda.
  it('toda tag da taxonomia tem decisão explícita, e só 2 ficam de fora', () => {
    const semLembrete = MOTIVO_TAGS.filter((m) => !geraReabordagem(m));
    expect(semLembrete).toEqual(['fora_icp', 'engano']);
  });
});
