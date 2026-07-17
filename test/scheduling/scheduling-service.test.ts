import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks dos colaboradores de I/O — o alvo do teste é a DECISÃO do runScheduling.
vi.mock('@/lib/ai/scheduling/busy', () => ({ loadBusyIntervals: vi.fn(async () => []) }));
vi.mock('@/lib/ai/scheduling/detect', async (orig) => {
  const real = await orig<typeof import('@/lib/ai/scheduling/detect')>();
  return { ...real, detectSchedulingIntent: vi.fn() };
});
vi.mock('@/lib/ai/scheduling/booker', () => ({
  bookSlot: vi.fn(async () => ({ ok: true, activityId: 'act-nova' })),
  cancelMeeting: vi.fn(async () => undefined),
}));

import { runScheduling } from '@/lib/ai/scheduling/scheduling.service';
import { detectSchedulingIntent } from '@/lib/ai/scheduling/detect';
import { bookSlot } from '@/lib/ai/scheduling/booker';
import { NIVA_SDR_BOARD_ID } from '@/lib/ai/extraction/domain/niva-health';

// sexta 17/07/2026 08h30 SP — mesma hora do incidente real da Nathalia.
const NOW = new Date('2026-07-17T11:30:00.000Z');

function baseParams(over: Record<string, unknown> = {}) {
  return {
    supabase: {} as never,
    boardId: NIVA_SDR_BOARD_ID,
    organizationId: 'org-1',
    conversationId: 'conv-1',
    dealId: 'deal-1',
    contactId: 'c-1',
    leadName: 'Nathalia',
    summary: 'Tier indefinido',
    reuniaoAgendada: null,
    aiConfig: { provider: 'google', apiKey: 'k', model: 'm', structuredApiKey: 'k', structuredModel: 'm' },
    dryRun: false,
    consultantUserId: 'u-den',
    now: NOW,
    offeredBefore: true,
    ...over,
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('runScheduling — reconfirmação vs remarcação', () => {
  it('RECONFIRMAÇÃO: lead reconfirma o MESMO horário → reafirma sem re-marcar (regressão 9h→10h)', async () => {
    const marcado = '2026-07-17T20:00:00.000Z'; // sexta 17h SP
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'accept', slotIso: marcado });

    const r = await runScheduling(baseParams({
      reuniaoAgendada: { status: 'confirmada', data_hora: marcado, activity_id: 'act-velha', label: 'sexta, 17/07, às 17h' },
    }));

    expect(bookSlot).not.toHaveBeenCalled();
    expect(r.status).toEqual({ kind: 'confirmed', label: 'sexta, 17/07, às 17h' });
  });

  it('o horário JÁ MARCADO vai na lista do detector (senão ele é forçado a apontar outro)', async () => {
    const marcado = '2026-07-17T20:00:00.000Z';
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'accept', slotIso: marcado });

    await runScheduling(baseParams({
      reuniaoAgendada: { status: 'confirmada', data_hora: marcado, activity_id: 'act-velha', label: 'sexta, 17/07, às 17h' },
    }));

    const offered = vi.mocked(detectSchedulingIntent).mock.calls[0][0].offered;
    expect(offered.some((s) => s.startIso === marcado)).toBe(true);
  });

  it('mas a Ana NÃO oferece de volta o horário já marcado (available fica sem ele)', async () => {
    const marcado = '2026-07-17T20:00:00.000Z';
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'none', slotIso: null });

    const r = await runScheduling(baseParams({
      reuniaoAgendada: { status: 'confirmada', data_hora: marcado, activity_id: 'act-velha', label: 'sexta, 17/07, às 17h' },
    }));

    expect(r.available.some((s) => s.startIso === marcado)).toBe(false);
  });

  it('CASO NATHALIA: aceita horário DIFERENTE do marcado → re-marca e cancela a activity antiga', async () => {
    const marcado = '2026-07-17T20:00:00.000Z';  // sexta 17h
    const novo = '2026-07-20T18:00:00.000Z';     // segunda 15h
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'accept', slotIso: novo });

    const r = await runScheduling(baseParams({
      reuniaoAgendada: { status: 'confirmada', data_hora: marcado, activity_id: 'act-velha', label: 'sexta, 17/07, às 17h' },
    }));

    expect(bookSlot).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(bookSlot).mock.calls[0][0];
    expect(arg.slot.startIso).toBe(novo);
    expect(arg.previousActivityId).toBe('act-velha'); // cancela a de sexta
    expect(r.status).toEqual({ kind: 'confirmed', label: 'segunda, 20/07, às 15h' });
  });

  it('sem reunião marcada, um accept normal marca sem previousActivityId', async () => {
    const novo = '2026-07-20T18:00:00.000Z';
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'accept', slotIso: novo });

    await runScheduling(baseParams({ reuniaoAgendada: null }));

    expect(vi.mocked(bookSlot).mock.calls[0][0].previousActivityId).toBeNull();
  });

  it('OBSERVE (dryRun): com reunião marcada, não marca nem reafirma — só devolve detected', async () => {
    const marcado = '2026-07-17T20:00:00.000Z';
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'accept', slotIso: marcado });

    const r = await runScheduling(baseParams({
      dryRun: true,
      reuniaoAgendada: { status: 'confirmada', data_hora: marcado, activity_id: 'act-velha', label: 'sexta, 17/07, às 17h' },
    }));

    expect(bookSlot).not.toHaveBeenCalled();
    expect(r.status).toEqual({ kind: 'none' });
    expect(r.detected).toEqual({ intent: 'accept', slotIso: marcado });
  });
});
