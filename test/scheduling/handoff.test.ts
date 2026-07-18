import { describe, it, expect } from 'vitest';
import { handoffToNextBoard } from '@/lib/ai/scheduling/handoff';

/**
 * Supabase fake encadeável para o handoff Ana->Consultor:
 * - boards.select('next_board_id').eq().maybeSingle()            → next_board_id do board de origem
 * - deals.select(...).eq().maybeSingle()                          → deal de origem (+ guard de idempotência)
 * - board_stages.select('id').eq().order().limit()               → etapa de entrada do board destino
 * - deals.insert(row).select('id').single()                      → cria a cópia (insertError configurável)
 * - deals.update(patch).eq()                                     → carimba handoff_consultor no origem
 * - activities.insert(row)                                       → log (best-effort)
 */
function makeSupabase(
  opts: {
    nextBoardId?: string | null;
    srcDeal?: Record<string, unknown> | null;
    entryStageId?: string | null;
    insertError?: { code: string } | null;
    stampError?: { code: string } | null;
  } = {},
) {
  const state: any = { insertedDeal: null, dealUpdate: null, insertedActivity: null };
  const nextBoardId = opts.nextBoardId === undefined ? 'board-consultor' : opts.nextBoardId;
  const srcDeal =
    opts.srcDeal === undefined
      ? {
          title: 'João — Lead Meta Ads',
          value: 2100,
          contact_id: 'c-1',
          owner_id: null,
          priority: 'low',
          tags: ['reuniao:agendada'],
          custom_fields: {
            lead_form: { mapped: { name: 'João' } },
            qualificacao: { vidas: 3 },
            tier: { value: 'ouro' },
            reuniao_agendada: { status: 'confirmada', data_hora: '2026-07-20T18:00:00.000Z' },
          },
        }
      : opts.srcDeal;
  const entryStageId = opts.entryStageId === undefined ? 'stage-call-agendada' : opts.entryStageId;

  const client: any = {
    from(table: string) {
      if (table === 'boards') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { next_board_id: nextBoardId }, error: null }) }),
          }),
        };
      }
      if (table === 'board_stages') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: entryStageId ? [{ id: entryStageId }] : [], error: null }) }),
            }),
          }),
        };
      }
      if (table === 'deals') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: srcDeal, error: null }) }) }),
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                if (opts.insertError) return { data: null, error: opts.insertError };
                state.insertedDeal = { id: 'new-deal-1', ...row };
                return { data: { id: 'new-deal-1' }, error: null };
              },
            }),
          }),
          update: (patch: any) => ({
            eq: async () => {
              state.dealUpdate = patch;
              return { error: opts.stampError ?? null };
            },
          }),
        };
      }
      if (table === 'activities') {
        return {
          insert: async (row: any) => {
            state.insertedActivity = row;
            return { error: null };
          },
        };
      }
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client, state };
}

const base = { dealId: 'deal-1', sourceBoardId: 'board-ana', organizationId: 'org-1' };

describe('handoffToNextBoard', () => {
  it('sucesso: cria cópia no board destino na etapa de entrada, preservando dados + rastreio', async () => {
    const { client, state } = makeSupabase();
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(true);
    expect(r.newDealId).toBe('new-deal-1');
    expect(r.targetBoardId).toBe('board-consultor');
    // Copiou pro board destino, na etapa de entrada
    expect(state.insertedDeal.board_id).toBe('board-consultor');
    expect(state.insertedDeal.stage_id).toBe('stage-call-agendada');
    expect(state.insertedDeal.is_won).toBe(false);
    // Preservou os dados do card de origem
    expect(state.insertedDeal.custom_fields.lead_form.mapped.name).toBe('João');
    expect(state.insertedDeal.custom_fields.qualificacao.vidas).toBe(3);
    expect(state.insertedDeal.custom_fields.tier.value).toBe('ouro');
    // Carimbou o rastreio de origem
    expect(state.insertedDeal.custom_fields.originDealId).toBe('deal-1');
    expect(state.insertedDeal.custom_fields.originBoardId).toBe('board-ana');
    expect(state.insertedDeal.custom_fields.originAutomation).toBe('NEXT_BOARD_SCHEDULING');
    // Estampou a idempotência no deal de ORIGEM
    expect(state.dealUpdate.custom_fields.handoff_consultor.deal_id).toBe('new-deal-1');
    // Logou a atividade
    expect(state.insertedActivity.type).toBe('STATUS_CHANGE');
  });

  it('board de origem sem sourceBoardId => no-op', async () => {
    const { client, state } = makeSupabase();
    const r = await handoffToNextBoard({ supabase: client, ...base, sourceBoardId: null });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('no_next_board');
    expect(state.insertedDeal).toBeNull();
  });

  it('board sem next_board_id => no-op (não cria cópia)', async () => {
    const { client, state } = makeSupabase({ nextBoardId: null });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('no_next_board');
    expect(state.insertedDeal).toBeNull();
  });

  it('idempotência: deal já tem handoff_consultor => no-op, NÃO cria 2ª cópia', async () => {
    const { client, state } = makeSupabase({
      srcDeal: {
        title: 'Já feito',
        value: 0,
        tags: [],
        custom_fields: { handoff_consultor: { deal_id: 'existente', at: '2026-07-18T00:00:00Z' } },
      },
    });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('already_done');
    expect(state.insertedDeal).toBeNull();
  });

  it('corrida: unique violation (23505) na cópia => already_done, sem estampar', async () => {
    const { client, state } = makeSupabase({ insertError: { code: '23505' } });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('already_done');
    expect(state.dealUpdate).toBeNull();
  });

  it('erro genérico no insert => db_error', async () => {
    const { client } = makeSupabase({ insertError: { code: '55000' } });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('db_error');
  });

  it('deal de origem sumiu => source_missing', async () => {
    const { client } = makeSupabase({ srcDeal: null });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('source_missing');
  });

  it('board destino sem etapas => no_target_stage', async () => {
    const { client, state } = makeSupabase({ entryStageId: null });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('no_target_stage');
    expect(state.insertedDeal).toBeNull();
  });

  it('falha no stamp de idempotência é não-fatal (índice único já cobre): ainda handedOff=true', async () => {
    const { client } = makeSupabase({ stampError: { code: '55000' } });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(true);
    expect(r.newDealId).toBe('new-deal-1');
  });
});
