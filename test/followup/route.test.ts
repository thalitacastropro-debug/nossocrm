import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock dos imports "server-only"/pesados p/ o route.ts carregar sob o Vitest.
// O caminho de 401 retorna ANTES de usar qualquer um deles.
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => ({}) }));
vi.mock('@/lib/ai/agent/agent.service', () => ({ sendAIResponse: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/ai/followup/generate', () => ({ generateWarmFollowupBubbles: vi.fn(async () => null) }));

import { GET } from '@/app/api/cron/lead-followup/route';

beforeAll(() => { process.env.CRON_SECRET = 'segredo-teste'; });

describe('GET /api/cron/lead-followup (auth)', () => {
  it('401 sem Bearer correto', async () => {
    const req = new Request('https://x/api/cron/lead-followup', { headers: { Authorization: 'Bearer errado' } });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('401 sem header', async () => {
    const req = new Request('https://x/api/cron/lead-followup');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
