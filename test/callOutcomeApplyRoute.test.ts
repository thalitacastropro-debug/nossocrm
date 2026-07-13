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
