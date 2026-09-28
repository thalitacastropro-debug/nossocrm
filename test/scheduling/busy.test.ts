import { describe, it, expect } from 'vitest';
import { loadBusyIntervals } from '@/lib/ai/scheduling/busy';
import { NIVA_AVAILABILITY } from '@/lib/ai/scheduling/config';

/**
 * SÓ REUNIÃO OCUPA HORÁRIO (21/09/2026).
 *
 * `loadBusyIntervals` não filtrava por tipo: qualquer activity do dono na janela virava horário
 * ocupado. Passou despercebido enquanto a agenda lida era a do consultor fixo da board, que quase
 * não tem activity. Virou problema quando a agenda passou a ser a do DONO DO CARD: as TASKs de
 * "Reabordar lead (reativação)" que o kanban cria ao descartar um card nascem com o dono do card
 * e caem às 09:00 — hora candidata da config. O Pedro tinha 20 delas no futuro; as 9h sumiriam
 * da oferta todos os dias.
 */

const ORG = 'org-1';
const PEDRO = 'u-pedro';
const NOW = new Date('2026-09-21T12:00:00.000Z');

/** Espiã da cadeia do PostgREST: guarda os filtros e devolve as linhas no fim. */
function supabaseFake(linhas: Array<{ date: string }>) {
  const filtros: Record<string, unknown> = {};
  const cadeia: Record<string, unknown> = {
    select: () => cadeia,
    eq: (col: string, val: unknown) => { filtros[`eq:${col}`] = val; return cadeia; },
    in: (col: string, val: unknown) => { filtros[`in:${col}`] = val; return cadeia; },
    is: (col: string, val: unknown) => { filtros[`is:${col}`] = val; return cadeia; },
    gte: (col: string, val: unknown) => { filtros[`gte:${col}`] = val; return cadeia; },
    lt: (col: string, val: unknown) => { filtros[`lt:${col}`] = val; return cadeia; },
    then: (ok: (v: unknown) => unknown) => ok({ data: linhas, error: null }),
  };
  return { filtros, client: { from: () => cadeia } as never };
}

describe('loadBusyIntervals — o que ocupa a agenda', () => {
  it('pede ao banco SÓ CALL e MEETING (TASK/NOTE/STATUS_CHANGE não são compromisso)', async () => {
    const { filtros, client } = supabaseFake([]);
    await loadBusyIntervals({
      supabase: client,
      organizationId: ORG,
      consultantUserId: PEDRO,
      now: NOW,
      config: NIVA_AVAILABILITY,
    });

    expect(filtros['in:type']).toEqual(['CALL', 'MEETING']);
    // Continua sendo a agenda de UMA pessoa, ativa, dentro do horizonte.
    expect(filtros['eq:owner_id']).toBe(PEDRO);
    expect(filtros['eq:organization_id']).toBe(ORG);
    expect(filtros['is:deleted_at']).toBeNull();
    // A janela também é filtro: sem ela o motor leria a agenda inteira, passado incluso, e a
    // pessoa apareceria ocupada em horários que já aconteceram.
    expect(filtros['gte:date']).toBe(NOW.toISOString());
    const fim = Date.parse(String(filtros['lt:date']));
    expect(fim).toBeGreaterThan(NOW.getTime());
    expect(fim).toBeLessThanOrEqual(
      NOW.getTime() + (NIVA_AVAILABILITY.horizonBusinessDays + 3) * 24 * 60 * 60 * 1000,
    );
  });

  it('transforma cada compromisso num intervalo do tamanho do slot', async () => {
    const inicio = '2026-09-22T13:00:00.000Z';
    const { client } = supabaseFake([{ date: inicio }]);
    const busy = await loadBusyIntervals({
      supabase: client,
      organizationId: ORG,
      consultantUserId: PEDRO,
      now: NOW,
      config: NIVA_AVAILABILITY,
    });

    expect(busy).toHaveLength(1);
    expect(busy[0].startMs).toBe(new Date(inicio).getTime());
    expect(busy[0].endMs - busy[0].startMs).toBe(NIVA_AVAILABILITY.slotMinutes * 60 * 1000);
  });

  it('erro do banco é tratado como agenda LIVRE, sem derrubar o agendamento', async () => {
    const cadeia: Record<string, unknown> = {
      select: () => cadeia, eq: () => cadeia, in: () => cadeia, is: () => cadeia,
      gte: () => cadeia, lt: () => cadeia,
      then: (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: 'boom' } }),
    };
    const busy = await loadBusyIntervals({
      supabase: { from: () => cadeia } as never,
      organizationId: ORG,
      consultantUserId: PEDRO,
      now: NOW,
      config: NIVA_AVAILABILITY,
    });
    expect(busy).toEqual([]);
  });
});
