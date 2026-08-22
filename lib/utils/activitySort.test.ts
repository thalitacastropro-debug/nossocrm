import { describe, it, expect } from 'vitest';
import { sortActivitiesSmart, sortActivitiesTimeline } from './activitySort';
import type { Activity } from '@/types';

const act = (id: string, date: string, type: Activity['type'] = 'NOTE', completed = true): Activity =>
  ({ id, title: id, type, date, completed, dealId: 'deal-1' } as Activity);

describe('sortActivitiesTimeline — timeline do card', () => {
  it('poe a atividade mais recente primeiro', () => {
    const ontem = act('ontem', '2026-08-20T12:00:00.000Z');
    const hojeCedo = act('hoje-cedo', '2026-08-21T14:47:00.000Z');
    const hojeTarde = act('hoje-tarde', '2026-08-21T18:25:00.000Z');
    const julho = act('julho', '2026-07-13T15:21:00.000Z', 'STATUS_CHANGE');

    const ordenada = sortActivitiesTimeline([julho, hojeCedo, ontem, hojeTarde]);

    expect(ordenada.map((a) => a.id)).toEqual(['hoje-tarde', 'hoje-cedo', 'ontem', 'julho']);
  });

  it('a nota recem-escrita fica no topo, nao no rodape', () => {
    // Caso real: card da Josiane. Antes, a nota de hoje caia depois de tudo.
    const timeline = [
      act('moveu-julho', '2026-07-13T18:21:00.000Z', 'STATUS_CHANGE'),
      act('ligacao', '2026-07-22T14:00:00.000Z', 'CALL', false),
      act('moveu-hoje', '2026-08-21T17:16:00.000Z', 'STATUS_CHANGE'),
      act('nota-do-pedro', '2026-08-21T17:47:00.000Z'),
    ];

    expect(sortActivitiesTimeline(timeline)[0].id).toBe('nota-do-pedro');
  });

  it('nao altera o array recebido', () => {
    const entrada = [act('a', '2026-08-01T10:00:00.000Z'), act('b', '2026-08-02T10:00:00.000Z')];
    const copia = [...entrada];
    sortActivitiesTimeline(entrada);
    expect(entrada).toEqual(copia);
  });

  it('data invalida vai para o fim em vez de baguncar a ordem', () => {
    const ordenada = sortActivitiesTimeline([
      act('quebrada', 'nao-e-data'),
      act('boa', '2026-08-21T10:00:00.000Z'),
    ]);
    expect(ordenada.map((a) => a.id)).toEqual(['boa', 'quebrada']);
  });
});

describe('sortActivitiesSmart — lista de tarefas (NAO muda)', () => {
  it('mantem atrasada antes de futura, porque a pagina Atividades depende disso', () => {
    const atrasada = act('atrasada', '2020-01-01T10:00:00.000Z', 'TASK', false);
    const futura = act('futura', '2090-01-01T10:00:00.000Z', 'TASK', false);

    expect(sortActivitiesSmart([futura, atrasada]).map((a) => a.id)).toEqual(['atrasada', 'futura']);
  });
});
