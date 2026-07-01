-- Agenda real da Ana: consultor responsável por board + trava de corrida no calendário.

-- 1. Quem é o consultor que recebe a ligação (owner_id das activities criadas pela Ana).
ALTER TABLE public.board_ai_config
  ADD COLUMN IF NOT EXISTS consultant_user_id UUID REFERENCES public.profiles(id);

COMMENT ON COLUMN public.board_ai_config.consultant_user_id IS
  'Consultor que recebe a ligação agendada pela SDR. NULL => Ana cai no interino (só preferência).';

-- 2. Trava de corrida: impede dois leads no mesmo horário do mesmo consultor.
--    Só ligações (CALL) ativas. Colisão => o booker trata como slot_taken e re-oferece.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_consultant_call_slot
  ON public.activities (owner_id, date)
  WHERE type = 'CALL' AND deleted_at IS NULL;
