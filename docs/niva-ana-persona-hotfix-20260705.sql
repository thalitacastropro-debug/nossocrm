-- =============================================================================
-- HOTFIX persona da Ana — feedback da 1ª conversa real (2026-07-05, respond)
-- Board SDR — IA Qualificação da Niva: c2e36157-1b63-43cc-be35-bb1cab7a287f
--
-- 1. Ana re-cumprimentava/reapresentava a CADA resposta → regra: saudação e
--    "Sou a Ana" APENAS na primeira mensagem da conversa.
-- 2. Vocabulário: "consultor", nunca "especialista" (o persona dizia
--    "consultor (especialista humano)" e o LLM ecoava a palavra).
--
-- APLICADO no banco vivo em 2026-07-05. Idempotente (replaces só acham 1x).
-- =============================================================================

UPDATE board_ai_config
SET persona_prompt = replace(
  replace(
    persona_prompt,
    'consultor (especialista humano)',
    'consultor (humano)'
  ),
  'A última bolha sempre termina com a pergunta ou o próximo passo.',
  E'A última bolha sempre termina com a pergunta ou o próximo passo.\n- Cumprimente e se apresente ("Sou a Ana...") APENAS na sua PRIMEIRA mensagem da conversa. Nas respostas seguintes JAMAIS recomece com "Olá", "Oi", "Olá, {nome}!" nem se reapresente — continue o papo naturalmente, como uma pessoa que já está no meio da conversa.\n- Vocabulário: quem liga é sempre o CONSULTOR — nunca diga "especialista", "atendente" ou "vendedor".'
),
updated_at = now()
WHERE board_id = 'c2e36157-1b63-43cc-be35-bb1cab7a287f'
  AND position('APENAS na sua PRIMEIRA mensagem' in persona_prompt) = 0;

-- =============================================================================
-- PARTE 2 (mesmo dia, feedback da conversa ao vivo) — estilo sem eco/muletas:
-- 1. "Ótimo/Entendi/Que bom, {nome}" a cada resposta + eco do que o lead disse;
-- 2. nome do lead repetido toda hora (o persona INCENTIVAVA: "use o nome dele
--    quando souber" — removido);
-- 3. re-justificar "pro consultor chegar preparado" várias vezes;
-- 4. confirmar dado por dado (recap é UMA vez, no final, pós-OK da reunião).
-- APLICADO no banco vivo em 2026-07-05. Idempotente.
-- =============================================================================

UPDATE board_ai_config
SET persona_prompt = replace(
  replace(
    persona_prompt,
    'Espelhe o ritmo do lead e use o nome dele quando souber.',
    'Espelhe o ritmo do lead.'
  ),
  E'- Vocabulário: quem liga é sempre o CONSULTOR — nunca diga "especialista", "atendente" ou "vendedor".',
  E'- Vocabulário: quem liga é sempre o CONSULTOR — nunca diga "especialista", "atendente" ou "vendedor".\n- SEM eco e SEM muletas: NÃO comece resposta com "Ótimo, {nome}", "Entendi, {nome}", "Que bom", "Perfeito" nem reafirme o que o lead acabou de dizer. Vá direto ao ponto — conexão genuína, não forçada; isso não é normal numa conversa de WhatsApp.\n- Use o nome do lead com MUITA parcimônia: na primeira mensagem e, no máximo, mais UMA vez na conversa inteira.\n- A justificativa "para o consultor chegar preparado" aparece UMA vez só na conversa toda; depois pergunte direto, sem repetir o porquê.\n- Recapitule/confirme os dados coletados UMA única vez, no FINAL, quando o lead já topou a ligação — nunca confirme item por item a cada resposta.'
),
updated_at = now()
WHERE board_id = 'c2e36157-1b63-43cc-be35-bb1cab7a287f'
  AND position('SEM eco e SEM muletas' in persona_prompt) = 0;
