-- Handoff Ana->Consultor: garante no MAXIMO uma copia viva por deal de origem.
-- O handoff server-side (lib/ai/scheduling/handoff.ts) cria uma copia do deal no
-- proximo board da jornada (boards.next_board_id) quando a reuniao e confirmada.
-- Este indice parcial e a trava atomica real contra duplicacao (espelha a filosofia
-- do booker): duas mensagens do lead processadas em paralelo -> a 2a tentativa de
-- copia colide (23505) e o codigo trata como ja-feita. Namespace 'NEXT_BOARD_SCHEDULING'
-- e distinto do 'NEXT_BOARD' do useMoveDeal, entao nao afeta as copias manuais existentes.
CREATE UNIQUE INDEX IF NOT EXISTS deals_handoff_origin_uniq
  ON deals ((custom_fields->>'originDealId'))
  WHERE custom_fields->>'originAutomation' = 'NEXT_BOARD_SCHEDULING'
    AND deleted_at IS NULL;
