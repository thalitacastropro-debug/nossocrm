import { describe, it, expect } from 'vitest';
import type { AnexoDeToque } from '@/lib/ai/followup/run';

/**
 * A regra do anexo, isolada do I/O do `runLeadFollowup` (que fala com o banco).
 * É a mesma condição do run.ts — se mudar lá, este teste tem que mudar junto.
 */
function levaAnexo(
  anexo: AnexoDeToque | null | undefined,
  touchIndex: number,
  cadence: 'cold' | 'warm',
): boolean {
  if (!anexo) return false;
  return touchIndex === anexo.toqueIndex && cadence === (anexo.cadencia ?? 'cold');
}

const videoNoTerceiroToque: AnexoDeToque = {
  url: 'https://exemplo.test/video.mp4',
  tipo: 'video',
  legenda: 'Gravei isso pra você',
  toqueIndex: 2, // 3º toque
};

describe('anexo do toque de follow-up', () => {
  // Decisão da Thalita (25/08/2026): o vídeo entra no 3º toque.
  it('vai no 3º toque da cadência fria', () => {
    expect(levaAnexo(videoNoTerceiroToque, 2, 'cold')).toBe(true);
  });

  // O ponto mais importante: mídia para quem NUNCA respondeu é o disparo que mais
  // chama atenção do WhatsApp, e a conta da Niva é nova.
  it('NÃO vai no primeiro contato', () => {
    expect(levaAnexo(videoNoTerceiroToque, 0, 'cold')).toBe(false);
  });

  it('não vai nos outros toques', () => {
    expect(levaAnexo(videoNoTerceiroToque, 1, 'cold')).toBe(false);
    expect(levaAnexo(videoNoTerceiroToque, 3, 'cold')).toBe(false);
  });

  // A cadência quente é conversa em andamento: o lead já respondeu, o contexto é
  // outro. Só entra se for configurado de propósito.
  it('não vaza para a cadência quente por acidente', () => {
    expect(levaAnexo(videoNoTerceiroToque, 2, 'warm')).toBe(false);
  });

  it('respeita cadência escolhida explicitamente', () => {
    const naQuente: AnexoDeToque = { ...videoNoTerceiroToque, cadencia: 'warm' };
    expect(levaAnexo(naQuente, 2, 'warm')).toBe(true);
    expect(levaAnexo(naQuente, 2, 'cold')).toBe(false);
  });

  it('sem anexo configurado, a cadência segue só com texto', () => {
    expect(levaAnexo(null, 2, 'cold')).toBe(false);
    expect(levaAnexo(undefined, 2, 'cold')).toBe(false);
  });

  it('aceita outros tipos além de vídeo', () => {
    const pdf: AnexoDeToque = { url: 'https://exemplo.test/guia.pdf', tipo: 'document', toqueIndex: 2 };
    expect(levaAnexo(pdf, 2, 'cold')).toBe(true);
  });
});
