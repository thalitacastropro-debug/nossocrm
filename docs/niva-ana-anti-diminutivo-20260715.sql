-- niva-ana-anti-diminutivo-20260715.sql
-- Tuning de persona (ana-tuning-log #8, 2026-07-15): a Ana ao vivo escreveu
-- "anota aqui na minha listinha" — diminutivo ("listinha") + narrar processo interno (tell de bot).
-- Adiciona "listinha"/"cotaçãozinha" aos diminutivos proibidos e proíbe narrar que está anotando.
-- Aplicado ao vivo via MCP em 2026-07-15 (replace() cirúrgico, sem reescrever a persona inteira).
-- Board da Ana (SDR): c2e36157-1b63-43cc-be35-bb1cab7a287f.

update board_ai_config
set persona_prompt = replace(
  persona_prompt,
  'sem diminutivos ("minutinho", "rapidinho", "perguntinha", "certinho").',
  'sem diminutivos ("minutinho", "rapidinho", "perguntinha", "certinho", "listinha", "cotaçãozinha"). NUNCA narre seu processo interno como se anotasse ("anoto na minha lista", "anota aqui na minha lista", "deixa eu anotar", "vou registrar") — uma consultora humana não fala assim; incorpore o dado e siga.'
)
where board_id = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';
