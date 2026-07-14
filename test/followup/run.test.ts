import { describe, it, expect, vi } from 'vitest';
import { runLeadFollowup, type FollowupDeps } from '@/lib/ai/followup/run';
import { COLD_SCHEDULE_MS } from '@/lib/ai/followup/schedule';

const NOW = new Date('2026-07-13T20:00:00.000Z');
const OLD = new Date(NOW.getTime() - COLD_SCHEDULE_MS[0] - 60_000).toISOString(); // > +3h atrás

/**
 * Supabase fake: builder "thenable" que resolve com as linhas no await, qualquer que
 * seja o encadeamento de filtros. deals.update(...).eq(...) registra em dealUpdates.
 */
function makeSupabase(cfg: {
  deals: unknown[]; conversations: unknown[]; contacts: unknown[]; inbound?: unknown[];
}) {
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

function baseDeps(over: Partial<FollowupDeps>, supa: FollowupDeps['supabase']): FollowupDeps {
  return {
    supabase: supa,
    now: NOW,
    sendResponse: vi.fn(async () => ({ success: true })),
    generateWarm: vi.fn(async () => null),
    ...over,
  };
}

describe('runLeadFollowup', () => {
  it('lead frio com âncora vencida => envia toque 0 e persiste count=1', async () => {
    const { client, dealUpdates } = makeSupabase({
      deals: [{ id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'novo', custom_fields: { lead_form: { first_touch: { sent_at: OLD } } }, tags: [] }],
      conversations: [{ id: 'cv1', contact_id: 'c1', first_response_at: null, last_message_at: OLD, last_message_direction: 'outbound', metadata: {} }],
      contacts: [{ id: 'c1', name: 'Maria Silva', ai_paused: false }],
    });
    const send = vi.fn(async () => ({ success: true }));
    const r = await runLeadFollowup(baseDeps({ sendResponse: send }, client));
    expect(r.processed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][1] as string;
    expect(msg).toContain('Oi Maria, consegue falar por aqui?');
    const followup = (dealUpdates[0].patch.custom_fields as { followup: { count: number } }).followup;
    expect(followup.count).toBe(1);
  });

  it('pula contato com ai_paused', async () => {
    const { client } = makeSupabase({
      deals: [{ id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'novo', custom_fields: {}, tags: [] }],
      conversations: [{ id: 'cv1', contact_id: 'c1', first_response_at: null, last_message_at: OLD, last_message_direction: 'outbound', metadata: {} }],
      contacts: [{ id: 'c1', name: 'Maria', ai_paused: true }],
    });
    const send = vi.fn(async () => ({ success: true }));
    const r = await runLeadFollowup(baseDeps({ sendResponse: send }, client));
    expect(send).not.toHaveBeenCalled();
    expect(r.skipped).toBeGreaterThanOrEqual(1);
  });

  it('não devido (âncora recente) => não envia', async () => {
    const recent = new Date(NOW.getTime() - 60_000).toISOString();
    const { client } = makeSupabase({
      deals: [{ id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'novo', custom_fields: { lead_form: { first_touch: { sent_at: recent } } }, tags: [] }],
      conversations: [{ id: 'cv1', contact_id: 'c1', first_response_at: null, last_message_at: recent, last_message_direction: 'outbound', metadata: {} }],
      contacts: [{ id: 'c1', name: 'Maria', ai_paused: false }],
    });
    const send = vi.fn(async () => ({ success: true }));
    await runLeadFollowup(baseDeps({ sendResponse: send }, client));
    expect(send).not.toHaveBeenCalled();
  });

  it('reengajado (inbound novo) => reseta o followup como warm e não reenvia o toque velho', async () => {
    const { client, dealUpdates } = makeSupabase({
      deals: [{ id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'em-qual', custom_fields: { followup: { cadence: 'cold', anchor_at: OLD, count: 2, stopped: false } }, tags: [] }],
      conversations: [{ id: 'cv1', contact_id: 'c1', first_response_at: '2026-07-13T10:00:00Z', last_message_at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), last_message_direction: 'outbound', metadata: {} }],
      contacts: [{ id: 'c1', name: 'Maria', ai_paused: false }],
      inbound: [{ conversation_id: 'cv1', created_at: new Date(NOW.getTime() - 6 * 60_000).toISOString() }], // depois da âncora OLD
    });
    const send = vi.fn(async () => ({ success: true }));
    const r = await runLeadFollowup(baseDeps({ sendResponse: send }, client));
    expect(send).not.toHaveBeenCalled(); // toque quente 0 só vence em +15min
    expect(r.reset).toBe(1);
    const followup = (dealUpdates[0].patch.custom_fields as { followup: { count: number; cadence: string } }).followup;
    expect(followup.count).toBe(0);
    expect(followup.cadence).toBe('warm');
  });
});
