import { describe, it, expect } from 'vitest';
import { tipoUazapiDaMidia } from '@/lib/messaging/providers/whatsapp/uazapi.provider';
import type { MessageContent } from '@/lib/messaging/types';

const midia = (over: Record<string, unknown>) => over as unknown as MessageContent;

// Tipos aceitos pelo /send/media, conforme a doc oficial lida em 25/08/2026:
// image, video, videoplay, ptv, document, audio, myaudio, ptt, sticker.
describe('tipoUazapiDaMidia', () => {
  it('imagem e documento vão no tipo direto', () => {
    expect(tipoUazapiDaMidia(midia({ type: 'image' }))).toBe('image');
    expect(tipoUazapiDaMidia(midia({ type: 'document' }))).toBe('document');
    expect(tipoUazapiDaMidia(midia({ type: 'sticker' }))).toBe('sticker');
  });

  it('vídeo comum é "video"; com a marca de gravação vira "ptv" (bolinha)', () => {
    expect(tipoUazapiDaMidia(midia({ type: 'video' }))).toBe('video');
    expect(tipoUazapiDaMidia(midia({ type: 'video', enviarComoBolinha: true }))).toBe('ptv');
  });

  it('áudio comum é "audio"; com a marca de gravação vira "ptt" (voz)', () => {
    expect(tipoUazapiDaMidia(midia({ type: 'audio' }))).toBe('audio');
    expect(tipoUazapiDaMidia(midia({ type: 'audio', enviarComoVoz: true }))).toBe('ptt');
  });

  // A bolinha não pode "vazar" de um tipo para o outro: marcar áudio como bolinha
  // de vídeo (ou o inverso) tem que ser ignorado, não virar um tipo inválido.
  it('a marca de bolinha só afeta vídeo, e a de voz só afeta áudio', () => {
    expect(tipoUazapiDaMidia(midia({ type: 'audio', enviarComoBolinha: true }))).toBe('audio');
    expect(tipoUazapiDaMidia(midia({ type: 'video', enviarComoVoz: true }))).toBe('video');
  });

  it('o que não é mídia não vira envio de mídia', () => {
    expect(tipoUazapiDaMidia(midia({ type: 'text', text: 'oi' }))).toBeNull();
    expect(tipoUazapiDaMidia(midia({ type: 'location' }))).toBeNull();
  });
});
