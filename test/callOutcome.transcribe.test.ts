import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContentMock = vi.fn(async () => ({ text: 'fechei com a Valéria, 3 vidas, Amil' }));

vi.mock('@google/genai', () => ({
  // Função normal (não arrow) que RETORNA o objeto → utilizável com `new`.
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: generateContentMock } };
  }),
  createUserContent: vi.fn((parts: unknown) => parts),
  createPartFromBase64: vi.fn((data: string, mimeType: string) => ({ inlineData: { data, mimeType } })),
}));

import { transcribeAudio } from '@/lib/ai/call-outcome/transcribe';
import { createPartFromBase64 } from '@google/genai';

describe('transcribeAudio', () => {
  beforeEach(() => vi.clearAllMocks());

  it('chama o Gemini com o áudio inline e retorna o texto', async () => {
    const text = await transcribeAudio({
      apiKey: 'k',
      model: 'gemini-2.5-flash-lite',
      audioBase64: 'AAAA',
      mimeType: 'audio/webm',
    });
    expect(text).toBe('fechei com a Valéria, 3 vidas, Amil');
    expect(createPartFromBase64).toHaveBeenCalledWith('AAAA', 'audio/webm');
    expect(generateContentMock).toHaveBeenCalledOnce();
    const arg = generateContentMock.mock.calls[0][0] as { model: string };
    expect(arg.model).toBe('gemini-2.5-flash-lite');
  });

  it('retorna string vazia quando o modelo não devolve texto', async () => {
    generateContentMock.mockResolvedValueOnce({ text: undefined } as unknown as { text: string });
    const text = await transcribeAudio({ apiKey: 'k', model: 'm', audioBase64: 'x', mimeType: 'audio/ogg' });
    expect(text).toBe('');
  });
});
