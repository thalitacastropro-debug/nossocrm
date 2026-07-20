-- =============================================================================
-- Niva SDR — remover a etapa "Agendado ✓" (limpeza estrutural)  ·  2026-07-20
-- =============================================================================
-- Contexto: com o handoff Ana->Consultor virando MOVE (commit cee18e1), a etapa
-- "agendado" ficou TRANSIENTE — no booking confirmado o deal já sai pro board do
-- Consultor, pulando essa etapa. Removê-la elimina de vez o modo de falha do
-- mis-advancement (bug do Cleysson: o LLM avançava p/ "agendado" sem booking →
-- notify_team → Ana calava) e limpa o funil.
--
-- Org Niva:        d9bf55f7-c66d-439b-97b2-1fceff0fa9b2
-- Board SDR (Ana): c2e36157-1b63-43cc-be35-bb1cab7a287f
-- Etapas:  novo-lead 1e8026b1 (o0) · em-qualificacao 3128e500 (o1) ·
--          AGENDADO 5e8053ef (o2, A REMOVER) · resgate-no-show 4df92e8b (o3) ·
--          descartado 1e30c686 (o4)
--
-- Descobertas (levantamento pré-execução):
--  - boards.won_stage_id da SDR APONTAVA p/ o próprio "agendado" (FK NO ACTION =
--    bloqueia o delete). A SDR não "ganha" deal; ela entrega pro Consultor. → NULL.
--  - 2 deals SOFT-DELETED estavam com stage_id=agendado (a FK deals.stage_id é
--    NO ACTION e ignora deleted_at). São os deals de teste "Thalita - WhatsApp"
--    (09026765, 1f12d98a). → reassinar p/ em-qualificacao antes do delete.
--  - Avanço de etapa é POR ORDEM (getNextStage: order > atual). Sem "agendado",
--    "em-qualificacao" apontaria p/ "resgate-no-show" → por isso esvaziamos os
--    critérios da em-qualificacao (evaluator pula quando advancement_criteria=[]).
--    O deal sai da em-qualificacao pelo MOVE do handoff (no booking), não por avanço.
--  - Código: NENHUMA mudança. probabilityForStage/requiresConfirmedBooking são
--    keyed por NOME de etapa → viram inertes/defensivos (protegem se recriada).
--
-- FKs -> board_stages no delete: stage_ai_config (CASCADE, remove a config do
-- agendado), ai_pending_stage_advances (CASCADE, 0 linhas), demais SET NULL.
-- =============================================================================

BEGIN;

-- 1. Em Qualificação para de auto-avançar (senão avançaria p/ Resgate No-show).
UPDATE stage_ai_config
   SET advancement_criteria = '[]'::jsonb, updated_at = now()
 WHERE stage_id = '3128e500-7182-406a-a095-f7f7c5e772ac';

-- 2. A SDR deixa de ter "won stage" (o ganho real é no board do Consultor).
UPDATE boards
   SET won_stage_id = NULL, updated_at = now()
 WHERE id = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';

-- 3. Tira os 2 deals soft-deleted do "agendado" (destrava a FK deals.stage_id).
UPDATE deals
   SET stage_id = '3128e500-7182-406a-a095-f7f7c5e772ac'
 WHERE stage_id = '5e8053ef-3f71-4629-b5bc-b37eae137069';

-- 4. Remove a etapa "agendado" (cascateia o stage_ai_config dela).
DELETE FROM board_stages
 WHERE id = '5e8053ef-3f71-4629-b5bc-b37eae137069';

COMMIT;

-- =============================================================================
-- ROLLBACK (estado ANTES desta migração, caso precise reverter)
-- =============================================================================
-- BEGIN;
-- -- Recria a etapa "agendado" com o MESMO id.
-- INSERT INTO board_stages (id, board_id, name, label, color, "order", is_default, linked_lifecycle_stage, organization_id)
-- VALUES ('5e8053ef-3f71-4629-b5bc-b37eae137069','c2e36157-1b63-43cc-be35-bb1cab7a287f',
--         'agendado','Agendado ✓','#22c55e',2,false,NULL,'d9bf55f7-c66d-439b-97b2-1fceff0fa9b2');
-- -- Recria o stage_ai_config da etapa.
-- INSERT INTO stage_ai_config (id, organization_id, board_id, stage_id, enabled, system_prompt, stage_goal, advancement_criteria, settings, notify_team)
-- VALUES ('e51c7cc5-f0c2-4cf7-99a0-8131ac2fdf6c','d9bf55f7-c66d-439b-97b2-1fceff0fa9b2','c2e36157-1b63-43cc-be35-bb1cab7a287f','5e8053ef-3f71-4629-b5bc-b37eae137069',
--         true,
--         'Reunião AGENDADA em horário real — o lead está pronto pro consultor. Não envie mais mensagens nesta conversa; o consultor assume a partir daqui (o lembrete anti-no-show é enviado à parte).',
--         'Lead agendado e pronto para a ligação do consultor (handoff + notificação do time).',
--         '["Reunião confirmada em horário real"]'::jsonb, '{}'::jsonb, true);
-- -- Volta o won_stage_id.
-- UPDATE boards SET won_stage_id='5e8053ef-3f71-4629-b5bc-b37eae137069' WHERE id='c2e36157-1b63-43cc-be35-bb1cab7a287f';
-- -- Restaura os critérios da em-qualificacao.
-- UPDATE stage_ai_config SET advancement_criteria='[
--   "Confirmou CNPJ (PME ou MEI) ou aceitou abrir MEI",
--   "Informou o número de vidas e a idade de cada beneficiário",
--   "Informou se já tem plano e, se sim, a operadora, o valor exato e a coparticipação",
--   "Ofereceu horários concretos e o lead aceitou um (reunião marcada em horário real)"
-- ]'::jsonb WHERE stage_id='3128e500-7182-406a-a095-f7f7c5e772ac';
-- -- (os 2 deals soft-deleted 09026765 / 1f12d98a podem ou não voltar p/ agendado; irrelevante)
-- COMMIT;
