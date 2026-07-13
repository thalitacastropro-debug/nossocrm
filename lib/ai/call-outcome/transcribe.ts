/**
 * Transcrição de áudio de call via @google/genai (Gemini aceita ogg/webm inline).
 * ~30s cabe base64 inline (< 20MB). Structured output NÃO acontece aqui — só texto.
 */
import { GoogleGenAI, createUserContent, createPartFromBase64 } from '@google/genai';

const TRANSCRIBE_PROMPT =
  'Transcreva este áudio em português do Brasil, verbatim (palavra por palavra). ' +
  'Não resuma, não interprete, não adicione pontuação de fala. Devolva apenas o texto falado.';

export async function transcribeAudio(opts: {
  apiKey: string;
  model: string;
  audioBase64: string;
  mimeType: string;
}): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const response = await ai.models.generateContent({
    model: opts.model,
    contents: createUserContent([
      createPartFromBase64(opts.audioBase64, opts.mimeType),
      TRANSCRIBE_PROMPT,
    ]),
  });
  return response.text ?? '';
}
