import { describe, it, expect, vi, beforeEach } from 'vitest';

let aiConfig: unknown;
const generateTextMock = vi.fn();

vi.mock('@/lib/ai/agent/agent.service', () => ({ getOrgAIConfig: vi.fn(async () => aiConfig) }));
vi.mock('@/lib/ai/config', () => ({ getModel: vi.fn(() => ({ mock: 'model' })) }));
vi.mock('ai', () => ({ generateText: (args: unknown) => generateTextMock(args) }));

import { generateFirstTouchBubbles } from '@/lib/ai/lead-intake/first-touch';

function fakeSupabase(personaPrompt: string | null = 'Você é a Ana.') {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: personaPrompt ? { persona_prompt: personaPrompt } : null, error: null })),
    })),
  } as never;
}

const LEAD_FORM = { mapped: { name: 'Everaldo', phone: '+5511999' }, fields: { operadora: 'Amil', 'Você possuí CNPJ?': 'sim' } };

describe('generateFirstTouchBubbles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiConfig = { provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-4-5-20251001' };
    generateTextMock.mockResolvedValue({
      text: 'Oi Everaldo, tudo bem? Aqui é a Ana, da Niva.\nVi que hoje você está na Amil.\nQuanto você paga por mês nesse plano?',
    });
  });

  it('quebra a resposta da IA em bolhas (uma por linha)', async () => {
    const bubbles = await generateFirstTouchBubbles({
      supabase: fakeSupabase(), organizationId: 'org', boardId: 'board', firstName: 'Everaldo', leadForm: LEAD_FORM,
    });
    expect(bubbles).toEqual([
      'Oi Everaldo, tudo bem? Aqui é a Ana, da Niva.',
      'Vi que hoje você está na Amil.',
      'Quanto você paga por mês nesse plano?',
    ]);
  });

  it('inclui a persona do board + o form no prompt enviado ao modelo', async () => {
    await generateFirstTouchBubbles({
      supabase: fakeSupabase('PERSONA_DA_ANA'), organizationId: 'org', boardId: 'board', firstName: 'Everaldo', leadForm: LEAD_FORM,
    });
    const arg = generateTextMock.mock.calls[0][0] as { system: string; prompt: string };
    expect(arg.system).toContain('PERSONA_DA_ANA');
    expect(arg.system).toContain('PRIMEIRO TOQUE');
    expect(arg.prompt).toContain('Amil'); // dado do formulário vai pro modelo
  });

  it('retorna null quando a org não tem config de IA (fallback na route)', async () => {
    aiConfig = null;
    const bubbles = await generateFirstTouchBubbles({
      supabase: fakeSupabase(), organizationId: 'org', boardId: 'board', firstName: 'X', leadForm: LEAD_FORM,
    });
    expect(bubbles).toBeNull();
  });

  it('retorna null (nunca lança) quando o modelo falha', async () => {
    generateTextMock.mockRejectedValueOnce(new Error('model down'));
    const bubbles = await generateFirstTouchBubbles({
      supabase: fakeSupabase(), organizationId: 'org', boardId: 'board', firstName: 'X', leadForm: LEAD_FORM,
    });
    expect(bubbles).toBeNull();
  });

  it('persona ausente não impede o opener (best-effort)', async () => {
    const bubbles = await generateFirstTouchBubbles({
      supabase: fakeSupabase(null), organizationId: 'org', boardId: 'board', firstName: 'X', leadForm: LEAD_FORM,
    });
    expect(bubbles).not.toBeNull();
    expect(bubbles!.length).toBeGreaterThan(0);
  });
});
