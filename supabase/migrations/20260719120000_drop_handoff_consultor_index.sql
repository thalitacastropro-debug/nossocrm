-- Handoff Ana->Consultor virou MOVE (nao copia mais) apos revisao adversarial (2026-07-19):
-- copiar deixava DUAS fontes de verdade (a activity CALL e as mutacoes ficam no deal; o card
-- copiado congelava). Movendo o proprio deal, a CALL/reuniao_agendada/tier viajam juntos.
-- O indice unico parcial deals_handoff_origin_uniq existia so p/ travar copias duplicadas do
-- namespace NEXT_BOARD_SCHEDULING; sem copias, fica inerte. Dropar por higiene.
DROP INDEX IF EXISTS deals_handoff_origin_uniq;
