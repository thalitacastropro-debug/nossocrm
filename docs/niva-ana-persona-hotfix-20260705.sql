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
