import { describe, it, expect } from 'vitest';
import { bookSlot } from '@/lib/ai/scheduling/booker';
import type { Slot } from '@/lib/ai/scheduling/types';

const slot: Slot = {
  startIso: '2026-07-03T13:00:00.000Z',
  endIso: '2026-07-03T13:40:00.000Z',
  label: 'quinta, 03/07, às 10h',
};

/**
 * Supabase fake com builder encadeável:
 * - activities.select(...).eq().eq().eq().is().limit()  → re-check (clash configurável)
 * - activities.insert(row).select('id').single()        → insertError configurável
 * - activities.update(patch).eq('id', id)               → registra em activityUpdates
 * - deals.select('...').eq().single()                   → custom_fields/tags vazios
 * - deals.update(patch).eq('id')                        → dealUpdateError configurável
 */
function makeSupabase(opts: {
  clash?: boolean;
  insertError?: { code: string } | null;
  dealUpdateError?: { code: string } | null;
} = {}) {
  const state: any = { insertedActivity: null, dealUpdate: null, activityUpdates: [] };
  const clashResult = { data: opts.clash ? [{ id: 'clash-1' }] : [], error: null };

  const client: any = {
    from(table: string) {
      if (table === 'activities') {
        return {
          select: () => {
            const b: any = {
              eq: () => b,
              is: () => b,
              limit: async () => clashResult,
            };
            return b;
          },
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
              state.activityUpdates.push({ id, patch });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'deals') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { custom_fields: {}, tags: [] }, error: null }) }) }),
          update: (patch: any) => ({ eq: async () => { state.dealUpdate = patch; return { error: opts.dealUpdateError ?? null }; } }),
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

  it('re-check: se o slot já está ocupado, retorna taken sem inserir', async () => {
    const { client, state } = makeSupabase({ clash: true });
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('taken');
    expect(state.insertedActivity).toBeNull();
    expect(state.dealUpdate).toBeNull();
  });

  it('corrida: unique violation (23505) => taken, sem gravar deal', async () => {
    const { client, state } = makeSupabase({ insertError: { code: '23505' } });
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('taken');
    expect(state.dealUpdate).toBeNull();
  });

  it('erro de banco genérico no insert => db_error', async () => {
    const { client } = makeSupabase({ insertError: { code: '08006' } });
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('db_error');
  });

  it('falha no UPDATE do deal => ROLLBACK da activity nova + db_error (nunca confirma falso)', async () => {
    const { client, state } = makeSupabase({ dealUpdateError: { code: '55000' } });
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('db_error');
    // a activity criada (act-1) deve ter sido deletada no rollback
    expect(state.activityUpdates.some((u: any) => u.id === 'act-1' && u.patch.deleted_at)).toBe(true);
  });

  it('remarcação: cria a nova e depois cancela a antiga', async () => {
    const { client, state } = makeSupabase();
    const r = await bookSlot({ supabase: client, ...base, previousActivityId: 'act-old' });
    expect(r.ok).toBe(true);
    expect(state.insertedActivity).not.toBeNull();
    expect(state.activityUpdates.some((u: any) => u.id === 'act-old' && u.patch.deleted_at)).toBe(true);
  });

  it('remarcação onde o novo slot encheu (23505): NÃO cancela a antiga (não deixa o lead sem reunião)', async () => {
    const { client, state } = makeSupabase({ insertError: { code: '23505' } });
    const r = await bookSlot({ supabase: client, ...base, previousActivityId: 'act-old' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('taken');
    // a activity antiga NÃO pode ter sido cancelada
    expect(state.activityUpdates.some((u: any) => u.id === 'act-old')).toBe(false);
  });
});
