import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const ACT_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';

let dealRow: Record<string, unknown>;
let dealUpdateSpy: ReturnType<typeof vi.fn>;
let actUpdateSpy: ReturnType<typeof vi.fn>;
let actInsertSpy: ReturnType<typeof vi.fn>;
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));

import { POST } from '@/app/api/deals/[dealId]/meeting-held/route';

function auth(userId: string | null = USER_ID) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) } };
}
async function callPost(dealId = DEAL_ID): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/meeting-held`, { method: 'POST', body: '{}' });
  return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('POST /api/deals/[dealId]/meeting-held', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dealRow = { id: DEAL_ID, organization_id: ORG_ID, owner_id: USER_ID, custom_fields: { reuniao_agendada: { activity_id: ACT_ID } } };
    dealUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
    actUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
    actInsertSpy = vi.fn(async () => ({ error: null }));
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => {
        if (t === 'deals') return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn(async () => ({ data: dealRow, error: null })), update: dealUpdateSpy };
        throw new Error('unexpected ' + t);
      }),
    };
    adminMock = { from: vi.fn((t: string) => { if (t === 'activities') return { update: actUpdateSpy, insert: actInsertSpy }; throw new Error('admin ' + t); }) };
  });

  it('401 sem usuário', async () => {
    supabaseClientMock = { ...auth(null), from: vi.fn() };
    expect((await callPost()).status).toBe(401);
  });

  it('400 com dealId inválido', async () => {
    expect((await callPost('nao-uuid')).status).toBe(400);
  });

  it('marca a CALL agendada como completed e grava reuniao_realizada', async () => {
    const res = await callPost();
    expect(res.status).toBe(200);
    expect(actUpdateSpy).toHaveBeenCalledWith({ completed: true });
    expect(actInsertSpy).not.toHaveBeenCalled();
    const arg = dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> };
    expect((arg.custom_fields.reuniao_realizada as { realizada: boolean; by: string }).realizada).toBe(true);
    expect((arg.custom_fields.reuniao_realizada as { by: string }).by).toBe(USER_ID);
    // spread: não apaga o que já existia
    expect(arg.custom_fields).toHaveProperty('reuniao_agendada');
  });

  it('sem activity_id (indicação/orgânico) → cria MEETING completed', async () => {
    dealRow = { ...dealRow, custom_fields: {} };
    const res = await callPost();
    expect(res.status).toBe(200);
    expect(actUpdateSpy).not.toHaveBeenCalled();
    expect(actInsertSpy).toHaveBeenCalledOnce();
    const ins = actInsertSpy.mock.calls[0][0] as { type: string; completed: boolean };
    expect(ins.type).toBe('MEETING'); // nunca CALL (índice único)
    expect(ins.completed).toBe(true);
  });

  it('idempotente: já realizada → 200 sem regravar', async () => {
    dealRow = { ...dealRow, custom_fields: { reuniao_realizada: { realizada: true } } };
    const res = await callPost();
    expect(res.status).toBe(200);
    expect(dealUpdateSpy).not.toHaveBeenCalled();
    expect(actUpdateSpy).not.toHaveBeenCalled();
    expect(actInsertSpy).not.toHaveBeenCalled();
  });
});
