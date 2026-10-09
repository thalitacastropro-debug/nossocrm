/**
 * A apresentação não saiu x cadência de follow-up (09/10/2026).
 *
 * Com o WhatsApp fora de 06 a 08/10, o 1º toque de giani e Flávia Muniz falhou — e a cadência
 * tentou mandar "ainda por aí?" para elas mesmo assim. Só não chegou porque o canal continuava
 * fora. Quem nunca recebeu o "oi" não pode receber o "ainda por aí?": enquanto o 1º toque está
 * `failed` (o cron tenta de novo) ou `desistiu` (o time foi avisado para ligar), a cadência espera.
 */
import { describe, it, expect, vi } from 'vitest';
import { runLeadFollowup, type FollowupDeps } from '@/lib/ai/followup/run';
import { COLD_SCHEDULE_MS } from '@/lib/ai/followup/schedule';

const NOW = new Date('2026-07-13T20:00:00.000Z');
const OLD = new Date(NOW.getTime() - COLD_SCHEDULE_MS[0] - 60_000).toISOString();

function cenario(firstTouch: Record<string, unknown>) {
  const dealUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  function thenable(rows: unknown[]) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit']) b[m] = () => b;
    b.then = (res: (v: { data: unknown[]; error: null }) => void) => res({ data: rows, error: null });
    return b;
  }
  const client = {
    from(table: string) {
      if (table === 'deals') {
        return {
          ...thenable([{
            id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'novo',
            custom_fields: { lead_form: { first_touch: firstTouch } }, tags: [],
          }]),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => { dealUpdates.push({ id, patch }); return { error: null }; },
          }),
        };
      }
      if (table === 'messaging_conversations') {
        // A tentativa falhada grava mensagem nossa: a conversa termina em OUTBOUND, que é
        // justamente o que fazia a cadência achar que podia cobrar resposta.
        return thenable([{
          id: 'cv1', contact_id: 'c1', first_response_at: null, last_message_at: OLD,
          last_message_direction: 'outbound', metadata: {},
        }]);
      }
      if (table === 'contacts') return thenable([{ id: 'c1', name: 'giani', ai_paused: false }]);
      if (table === 'messaging_messages') return thenable([]);
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client: client as never, dealUpdates };
}

function deps(supa: FollowupDeps['supabase'], sendResponse = vi.fn(async () => ({ success: true }))): FollowupDeps {
  return { supabase: supa, now: NOW, sendResponse, generateWarm: vi.fn(async () => null) };
}

describe('follow-up x apresentação que não saiu', () => {
  it('1º toque FALHOU: nada de "ainda por aí?" — e nenhum estado gravado (a cadência nasce depois)', async () => {
    const { client, dealUpdates } = cenario({ status: 'failed', sent_at: null, error: 'UazAPI 503' });
    const enviar = vi.fn(async () => ({ success: true }));
    const r = await runLeadFollowup(deps(client, enviar));
    expect(enviar).not.toHaveBeenCalled();
    expect(r.processed).toBe(0);
    expect(dealUpdates).toHaveLength(0);
  });

  it('1º toque DESISTIU (número sem WhatsApp / time avisado): também não', async () => {
    const { client } = cenario({ status: 'desistiu', error: 'is not on WhatsApp' });
    const enviar = vi.fn(async () => ({ success: true }));
    await runLeadFollowup(deps(client, enviar));
    expect(enviar).not.toHaveBeenCalled();
  });

  it('controle: 1º toque que SAIU segue a cadência normal', async () => {
    const { client } = cenario({ status: 'greeted', sent_at: OLD });
    const enviar = vi.fn(async () => ({ success: true }));
    await runLeadFollowup(deps(client, enviar));
    expect(enviar).toHaveBeenCalledOnce();
  });
});
