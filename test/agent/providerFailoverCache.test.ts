import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do generateText do AI SDK — sem rede; só capturamos os args.
const generateTextMock = vi.fn();
vi.mock('ai', () => ({ generateText: (...args: unknown[]) => generateTextMock(...args) }));

import { generateWithFailover } from '@/lib/ai/agent/provider-failover';

beforeEach(() => {
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({
    text: 'ok',
    usage: { totalTokens: 10 },
    providerMetadata: { anthropic: { cacheReadInputTokens: 123, cacheCreationInputTokens: 0 } },
  });
});

describe('generateWithFailover — prompt caching por provider', () => {
  it('anthropic: system vira messages[] com cacheControl ephemeral (sem system top-level)', async () => {
    await generateWithFailover({
      providers: [{ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-4-5-20251001' }],
      system: 'PERSONA',
      prompt: 'MSG',
    });
    const call = generateTextMock.mock.calls[0][0] as any;
    expect(call.system).toBeUndefined();
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0].role).toBe('system');
    expect(call.messages[0].content).toBe('PERSONA');
    expect(call.messages[0].providerOptions.anthropic.cacheControl).toEqual({ type: 'ephemeral' });
    expect(call.messages[1]).toEqual({ role: 'user', content: 'MSG' });
  });

  it('google: mantém system/prompt top-level, SEM cacheControl (caminho de fallback intacto)', async () => {
    await generateWithFailover({
      providers: [{ provider: 'google', apiKey: 'k', model: 'gemini-2.5-flash' }],
      system: 'PERSONA',
      prompt: 'MSG',
    });
    const call = generateTextMock.mock.calls[0][0] as any;
    expect(call.system).toBe('PERSONA');
    expect(call.prompt).toBe('MSG');
    expect(call.messages).toBeUndefined();
  });

  it('temperature é repassada quando definida (anthropic)', async () => {
    await generateWithFailover({
      providers: [{ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-4-5-20251001' }],
      system: 'P',
      prompt: 'M',
      temperature: 0.3,
    });
    expect((generateTextMock.mock.calls[0][0] as any).temperature).toBe(0.3);
  });
});
