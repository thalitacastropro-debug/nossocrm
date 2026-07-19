-- Ana / persona (board SDR c2e36157) — 2026-07-18
-- Bug (lead Cleysson 82ae487d): o lead mandou o NÚMERO do CNPJ ("61590827000197") e a Ana
-- respondeu "Perfeito, em São Paulo então?" — ALUCINOU a cidade a partir do número cru.
-- A regra #5 já dizia "peça só a CIDADE", mas não proibia INFERIR a cidade do número.
-- Fix: aumenta a regra #5 com proibição explícita de deduzir cidade/UF do número + exemplo.
-- Aplicado AO VIVO via MCP (persona é board_ai_config.persona_prompt, sem deploy). Idempotente.
update board_ai_config
set persona_prompt = replace(
  persona_prompt,
  $find$peça só a CIDADE do CNPJ (é o que o consultor usa pra cotar) e siga.$find$,
  $repl$peça só a CIDADE do CNPJ (é o que o consultor usa pra cotar) e siga. NUNCA deduza a cidade ou o estado a partir do NÚMERO do CNPJ — o número não revela a localização; PERGUNTE sempre a cidade, nunca afirme. PROIBIDO (ex.: o lead manda "61590827000197" e você responde "em São Paulo então?" — o certo é "qual a cidade do CNPJ?").$repl$
),
updated_at = now()
where board_id='c2e36157-1b63-43cc-be35-bb1cab7a287f'
  and persona_prompt like '%peça só a CIDADE do CNPJ (é o que o consultor usa pra cotar) e siga.%'
  and persona_prompt not like '%NUNCA deduza a cidade ou o estado a partir do NÚMERO do CNPJ%';
