/**
 * Defaults por provider — fonte única de verdade.
 * Usados apenas como fallback quando o banco retorna null
 * (ex: org recém-criada antes do primeiro save).
 */
export const AI_DEFAULT_MODELS = {
  // gemini-2.0-flash e gemini-2.5-flash foram APOSENTADOS pelo Google (2026-07):
  // o generateContent retorna "model is no longer available". flash-lite da 2.5
  // segue disponível e é confiável (testado). Trocar aqui se o Google aposentar
  // também — sintoma: a IA para de responder com "model is no longer available".
  google: 'gemini-2.5-flash-lite',
  // Fallback do provider Anthropic (usado quando ai_model é null ou não está na
  // lista permitida). Haiku 4.5 = melhor aderência a regra por custo (SDR Ana).
  // ID datado exato da API (o alias curto "claude-haiku-4-5" dá 404).
  anthropic: 'claude-haiku-4-5-20251001',
} as const;

export const AI_DEFAULT_PROVIDER = 'google' as const;
