import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

let dealRow: Record<string, unknown>;
let dealUpdateSpy: ReturnType<typeof vi.fn>;
let activityInsertSpy: ReturnType<typeof vi.fn>;
let voiceInsertSpy: ReturnType<typeof vi.fn>;
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));

import { POST } from '@/app/api/deals/[dealId]/call-outcome/apply/route';

function auth(userId: string | null = USER_ID) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) } };
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    audioFilePath: `${DEAL_ID}/voice/a.webm`,
    transcricao: 'fechei com a Valéria',
    desfecho: {
      desfecho: 'fechou', nota_resumo: 'Fechou 3 vidas Amil',
      tarefas: [{ descricao: 'Enviar contrato', data: null }],
      dados_negocio: { operadora: 'Amil', vidas: 3, valor: 2100 },
      objecoes: [], motivo_perda: null, motivo_perda_detalhe: null, reabordar_em: null, confidence: 0.9,
    },
    ...overrides,
  };
}

function makeDealsBuilder() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({ data: dealRow, error: null })),
    update: dealUpdateSpy,
  };
}

async function callPost(body: unknown, dealId = DEAL_ID): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/call-outcome/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('POST /api/deals/[dealId]/call-outcome/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dealRow = { id: DEAL_ID, organization_id: ORG_ID, owner_id: USER_ID, board_id: 'efbaa84e-cf4b-4465-8b50-41afd612088e', stage_id: 's1', value: 0, custom_fields: { tier: { valor: 'prata' }, qualificacao: { vidas: 2 } } };
    dealUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
    activityInsertSpy = vi.fn(async () => ({ error: null }));
    voiceInsertSpy = vi.fn(async () => ({ error: null }));
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => {
        if (t === 'deals') return makeDealsBuilder();
        throw new Error('unexpected ' + t);
      }),
    };
    adminMock = {
      from: vi.fn((t: string) => {
        if (t === 'activities') return { insert: activityInsertSpy };
        if (t === 'voice_calls') return { insert: voiceInsertSpy };
        throw new Error('unexpected admin ' + t);
      }),
    };
  });

  it('401 sem usuário', async () => {
    supabaseClientMock = { ...auth(null), from: vi.fn() };
    expect((await callPost(baseBody())).status).toBe(401);
  });

  it('400 quando o desfecho é inválido', async () => {
    expect((await callPost({ ...baseBody(), desfecho: { desfecho: 'talvez' } })).status).toBe(400);
  });

  it('grava nota + tarefa + voice_calls e responde 200', async () => {
    const res = await callPost(baseBody());
    expect(res.status).toBe(200);
    expect(activityInsertSpy).toHaveBeenCalledTimes(2); // 1 NOTE + 1 TASK
    const types = activityInsertSpy.mock.calls.map((c) => (c[0] as { type: string }).type).sort();
    expect(types).toEqual(['NOTE', 'TASK']);
    expect(voiceInsertSpy).toHaveBeenCalledOnce();
    // Shape do voice_calls: colunas com CHECK constraint no banco — um typo
    // aqui passa no unit e explode em prod (23514), silencioso (best-effort).
    const vc = voiceInsertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(vc).toMatchObject({
      organization_id: ORG_ID,
      deal_id: DEAL_ID,
      mode: 'human_call',
      status: 'completed',
      channel: 'phone',
      direction: 'outbound',
    });
    expect((vc.analysis as { desfecho: string }).desfecho).toBe('fechou');
    expect((vc.metadata as { audio_path: string }).audio_path).toContain('/voice/');
  });

  it('N tarefas → 1 NOTE + N TASKs, com data da tarefa ou enviado_em', async () => {
    const res = await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        tarefas: [
          { descricao: 'Enviar contrato', data: '2026-07-15T13:00:00.000Z' },
          { descricao: 'Cobrar documentos', data: null },
          { descricao: 'Ligar sexta', data: '2026-07-17T14:00:00.000Z' },
        ],
      },
    }));
    expect(res.status).toBe(200);
    expect(activityInsertSpy).toHaveBeenCalledTimes(4);
    const rows = activityInsertSpy.mock.calls.map((c) => c[0] as { type: string; date: string; title: string });
    expect(rows.filter((r) => r.type === 'TASK')).toHaveLength(3);
    expect(rows.find((r) => r.title === 'Enviar contrato')?.date).toBe('2026-07-15T13:00:00.000Z');
    expect(rows.find((r) => r.title === 'Ligar sexta')?.date).toBe('2026-07-17T14:00:00.000Z');
    // tarefa sem data cai no enviado_em (timestamp do request, não null)
    expect(rows.find((r) => r.title === 'Cobrar documentos')?.date).toBeTruthy();
  });

  it('perdeu → grava motivo_perda estruturado + loss_reason (detalhe)', async () => {
    const res = await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'concorrente', motivo_perda_detalhe: 'foi pro concorrente',
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    expect(res.status).toBe(200);
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect((arg.custom_fields as Record<string, unknown>).motivo_perda).toEqual({ categoria: 'concorrente', detalhe: 'foi pro concorrente' });
    expect(arg.loss_reason).toBe('foi pro concorrente');
    expect(arg.value).toBeUndefined(); // value só no fechou
  });

  it('perdeu sem detalhe → loss_reason cai no rótulo da categoria', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'carencia', motivo_perda_detalhe: null,
      },
    }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.loss_reason).toBe('Carência');
  });

  it('converte objecoes legadas string[] e acrescenta as do consultor', async () => {
    dealRow = { ...dealRow, custom_fields: { ...(dealRow.custom_fields as object), objecoes: ['achou caro'] } };
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        objecoes: ['carencia'],
      },
    }));
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    expect(cf.objecoes).toEqual([
      { categoria: 'outro', detalhe: 'achou caro', origem: 'ana' },
      { categoria: 'carencia', detalhe: null, origem: 'consultor' },
    ]);
  });

  it('NÃO apaga custom_fields existentes (spread) e faz merge de qualificacao', async () => {
    await callPost(baseBody());
    const updateArg = dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown>; value?: number };
    expect(updateArg.custom_fields).toHaveProperty('tier');
    const qual = updateArg.custom_fields.qualificacao as Record<string, unknown>;
    expect(qual.operadora).toBe('Amil');
    expect(qual.vidas).toBe(3);
    expect(updateArg.value).toBe(2100); // fechou → value do negócio
  });

  it('fechou → move pra Implantação/aguardando-doc com is_won + closed_at', async () => {
    await callPost(baseBody());
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.board_id).toBe('851c641a-ac99-404e-83d7-9712425b5fdf');
    expect(arg.stage_id).toBe('53589d9d-d0a5-4f62-8cda-20c89828a2b3');
    expect(arg.is_won).toBe(true);
    expect(arg.is_lost).toBe(false);
    expect(arg.closed_at).toBeTruthy();
    expect(arg.last_stage_change_date).toBeTruthy();
  });

  it('perdeu → move pra Nutrição/recontato com is_lost + TASK de reabordagem', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'concorrente', motivo_perda_detalhe: 'foi pra Amil',
        reabordar_em: '2027-07-12T12:00:00.000Z',
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.board_id).toBe('4fb31290-2ab4-46ac-83b1-555fbd4908cc');
    expect(arg.stage_id).toBe('2ee5e57e-e616-45e0-8e46-34741f64ef14');
    expect(arg.is_lost).toBe(true);
    expect(arg.is_won).toBe(false);
    // lembrete de reabordagem = TASK com a data sugerida pela IA
    const dates = activityInsertSpy.mock.calls.map((c) => (c[0] as { date: string }).date);
    expect(dates).toContain('2027-07-12T12:00:00.000Z');
  });

  it('perdeu SEM reabordar_em → TASK de reabordagem cai no fallback por motivo', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'decisor', motivo_perda_detalhe: null, reabordar_em: null,
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const tasks = activityInsertSpy.mock.calls
      .map((c) => c[0] as { type: string; title: string; date: string })
      .filter((a) => a.type === 'TASK' && /reabordar/i.test(a.title));
    expect(tasks).toHaveLength(1);
    // decisor = +2 semanas do enviado_em (não nula, no futuro)
    expect(new Date(tasks[0].date).getTime()).toBeGreaterThan(Date.now());
  });

  it('vai_pensar → move só de etapa (Negociação), sem mudar board nem flags', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'vai_pensar',
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.stage_id).toBe('86179ae9-1d6f-40ca-aaab-9ed7f320a3cc');
    expect(arg.board_id).toBeUndefined();
    expect(arg.is_won).toBeUndefined();
    expect(arg.is_lost).toBeUndefined();
  });

  it('remarcar → não move de board nem etapa', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'remarcar',
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.board_id).toBeUndefined();
    expect(arg.stage_id).toBeUndefined();
    expect(arg.is_won).toBeUndefined();
    expect(arg.is_lost).toBeUndefined();
  });

  it('idempotente: já aplicado → 200 sem regravar', async () => {
    dealRow = { ...dealRow, custom_fields: { ...(dealRow.custom_fields as object), call_outcome_applied_at: '2026-07-12T00:00:00Z' } };
    const res = await callPost(baseBody());
    expect(res.status).toBe(200);
    expect(activityInsertSpy).not.toHaveBeenCalled();
    expect(dealUpdateSpy).not.toHaveBeenCalled();
  });

  it('23505 no update → 409', async () => {
    dealUpdateSpy.mockReturnValue({ eq: vi.fn(async () => ({ error: { code: '23505' } })) });
    expect((await callPost(baseBody())).status).toBe(409);
  });
});
