import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

let profileQB: Record<string, unknown>;
let supabaseClientMock: Record<string, unknown>;
let aiConfig: unknown;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/ai/agent/agent.service', () => ({ getOrgAIConfig: vi.fn(async () => aiConfig) }));
vi.mock('@/lib/ai/call-outcome/transcribe', () => ({ transcribeAudio: vi.fn(async () => 'texto transcrito') }));
vi.mock('@/lib/supabase/dealFilesServer', () => ({
  uploadDealAudioServer: vi.fn(async () => ({ filePath: `${DEAL_ID}/voice/x.webm`, error: null })),
}));

import { POST } from '@/app/api/deals/[dealId]/call-outcome/route';

function buildProfileQB(orgId: string | null = ORG_ID) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: orgId ? { organization_id: orgId } : null, error: null })),
  };
}
function auth(userId: string | null = USER_ID) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) } };
}
async function callPost(dealId = DEAL_ID, hasFile = true): Promise<Response> {
  const form = new FormData();
  if (hasFile) form.set('audio', new File([new Uint8Array([1, 2, 3])], 'a.webm', { type: 'audio/webm' }));
  const req = new Request(`http://localhost/api/deals/${dealId}/call-outcome`, { method: 'POST', body: form });
  return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('POST /api/deals/[dealId]/call-outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileQB = buildProfileQB();
    aiConfig = { structuredApiKey: 'gkey', structuredModel: 'gemini-2.5-flash-lite' };
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => { if (t === 'profiles') return profileQB; throw new Error('unexpected ' + t); }),
    };
  });

  it('401 sem usuário', async () => {
    supabaseClientMock = { ...auth(null), from: vi.fn() };
    expect((await callPost()).status).toBe(401);
  });

  it('400 quando dealId inválido', async () => {
    expect((await callPost('nao-uuid')).status).toBe(400);
  });

  it('400 sem arquivo de áudio', async () => {
    expect((await callPost(DEAL_ID, false)).status).toBe(400);
  });

  it('422 quando a org não tem chave Google (structuredApiKey vazio)', async () => {
    aiConfig = { structuredApiKey: '', structuredModel: 'm' };
    expect((await callPost()).status).toBe(422);
  });

  it('200 devolve transcrição + audioFilePath', async () => {
    const res = await callPost();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcricao).toBe('texto transcrito');
    expect(body.audioFilePath).toContain('/voice/');
  });
});
