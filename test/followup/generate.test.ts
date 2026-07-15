import { describe, it, expect, vi, beforeEach } from 'vitest';

const getOrgAIConfig = vi.fn();
const generateText = vi.fn();

vi.mock('@/lib/ai/agent/agent.service', () => ({ getOrgAIConfig: (...a: unknown[]) => getOrgAIConfig(...a) }));
vi.mock('@/lib/ai/config', () => ({ getModel: vi.fn(() => ({})) }));
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }));

import { generateWarmFollowupBubbles } from '@/lib/ai/followup/generate';

// Supabase mínimo: board_ai_config.select().eq().maybeSingle() e
// messaging_messages.select().eq().order().limit().
function fakeSupabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
          order: () => ({ limit: async () => ({ data: [] }) }),
        }),
      }),
    }),
  } as never;
}

const baseArgs = {
  supabase: fakeSupabase(), organizationId: 'org-1', boardId: 'b-1',
  conversationId: 'c-1', firstName: 'Ana', touchIndex: 0,
};

beforeEach(() => { getOrgAIConfig.mockReset(); generateText.mockReset(); });

describe('generateWarmFollowupBubbles', () => {
  it('sem config de IA => null (o chamador usa o fallback fixo)', async () => {
    getOrgAIConfig.mockResolvedValue(null);
    expect(await generateWarmFollowupBubbles(baseArgs)).toBeNull();
  });

  it('IA vaza placeholder em colchetes => null (guard, cai no fallback)', async () => {
    getOrgAIConfig.mockResolvedValue({ provider: 'google', apiKey: 'k', model: 'm' });
    generateText.mockResolvedValue({ text: 'Você informou que o CNPJ fica em [estado/cidade], certo?' });
    expect(await generateWarmFollowupBubbles(baseArgs)).toBeNull();
  });

  it('IA devolve bolhas limpas => retorna as bolhas', async () => {
    getOrgAIConfig.mockResolvedValue({ provider: 'google', apiKey: 'k', model: 'm' });
    generateText.mockResolvedValue({ text: 'Oi, ainda por aí?\nConsigo continuar de onde paramos.' });
    expect(await generateWarmFollowupBubbles(baseArgs)).toEqual(['Oi, ainda por aí?', 'Consigo continuar de onde paramos.']);
  });
});
