/**
 * Limite de retry no ORQUESTRADOR: falha de envio precisa deixar rastro no card
 * (fail_count) e, no teto, parar a cadência avisando gente de verdade.
 * Incidente que originou: 28/08/2026, WhatsApp desconectado, retry infinito.
 */
import { describe, it, expect, vi } from 'vitest';
import { runLeadFollowup, type FollowupDeps } from '@/lib/ai/followup/run';
import { COLD_SCHEDULE_MS, MAX_FALHAS_SEGUIDAS } from '@/lib/ai/followup/schedule';

const NOW = new Date('2026-07-13T20:00:00.000Z');
const OLD = new Date(NOW.getTime() - COLD_SCHEDULE_MS[0] - 60_000).toISOString();

function makeSupabase(cfg: { deals: unknown[]; conversations: unknown[]; contacts: unknown[]; inbound?: unknown[] }) {
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
          ...thenable(cfg.deals),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => { dealUpdates.push({ id, patch }); return { error: null }; },
          }),
        };
      }
      if (table === 'messaging_conversations') return thenable(cfg.conversations);
      if (table === 'contacts') return thenable(cfg.contacts);
      if (table === 'messaging_messages') return thenable(cfg.inbound ?? []);
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client: client as never, dealUpdates };
}

/** Cenário padrão: 1 lead frio com o toque 0 vencido. `followup` sobrescreve o estado. */
function cenario(followup?: Record<string, unknown>) {
  return makeSupabase({
    deals: [{
      id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'novo',
      custom_fields: followup ? { followup } : { lead_form: { first_touch: { sent_at: OLD } } },
      tags: [],
    }],
    conversations: [{ id: 'cv1', contact_id: 'c1', first_response_at: null, last_message_at: OLD, last_message_direction: 'outbound', metadata: {} }],
    contacts: [{ id: 'c1', name: 'Maria Silva', ai_paused: false }],
  });
}

function deps(over: Partial<FollowupDeps>, supa: FollowupDeps['supabase']): FollowupDeps {
  return { supabase: supa, now: NOW, sendResponse: vi.fn(async () => ({ success: true })), generateWarm: vi.fn(async () => null), ...over };
}

/** Último patch gravado no card. */
function ultimoFollowup(updates: Array<{ patch: Record<string, unknown> }>) {
  const last = updates[updates.length - 1];
  return (last.patch.custom_fields as { followup: Record<string, unknown> }).followup;
}

describe('runLeadFollowup — falha de envio', () => {
  it('envio que falha grava fail_count no card (e não consome o toque)', async () => {
    const { client, dealUpdates } = cenario();
    const r = await runLeadFollowup(deps({ sendResponse: vi.fn(async () => ({ success: false })) }, client));
    expect(r.failed).toBe(1);
    const fu = ultimoFollowup(dealUpdates);
    expect(fu.count).toBe(0);          // cadência revertida, como já era
    expect(fu.fail_count).toBe(1);     // ...mas agora a falha deixa rastro
    expect(fu.last_failed_at).toBe(NOW.toISOString());
  });

  it('envio que dá certo zera o fail_count de falhas anteriores', async () => {
    const { client, dealUpdates } = cenario({
      cadence: 'cold', anchor_at: OLD, count: 0, stopped: false,
      fail_count: 2, last_failed_at: new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    });
    const r = await runLeadFollowup(deps({ sendResponse: vi.fn(async () => ({ success: true })) }, client));
    expect(r.processed).toBe(1);
    const fu = ultimoFollowup(dealUpdates);
    expect(fu.count).toBe(1);
    expect(fu.fail_count).toBe(0);
    expect(fu.last_failed_at).toBeNull();
  });

  it('dentro do backoff nem tenta enviar', async () => {
    const { client } = cenario({
      cadence: 'cold', anchor_at: OLD, count: 0, stopped: false,
      fail_count: 1, last_failed_at: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    const send = vi.fn(async () => ({ success: true }));
    await runLeadFollowup(deps({ sendResponse: send }, client));
    expect(send).not.toHaveBeenCalled();
  });

  it(`na ${MAX_FALHAS_SEGUIDAS}ª falha seguida para a cadência e avisa`, async () => {
    const { client, dealUpdates } = cenario({
      cadence: 'cold', anchor_at: OLD, count: 0, stopped: false,
      fail_count: MAX_FALHAS_SEGUIDAS - 1,
      last_failed_at: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), // backoff vencido
    });
    const notify = vi.fn(async () => {});
    const r = await runLeadFollowup(deps({ sendResponse: vi.fn(async () => ({ success: false })), notify }, client));
    expect(r.failed).toBe(1);
    const fu = ultimoFollowup(dealUpdates);
    expect(fu.stopped).toBe(true);
    expect(fu.stopped_reason).toBe('falhas_de_envio');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ dealId: 'd1', contactName: 'Maria Silva', falhas: MAX_FALHAS_SEGUIDAS });
  });

  it('falha antes do teto NÃO avisa — alarme é para parada, não para soluço', async () => {
    const { client } = cenario();
    const notify = vi.fn(async () => {});
    await runLeadFollowup(deps({ sendResponse: vi.fn(async () => ({ success: false })), notify }, client));
    expect(notify).not.toHaveBeenCalled();
  });

  it('cadência parada por falhas não volta a tentar', async () => {
    const { client } = cenario({
      cadence: 'cold', anchor_at: OLD, count: 0,
      stopped: true, stopped_reason: 'falhas_de_envio', fail_count: MAX_FALHAS_SEGUIDAS,
    });
    const send = vi.fn(async () => ({ success: true }));
    await runLeadFollowup(deps({ sendResponse: send }, client));
    expect(send).not.toHaveBeenCalled();
  });
});
