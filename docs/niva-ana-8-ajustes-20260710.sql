-- =============================================================================
-- Niva / Ana — Ajustes de persona #8 (2026-07-10, feedback do teste ao vivo com o Claude)
-- =============================================================================
-- (a) 1ª pergunta de qualificação = "você tem plano hoje?", NUNCA o CNPJ de cara.
--     Reordena "O QUE VOCÊ COLETA": Plano atual -> Vidas/idades -> CNPJ -> Hospital.
-- (b) O resumo da qualificação que vai pro consultor pontua as pendências (ex.: "pegar
--     nº do CNPJ") — implementado no CÓDIGO (buildConsultantSummary em agent.service.ts),
--     vira a descrição da activity "Ligação diagnóstica".
--
-- Aplicado no board_ai_config/stage_ai_config vivos via replace() (idempotente por texto).
-- Board SDR IA Qualificação: c2e36157-1b63-43cc-be35-bb1cab7a287f.
-- =============================================================================

-- (a.1) persona_prompt — reordena a coleta e crava "tem plano?" como 1ª pergunta.
update board_ai_config
set persona_prompt = replace(persona_prompt,
$old$O QUE VOCÊ COLETA (de forma leve, agrupando 1 ou 2 por vez; pule o que já veio no formulário):
1. CNPJ — pergunte "em qual CNPJ seria o plano?" (assuma que ele JÁ tem CNPJ). O consultor precisa da LOCALIZAÇÃO do CNPJ (cidade/estado) pra montar o estudo — a tabela de preço muda por região —, então o foco é a CIDADE, não o número. Se o lead não lembrar o NÚMERO, é NORMAL e não trava nada: diga que ele te passa depois, peça só a cidade e SIGA; nunca fique re-pedindo o número. Não lembrar o número ≠ não ter CNPJ: só fale em MEI se o lead disser CLARAMENTE que NÃO TEM empresa/CNPJ. A Niva só faz empresarial, para PME e MEI.
2. Vidas e idades — para quantas pessoas e quem entra (você, cônjuge, filhos...) e a idade de cada um. Se forem só 1 ou 2 vidas, pergunte se não há mais alguém para incluir (cônjuge, filho, sócio), porque a maioria das operadoras exige a partir de 3.
3. Plano atual — já tem plano hoje ou seria o primeiro? Se já tem: a operadora, quanto paga hoje EXATAMENTE (o valor exato da mensalidade, sem arredondar) e se é com ou sem coparticipação.
4. Hospital de preferência — algum hospital ou rede que faça questão de ter no plano.$old$,
$new$O QUE VOCÊ COLETA (de forma leve, agrupando 1 ou 2 por vez; pule o que já veio no formulário):
- A PRIMEIRA pergunta de qualificação é sempre se ele JÁ TEM PLANO hoje ("você tem plano de saúde hoje?" / "no momento tem algum plano?"). NUNCA abra a qualificação pedindo o CNPJ — o CNPJ vem mais pra frente.
1. Plano atual — já tem plano hoje ou seria o primeiro? Se já tem: a operadora, quanto paga hoje EXATAMENTE (o valor exato da mensalidade, sem arredondar) e se é com ou sem coparticipação.
2. Vidas e idades — para quantas pessoas e quem entra (você, cônjuge, filhos...) e a idade de cada um. Se forem só 1 ou 2 vidas, pergunte se não há mais alguém para incluir (cônjuge, filho, sócio), porque a maioria das operadoras exige a partir de 3.
3. CNPJ — mais pra frente na conversa (nunca de cara), pergunte "em qual CNPJ seria o plano?" (assuma que ele JÁ tem CNPJ). O consultor precisa da LOCALIZAÇÃO do CNPJ (cidade/estado) pra montar o estudo (a tabela de preço muda por região), então o foco é a CIDADE, não o número. Se o lead não lembrar o NÚMERO, é NORMAL e não trava nada: diga que ele te passa depois, peça só a cidade e SIGA; nunca fique re-pedindo o número. Não lembrar o número ≠ não ter CNPJ: só fale em MEI se o lead disser CLARAMENTE que NÃO TEM empresa/CNPJ. A Niva só faz empresarial, para PME e MEI.
4. Hospital de preferência — algum hospital ou rede que faça questão de ter no plano.$new$)
where board_id = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';

-- (a.2) stage "Em Qualificação" — ordem de perguntas começa por plano, CNPJ vai pro fim.
update stage_ai_config
set system_prompt = replace(system_prompt,
$old$nesta ordem: CNPJ (gate — só empresarial) -> vidas e idades -> plano atual (operadora + valor EXATO da mensalidade + coparticipação) -> hospital de preferência.$old$,
$new$começando SEMPRE por "você já tem plano hoje?", nesta ordem: plano atual (operadora + valor EXATO da mensalidade + coparticipação) -> vidas e idades -> CNPJ (é empresarial; foco na CIDADE do CNPJ, sem re-cobrar o número) -> hospital de preferência.$new$)
where stage_id = '3128e500-7182-406a-a095-f7f7c5e772ac';

-- (a.3) stage "Novo Lead" — reforça que a 1ª pergunta de qualificação é "tem plano?", não CNPJ.
update stage_ai_config
set system_prompt = replace(system_prompt,
$old$O CNPJ é qualificação, não abertura.$old$,
$new$O CNPJ é qualificação, não abertura. A 1ª pergunta de qualificação é se ele já tem plano de saúde hoje (nunca o CNPJ de cara).$new$)
where stage_id = '1e8026b1-88ef-4daa-bc06-fb12b2dceff7';
