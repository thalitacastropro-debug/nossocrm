import { describe, it, expect } from 'vitest';
import { bookSlot } from '@/lib/ai/scheduling/booker';
import type { Slot } from '@/lib/ai/scheduling/types';

const slot: Slot = {
  startIso: '2026-07-03T13:00:00.000Z',
  endIso: '2026-07-03T13:40:00.000Z',
  label: 'quinta, 03/07, às 10h',
};

// Supabase fake: activities.insert configurável + deals select/update.
function makeSupabase(opts: { insertError?: { code: string } | null } = {}) {
  const state: any = { insertedActivity: null, dealUpdate: null, deletedIds: [] };
  const client: any = {
    from(table: string) {
      if (table === 'activities') {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                if (opts.insertError) return { data: null, error: opts.insertError };
                state.insertedActivity = { id: 'act-1', ...row };
                return { data: { id: 'act-1' }, error: null };
              },
            }),
          }),
          update: (patch: any) => ({
            eq: async (_c: string, id: string) => {
              state.deletedIds.push({ id, patch });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'deals') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { custom_fields: {}, tags: [] }, error: null }) }) }),
          update: (patch: any) => ({ eq: async () => { state.dealUpdate = patch; return { error: null }; } }),
        };
      }
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client, state };
}

const base = {
  dealId: 'deal-1', contactId: 'c-1', organizationId: 'org-1',
  consultantUserId: 'u-den', leadName: 'João', summary: 'Tier ouro', slot,
};

describe('bookSlot', () => {
  it('sucesso: cria activity CALL e grava reuniao_agendada + tag', async () => {
    const { client, state } = makeSupabase();
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(true);
    expect(r.activityId).toBe('act-1');
    expect(state.insertedActivity.type).toBe('CALL');
    expect(state.insertedActivity.owner_id).toBe('u-den');
    expect(state.insertedActivity.date).toBe(slot.startIso);
    expect(state.dealUpdate.custom_fields.reuniao_agendada.status).toBe('confirmada');
    expect(state.dealUpdate.tags).toContain('reuniao:agendada');
  });

  it('corrida: unique violation (23505) => taken, sem gravar deal', async () => {
    const { client, state } = makeSupabase({ insertError: { code: '23505' } });
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('taken');
    expect(state.dealUpdate).toBeNull();
  });

  it('erro de banco genérico => db_error', async () => {
    const { client } = makeSupabase({ insertError: { code: '08006' } });
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('db_error');
  });

  it('remarcação: cancela a activity anterior antes de criar a nova', async () => {
    const { client, state } = makeSupabase();
    const r = await bookSlot({ supabase: client, ...base, previousActivityId: 'act-old' });
    expect(r.ok).toBe(true);
    expect(state.deletedIds.some((d: any) => d.id === 'act-old' && d.patch.deleted_at)).toBe(true);
  });
});
