import { describe, it, expect } from 'vitest';
import { handoffToNextBoard } from '@/lib/ai/scheduling/handoff';

/**
 * Supabase fake para o handoff Ana->Consultor (MOVE, não copia):
 * - boards.select('next_board_id').eq().maybeSingle()   → next_board_id do board de origem
 * - deals.select('board_id, custom_fields').eq().maybeSingle() → deal (board atual + guard)
 * - board_stages.select('id').eq().order().limit()      → etapa de entrada do board destino
 * - deals.update(patch).eq()                            → MOVE (registra o patch)
 * - activities.insert(row)                              → log (best-effort)
 */
function makeSupabase(
  opts: {
    nextBoardId?: string | null;
    srcDeal?: Record<string, unknown> | null;
    entryStageId?: string | null;
    updateError?: { code: string } | null;
  } = {},
) {
  const state: any = { updatePatch: null, insertedActivity: null };
  const nextBoardId = opts.nextBoardId === undefined ? 'board-consultor' : opts.nextBoardId;
  const srcDeal =
    opts.srcDeal === undefined
      ? {
          board_id: 'board-ana',
          custom_fields: {
            lead_form: { mapped: { name: 'João' } },
            tier: { value: 'ouro' },
            reuniao_agendada: { status: 'confirmada', activity_id: 'call-1', data_hora: '2026-07-20T18:00:00.000Z' },
          },
        }
      : opts.srcDeal;
  const entryStageId = opts.entryStageId === undefined ? 'stage-call-agendada' : opts.entryStageId;

  const client: any = {
    from(table: string) {
      if (table === 'boards') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { next_board_id: nextBoardId }, error: null }) }) }) };
      }
      if (table === 'board_stages') {
        return {
          select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: entryStageId ? [{ id: entryStageId }] : [], error: null }) }) }) }),
        };
      }
      if (table === 'deals') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: srcDeal, error: null }) }) }),
          update: (patch: any) => ({
            eq: async () => {
              state.updatePatch = patch;
              return { error: opts.updateError ?? null };
            },
          }),
        };
      }
      if (table === 'activities') {
        return { insert: async (row: any) => { state.insertedActivity = row; return { error: null }; } };
      }
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client, state };
}

const base = { dealId: 'deal-1', sourceBoardId: 'board-ana', organizationId: 'org-1' };

describe('handoffToNextBoard (MOVE)', () => {
  it('sucesso: MOVE o deal pro board destino (board_id + stage de entrada) preservando dados + carimbo', async () => {
    const { client, state } = makeSupabase();
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(true);
    expect(r.targetBoardId).toBe('board-consultor');
    // Move o MESMO deal (update, não insert de cópia)
    expect(state.updatePatch.board_id).toBe('board-consultor');
    expect(state.updatePatch.stage_id).toBe('stage-call-agendada');
    // Preserva os dados do card (mesmo deal, custom_fields intacto) + carimbo de origem/idempotência
    expect(state.updatePatch.custom_fields.lead_form.mapped.name).toBe('João');
    expect(state.updatePatch.custom_fields.reuniao_agendada.activity_id).toBe('call-1');
    expect(state.updatePatch.custom_fields.originBoardId).toBe('board-ana');
    expect(state.updatePatch.custom_fields.handoff_consultor.board_id).toBe('board-consultor');
    expect(state.insertedActivity.type).toBe('STATUS_CHANGE');
  });

  it('sem sourceBoardId => no-op', async () => {
    const { client, state } = makeSupabase();
    const r = await handoffToNextBoard({ supabase: client, ...base, sourceBoardId: null });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('no_next_board');
    expect(state.updatePatch).toBeNull();
  });

  it('board sem next_board_id => no-op', async () => {
    const { client, state } = makeSupabase({ nextBoardId: null });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.reason).toBe('no_next_board');
    expect(state.updatePatch).toBeNull();
  });

  it('idempotência: deal já tem handoff_consultor => no-op, NÃO move de novo', async () => {
    const { client, state } = makeSupabase({
      srcDeal: { board_id: 'board-ana', custom_fields: { handoff_consultor: { board_id: 'board-consultor', at: 'x' } } },
    });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.reason).toBe('already_done');
    expect(state.updatePatch).toBeNull();
  });

  it('deal já saiu do board de origem => no-op (defensivo)', async () => {
    const { client, state } = makeSupabase({ srcDeal: { board_id: 'outro-board', custom_fields: {} } });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.reason).toBe('already_done');
    expect(state.updatePatch).toBeNull();
  });

  it('deal sumiu => source_missing', async () => {
    const { client } = makeSupabase({ srcDeal: null });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.reason).toBe('source_missing');
  });

  it('board destino sem etapas => no_target_stage', async () => {
    const { client, state } = makeSupabase({ entryStageId: null });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.reason).toBe('no_target_stage');
    expect(state.updatePatch).toBeNull();
  });

  it('erro no update => db_error', async () => {
    const { client } = makeSupabase({ updateError: { code: '55000' } });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('db_error');
  });
});
