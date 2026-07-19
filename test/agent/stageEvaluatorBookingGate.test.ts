/**
 * Gate anti-mis-advancement: o avaliador NÃO pode avançar p/ "agendado" sem reunião REAL
 * confirmada no booking, mesmo que o LLM diga shouldAdvance=true com alta confiança.
 * (Bug do Cleysson: entrou em "agendado" sem booking → notify_team → Ana calou.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// LLM mockado — cada teste controla o output.
const generateTextMock = vi.fn();
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  Output: { object: vi.fn(() => ({})) },
}));
vi.mock('@/lib/ai/config', () => ({ getModel: vi.fn(() => ({})) }));

import { evaluateStageAdvancement, requiresConfirmedBooking } from '@/lib/ai/agent/stage-evaluator';

const CURRENT_STAGE = { board_id: 'board-sdr', order: 1 }; // em-qualificacao
const NEXT_STAGE = { id: 'stage-agendado', name: 'agendado' };

/** Supabase fake cobrindo as chains do evaluateStageAdvancement. `reuniaoAgendada` = o booking
 * fresco que o gate relê do deal. Registra se o deals.update (avanço) foi chamado. */
function makeSupabase(reuniaoAgendada: Record<string, unknown> | null) {
  const state = { advanced: false, updatePatch: null as Record<string, unknown> | null };
  const client = {
    from(table: string) {
      if (table === 'ai_conversation_log') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      if (table === 'board_stages') {
        return {
          select: () => {
            const b: Record<string, unknown> = { _isNext: false };
            b.eq = () => b;
            b.gt = () => { b._isNext = true; return b; };
            b.order = () => b;
            b.limit = () => b;
            b.maybeSingle = async () => ({ data: b._isNext ? NEXT_STAGE : CURRENT_STAGE, error: null });
            return b;
          },
        };
      }
      if (table === 'deals') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { custom_fields: reuniaoAgendada ? { reuniao_agendada: reuniaoAgendada } : {} }, error: null }) }),
          }),
          update: (patch: Record<string, unknown>) => {
            state.advanced = true;
            state.updatePatch = patch;
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'deal_activities') {
        return { insert: async () => ({ error: null }) };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    },
  };
  return { client: client as never, state };
}

const baseParams = {
  context: {
    deal: { id: 'deal-1', title: 'Lead X', value: null, stage_id: 'stage-emqual', stage_name: 'em-qualificacao', notes: null, created_at: '' },
    contact: { name: 'Lead X', company: null, position: null },
  },
  stageConfig: { advancement_criteria: ['Reunião marcada em horário real'], stage_goal: null } as never,
  conversationHistory: [{ role: 'user' as const, content: 'sobre hospital...' }],
  aiConfig: { provider: 'google' as const, apiKey: 'k', model: 'm', structuredApiKey: 'k', structuredModel: 'm' },
  organizationId: 'org-1',
  hitlThreshold: 0.85,
  hitlMinConfidence: 0.7,
};

const ADVANCE_EVAL = {
  shouldAdvance: true,
  overallConfidence: 0.95,
  criteriaEvaluation: [{ criterion: 'Reunião marcada em horário real', met: true, confidence: 0.95, evidence: 'alucinado' }],
  reasoning: 'LLM achou que marcou',
  suggestedAction: 'advance',
};

describe('requiresConfirmedBooking', () => {
  it('exige booking só para a etapa "agendado" (case-insensitive)', () => {
    expect(requiresConfirmedBooking('agendado')).toBe(true);
    expect(requiresConfirmedBooking(' Agendado ')).toBe(true);
    expect(requiresConfirmedBooking('em-qualificacao')).toBe(false);
    expect(requiresConfirmedBooking(null)).toBe(false);
  });
});

describe('gate anti-mis-advancement no evaluateStageAdvancement', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue({ output: ADVANCE_EVAL, usage: { totalTokens: 10 } });
  });

  it('LLM diz avançar p/ "agendado" MAS sem reunião confirmada => NÃO avança', async () => {
    const { client, state } = makeSupabase(null);
    const r = await evaluateStageAdvancement({ supabase: client, ...baseParams });
    expect(r.advanced).toBe(false);
    expect(state.advanced).toBe(false); // deals.update nunca chamado
  });

  it('reunião com status diferente de "confirmada" (ex.: cancelada) => NÃO avança', async () => {
    const { client, state } = makeSupabase({ status: 'cancelada' });
    const r = await evaluateStageAdvancement({ supabase: client, ...baseParams });
    expect(r.advanced).toBe(false);
    expect(state.advanced).toBe(false);
  });

  it('com reunião confirmada no booking => avança normalmente p/ "agendado"', async () => {
    const { client, state } = makeSupabase({ status: 'confirmada', data_hora: '2026-07-20T18:00:00Z' });
    const r = await evaluateStageAdvancement({ supabase: client, ...baseParams });
    expect(r.advanced).toBe(true);
    expect(r.newStageId).toBe('stage-agendado');
    expect(state.advanced).toBe(true);
  });
});
