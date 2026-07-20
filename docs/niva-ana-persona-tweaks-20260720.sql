-- =============================================================================
-- Niva Ana — micro-ajustes de persona (AO VIVO)  ·  2026-07-20
-- board_ai_config do SDR: c2e36157-1b63-43cc-be35-bb1cab7a287f
-- Aplicado direto no banco (nossocrmv2). Duas regras de estilo reforçadas:
--   (1) UMA pergunta por vez (não empilhar 2+ perguntas na mesma mensagem);
--   (2) 3ª vida = VENDER a importância (não só sondar se existe).
-- Replace por âncora única (verificado: cada âncora aparece 1x).
-- =============================================================================

UPDATE board_ai_config
SET persona_prompt = replace(
      replace(persona_prompt,
        'emende direto a próxima pergunta.',
        'emende direto a próxima pergunta. E faça UMA pergunta por vez: nunca empilhe 2+ perguntas na mesma mensagem — puxe a próxima só depois da resposta.'),
      'as melhores condições das operadoras começam em 3.',
      'a partir de 3 vidas as operadoras liberam as melhores condições (preço e cobertura), então incluir mais alguém costuma valer muito a pena — VENDA esse ganho, não só pergunte se existe.'),
    updated_at = now()
WHERE board_id = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';

-- =============================================================================
-- ROLLBACK (reverte exatamente os dois replaces)
-- =============================================================================
-- UPDATE board_ai_config
-- SET persona_prompt = replace(
--       replace(persona_prompt,
--         'emende direto a próxima pergunta. E faça UMA pergunta por vez: nunca empilhe 2+ perguntas na mesma mensagem — puxe a próxima só depois da resposta.',
--         'emende direto a próxima pergunta.'),
--       'a partir de 3 vidas as operadoras liberam as melhores condições (preço e cobertura), então incluir mais alguém costuma valer muito a pena — VENDA esse ganho, não só pergunte se existe.',
--       'as melhores condições das operadoras começam em 3.'),
--     updated_at = now()
-- WHERE board_id = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';
