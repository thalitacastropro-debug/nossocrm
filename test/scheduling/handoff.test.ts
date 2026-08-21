import { describe, it, expect, vi, afterEach } from 'vitest';
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
    /** Config de Telegram da org (organization_settings). Default null = não notifica. */
    telegram?: { telegram_bot_token: string; telegram_chat_id: string } | null;
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
  // Lista de etapas do board destino, em ordem. A 1ª é a de entrada; a de "qualificação" é o
  // destino dos motivos que NÃO são reunião agendada (Thalita, 21/08).
  const stages = entryStageId
    ? [
        { id: entryStageId, name: 'call-agendada' },
        ...(opts.semQualificacao ? [] : [{ id: 'stage-qualificacao', name: 'qualificacao' }]),
      ]
    : [];

  const client: any = {
    from(table: string) {
      if (table === 'boards') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { next_board_id: nextBoardId }, error: null }) }) }) };
      }
      if (table === 'board_stages') {
        return {
          // A função agora lê TODAS as etapas (precisa achar a de qualificação pelo nome),
          // então o encadeamento termina em .order() — sem .limit().
          select: () => ({ eq: () => ({ order: async () => ({ data: stages, error: null }) }) }),
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
      if (table === 'organization_settings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.telegram ?? null, error: null }) }) }) };
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

  // ENTREGA SEM REUNIÃO (Thalita, 21/08). O lead só vai pro consultor quando a Ana não consegue
  // resolver — e aí NÃO existe horário marcado. Pôr em "call-agendada" mentiria sobre haver
  // reunião; o destino certo é a etapa de QUALIFICAÇÃO do funil dele.
  describe('motivos sem reunião marcada', () => {
    it('ana_nao_resolveu => cai em QUALIFICAÇÃO, não na etapa de entrada', async () => {
      const { client, state } = makeSupabase();
      const r = await handoffToNextBoard({ supabase: client, ...base, motivo: 'ana_nao_resolveu' });
      expect(r.handedOff).toBe(true);
      expect(state.updatePatch.stage_id).toBe('stage-qualificacao');
      expect(state.updatePatch.custom_fields.handoff_consultor.motivo).toBe('ana_nao_resolveu');
    });

    it('sem_resposta_ligar => qualificação + activity destacando LIGAR', async () => {
      const { client, state } = makeSupabase();
      const r = await handoffToNextBoard({ supabase: client, ...base, motivo: 'sem_resposta_ligar' });
      expect(r.handedOff).toBe(true);
      expect(state.updatePatch.stage_id).toBe('stage-qualificacao');
      expect(state.insertedActivity.title).toContain('LIGAR');
    });

    it('reuniao_agendada (default) continua na etapa de ENTRADA — comportamento antigo intacto', async () => {
      const { client, state } = makeSupabase();
      await handoffToNextBoard({ supabase: client, ...base });
      expect(state.updatePatch.stage_id).toBe('stage-call-agendada');
    });

    it('board destino SEM etapa de qualificação: entrega na de entrada em vez de abortar', async () => {
      const { client, state } = makeSupabase({ semQualificacao: true });
      const r = await handoffToNextBoard({ supabase: client, ...base, motivo: 'ana_nao_resolveu' });
      expect(r.handedOff).toBe(true);
      expect(state.updatePatch.stage_id).toBe('stage-call-agendada');
    });
  });

  it('erro no update => db_error', async () => {
    const { client } = makeSupabase({ updateError: { code: '55000' } });
    const r = await handoffToNextBoard({ supabase: client, ...base });
    expect(r.handedOff).toBe(false);
    expect(r.reason).toBe('db_error');
  });

  describe('notificação Telegram pro consultor (best-effort)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('org com Telegram configurado => envia aviso positivo (nome + horário) pro chat_id', async () => {
      const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const { client } = makeSupabase({
        telegram: { telegram_bot_token: 'tok-123', telegram_chat_id: 'chat-99' },
      });

      const r = await handoffToNextBoard({ supabase: client, ...base });
      expect(r.handedOff).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/bottok-123/sendMessage');
      const payload = JSON.parse(init.body as string);
      expect(payload.chat_id).toBe('chat-99');
      expect(payload.text).toContain('João'); // nome do lead_form.mapped.name
      expect(payload.text).toContain('20/07'); // label da reunião (data_hora 2026-07-20T18:00Z, -03:00)
      expect(payload.text).toContain('Novo lead agendado');
    });

    it('org SEM Telegram => não tenta enviar (move ainda ok)', async () => {
      const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const { client } = makeSupabase(); // telegram default null

      const r = await handoffToNextBoard({ supabase: client, ...base });
      expect(r.handedOff).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falha no envio do Telegram NÃO derruba o handoff (move continua ok)', async () => {
      const fetchMock = vi.fn(async () => { throw new Error('network down'); });
      vi.stubGlobal('fetch', fetchMock);
      const { client, state } = makeSupabase({
        telegram: { telegram_bot_token: 'tok', telegram_chat_id: 'chat' },
      });

      const r = await handoffToNextBoard({ supabase: client, ...base });
      expect(r.handedOff).toBe(true); // handoff não é afetado
      expect(state.updatePatch.board_id).toBe('board-consultor'); // o MOVE aconteceu
    });
  });
});
