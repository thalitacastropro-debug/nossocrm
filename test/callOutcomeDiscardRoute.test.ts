import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Descartar uma gravação pendente (09/10/2026). Existe porque a gravação agora nasce `pendente`:
 * sem um "esta não" explícito, o botão Descartar da revisão a deixaria pendurada no card para
 * sempre. O arquivo FICA no storage — descartar é "não me mostre mais", não apagar.
 */

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const PATH = `${DEAL_ID}/voice/x.mp3`;

let supabaseClientMock: Record<string, unknown>;
let dealVisivel = true;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/dealFilesServer', async () => {
  const real = await vi.importActual<typeof import('@/lib/supabase/dealFilesServer')>('@/lib/supabase/dealFilesServer');
  return {
    pathDeGravacaoDoDeal: real.pathDeGravacaoDoDeal,
    resolverGravacao: vi.fn(async () => ({ error: null })),
  };
});

import { POST } from '@/app/api/deals/[dealId]/call-outcome/discard/route';
import * as files from '@/lib/supabase/dealFilesServer';

function dealQB() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => (dealVisivel
      ? { data: { id: DEAL_ID }, error: null }
      : { data: null, error: { message: 'not found' } })),
  };
}

async function descartar(audioFilePath: unknown, dealId = DEAL_ID): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/call-outcome/discard`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioFilePath }),
  });
  return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('POST /api/deals/[dealId]/call-outcome/discard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dealVisivel = true;
    supabaseClientMock = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })) },
      from: vi.fn(() => dealQB()),
    };
  });

  it('marca a gravação deste card como descartada', async () => {
    const res = await descartar(PATH);
    expect(res.status).toBe(200);
    expect(files.resolverGravacao).toHaveBeenCalledWith(DEAL_ID, PATH, 'descartado');
  });

  it('path de outro card → 400, sem tocar em nada', async () => {
    expect((await descartar('d4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7/voice/y.mp3')).status).toBe(400);
    expect(files.resolverGravacao).not.toHaveBeenCalled();
  });

  it('deal que a RLS não mostra → 404, sem tocar em nada', async () => {
    dealVisivel = false;
    expect((await descartar(PATH)).status).toBe(404);
    expect(files.resolverGravacao).not.toHaveBeenCalled();
  });

  it('sem usuário → 401', async () => {
    supabaseClientMock = {
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
      from: vi.fn(),
    };
    expect((await descartar(PATH)).status).toBe(401);
  });
});
