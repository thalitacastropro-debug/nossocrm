-- COMPROMISSO VENCIDO EM CARD FECHADO VIRA CANCELADO (28/09/2026).
--
-- O card vira ganho/perdido e a reuniao que estava marcada nele continua ABERTA para sempre.
-- Em 28/09 eram 7 (a mais velha de 13/07): ligacao diagnostica de lead perdido por preco em
-- julho ainda pendurada na agenda de quem abre a tela hoje.
--
-- `regraReuniaoVencida` (lib/gestor/regras.ts) ja ignora card fechado, entao o relatorio do
-- gestor esta certo — mas a LISTA DE ATIVIDADES nao filtra (lib/supabase/activities.ts so olha
-- `deleted_at`). O estrago e o mesmo que o codigo do lembrete de reabordagem ja descreve: quem
-- abre a agenda e ve tarefa morta para de abrir a agenda.
--
-- POR QUE `deleted_at` E NAO `completed = true`:
-- `completed` quer dizer "a reuniao aconteceu". Carimbar isso numa reuniao que nunca aconteceu
-- (a) mente na taxa de comparecimento e (b) joga o card direto na regra `regraContradicao`
-- ("marcou realizada, nao escreveu desfecho") — o relatorio sigiloso da Thalita acusaria o time
-- de um carimbo que quem deu foi o sistema. `deleted_at` ja e o vocabulario de CANCELADO neste
-- schema (o comentario de `activitiesService.list` diz "ex.: reuniao remarcada"), e as duas
-- regras filtram `deleted_at is null`.
--
-- POR QUE SO O QUE JA VENCEU (`date <= now()`):
-- perder um card CRIA uma tarefa de propósito — o lembrete de reabordagem de 09/09
-- (useMoveDeal.ts), sempre com data no futuro. Em 28/09 eram 24 delas ("Reabordar — ...",
-- "Rechecar comercializacao em Ourinhos-SP"). Cancelar tudo do card fechado apagaria a feature
-- inteira. O corte por data separa as duas especies sem depender de titulo nem de tipo.
--
-- POR QUE TRIGGER E NAO CONSERTO NO `useMoveDeal`:
-- sao SEIS caminhos que fecham card — lib/ai/tools.ts (2), lib/supabase/deals.ts (2) e as rotas
-- publicas mark-won/mark-lost — alem da tela. Conserto pontual nesta familia ja voltou duas
-- vezes (owner_id em 09/09 e de novo em 16/09).
--
-- SO NA TRANSICAO (o `when` compara old x new): update posterior num card ja fechado nao pode
-- disparar de novo, senao o lembrete de reabordagem — criado logo DEPOIS do update, e por isso
-- ainda inexistente quando este trigger roda — morreria no proximo toque no card.
--
-- SECURITY DEFINER: a policy de UPDATE de `activities` passa por dono da atividade, dono do card
-- ou `ve_tudo()`. Sem isto, fechar um card cuja atividade e de outra pessoa cancelaria ZERO
-- linhas em silencio — o mesmo modo de falha invisivel do bug de 16/09, que o admin nunca via.
-- O escopo e fechado: so as atividades do card que acabou de ser fechado, sem entrada do usuario.
--
-- Auditoria (tem que devolver zero):
--   select a.id, a.title, a.date from activities a join deals d on d.id = a.deal_id
--   where a.deleted_at is null and a.completed = false and a.date <= now()
--     and (d.is_won or d.is_lost);
create or replace function public.zz_cancela_compromisso_vencido_do_card_fechado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.activities
     set deleted_at = now()
   where deal_id = new.id
     and deleted_at is null
     and completed = false
     and date <= now();

  return null;
end;
$$;

comment on function public.zz_cancela_compromisso_vencido_do_card_fechado() is
  'Ao ganhar/perder um card, cancela (deleted_at) os compromissos dele que ja venceram e ninguem carimbou. O que esta no futuro — lembrete de reabordagem — sobrevive.';

drop trigger if exists zz_cancela_compromisso_vencido_trg on public.deals;
create trigger zz_cancela_compromisso_vencido_trg
  after update of is_won, is_lost on public.deals
  for each row
  when (
    (new.is_won is true or new.is_lost is true)
    and (
      old.is_won is distinct from new.is_won
      or old.is_lost is distinct from new.is_lost
    )
  )
  execute function public.zz_cancela_compromisso_vencido_do_card_fechado();
