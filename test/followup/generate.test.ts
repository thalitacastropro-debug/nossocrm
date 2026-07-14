import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ai/agent/agent.service', () => ({
  getOrgAIConfig: vi.fn(async () => null), // sem config => generate deve devolver null
}));
vi.mock('@/lib/ai/config', () => ({ getModel: vi.fn(() => ({})) }));

import { generateWarmFollowupBubbles } from '@/lib/ai/followup/generate';

function fakeSupabase() {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } as never;
}

describe('generateWarmFollowupBubbles', () => {
  it('sem config de IA => null (o chamador usa o fallback fixo)', async () => {
    const out = await generateWarmFollowupBubbles({
      supabase: fakeSupabase(), organizationId: 'org-1', boardId: 'b-1',
      conversationId: 'c-1', firstName: 'Ana', touchIndex: 0,
    });
    expect(out).toBeNull();
  });
});
