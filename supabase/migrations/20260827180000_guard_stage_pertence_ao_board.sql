-- TRAVA CONTRA CARD ÓRFÃO (27/08/2026, caso Richard Gois).
--
-- O card fica INVISÍVEL quando `deals.board_id` aponta para um funil e `deals.stage_id`
-- para uma etapa de OUTRO funil: o kanban do funil A não acha coluna para a etapa do
-- funil B, e o funil B não busca um card cujo board_id é o A. Só aparece por SQL — foi
-- assim que o card do Richard Gois sumiu da operação e ninguém achou.
--
-- Como aconteceu: a automação de desfecho da call moveu o card de funil (board_id) e,
-- 84 segundos depois, a tela — ainda mostrando o funil ANTIGO — gravou o stage_id da
-- etapa "Cancelado" daquele funil por cima. O `useMoveDeal` grava stage_id e nunca
-- board_id, então a incoerência passou sem ninguém perceber.
--
-- O guard do cliente (lib/deals/coerenciaDoMove.ts) resolve o caminho da tela; este
-- trigger é a rede final: qualquer escrita — rota, cron, SQL manual, automação futura —
-- que deixe os dois campos discordando falha na hora, em vez de sumir com o card.
--
-- Um move de funil LEGÍTIMO troca board_id e stage_id na mesma instrução: o trigger olha
-- o estado FINAL da linha, então passa normalmente (testado em produção nos dois sentidos).
--
-- Auditoria (tem que devolver zero):
--   select d.id, d.title from deals d join board_stages bs on bs.id = d.stage_id
--   where d.deleted_at is null and d.board_id <> bs.board_id;
create or replace function public.zz_stage_pertence_ao_board()
returns trigger
language plpgsql
as $$
declare
  board_da_etapa uuid;
begin
  if new.stage_id is null or new.board_id is null then
    return new;
  end if;

  select bs.board_id into board_da_etapa
  from public.board_stages bs
  where bs.id = new.stage_id;

  if board_da_etapa is not null and board_da_etapa <> new.board_id then
    raise exception using
      errcode = 'check_violation',
      message = 'Etapa nao pertence ao funil do card (card ficaria invisivel no kanban).',
      detail  = format('deal=%s board_id=%s stage_id=%s pertence ao board=%s',
                       new.id, new.board_id, new.stage_id, board_da_etapa),
      hint    = 'Ao mover de funil, atualize board_id e stage_id juntos.';
  end if;

  return new;
end;
$$;

drop trigger if exists zz_stage_pertence_ao_board_trg on public.deals;
create trigger zz_stage_pertence_ao_board_trg
  before insert or update of board_id, stage_id on public.deals
  for each row
  execute function public.zz_stage_pertence_ao_board();
