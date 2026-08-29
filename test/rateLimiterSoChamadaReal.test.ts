/**
 * O rate limit por conversa conta CHAMADA DE IA, não turno que morreu calado.
 *
 * Nasceu junto com o agrupamento de bolhas (29/08/2026): numa rajada de 6 bolhas, 5 turnos
 * cedem a vez e gravam `action_taken='skipped'` em `ai_conversation_log` (é assim que a
 * observabilidade do silêncio funciona desde 14/08). Se o limitador contasse essas linhas,
 * o 6º turno — justamente o único que DEVE responder — bateria no teto de 5/min e a Ana
 * ficaria muda. O conserto do agrupamento viraria um bug de silêncio pior que a corrida.
 *
 * Semanticamente também é o certo: turno que cede nunca chamou o modelo, não custou nada e
 * não tem por que consumir cota de chamada.
 */
import { describe, it, expect, vi } from 'vitest';
import { checkConversationRateLimit } from '@/lib/ai/agent/rate-limiter';

/** Captura os filtros aplicados e devolve `count`. */
function supabaseFake(count: number) {
  const filtros: Array<{ metodo: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'in', 'neq']) {
    builder[m] = (...args: unknown[]) => { filtros.push({ metodo: m, args }); return builder; };
  }
  builder.then = (res: (v: { count: number; error: null }) => void) => res({ count, error: null });
  return { client: { from: vi.fn(() => builder) } as never, filtros };
}

describe('checkConversationRateLimit', () => {
  it('filtra por chamada real de IA — não conta turno que cedeu', async () => {
    const { client, filtros } = supabaseFake(0);
    await checkConversationRateLimit(client, 'cv1');
    const filtroDeAcao = filtros.find(
      (f) => f.metodo === 'in' && f.args[0] === 'action_taken'
    );
    expect(filtroDeAcao, 'esperava um .in("action_taken", [...])').toBeTruthy();
    expect(filtroDeAcao!.args[1]).toEqual(expect.arrayContaining(['responded', 'handoff']));
    expect(filtroDeAcao!.args[1]).not.toContain('skipped');
  });

  it('continua limitando quando houve chamada real demais', async () => {
    const { client } = supabaseFake(5);
    expect((await checkConversationRateLimit(client, 'cv1')).allowed).toBe(false);
  });

  it('abaixo do teto, libera e informa o que sobra', async () => {
    const { client } = supabaseFake(2);
    const r = await checkConversationRateLimit(client, 'cv1');
    expect(r.allowed).toBe(true);
    expect(r.remainingCalls).toBe(3);
  });

  it('segue filtrando pela conversa e pela janela de 1 minuto', async () => {
    const { client, filtros } = supabaseFake(0);
    await checkConversationRateLimit(client, 'cv1');
    expect(filtros.some((f) => f.metodo === 'eq' && f.args[0] === 'conversation_id')).toBe(true);
    expect(filtros.some((f) => f.metodo === 'gte' && f.args[0] === 'created_at')).toBe(true);
  });
});
