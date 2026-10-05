-- O TRIGGER DE LIMPEZA NAO PODE APAGAR REUNIAO: ELA E A META DA SDR (05/10/2026).
--
-- `zz_cancela_compromisso_vencido_do_card_fechado` (migration 20260928170000) cancela com
-- `deleted_at` todo compromisso vencido e nao concluido do card que fecha. A escolha de
-- `deleted_at` em vez de `completed = true` foi deliberada: carimbar "realizada" numa reuniao
-- que nao aconteceu mente na taxa de comparecimento e dispara a regra "marcou realizada, nao
-- escreveu desfecho".
--
-- O que aquele raciocinio NAO viu: `deleted_at` mente na taxa de AGENDAMENTO, que e a unica com
-- META FORMAL e barra na tela. O board "SDR — IA Qualificacao" tem goal_type
-- `meetings_scheduled` e goal_target_value 39/mes, e `countScheduledMeetings`
-- (lib/boards/goalMetrics.ts) conta CALL do mes via `activitiesService.getAll()`, que filtra
-- `.is('deleted_at', null)`. Cancelar a CALL REMOVE do contador um agendamento que existiu —
-- inclusive retroativamente, em mes ja corrido.
--
-- Medido em 05/10: a limpeza manual de 28/09 apagou 7 CALLs e julho caiu de 13 para 5 reunioes
-- visiveis (-62%); uma delas (Gabriel Fernandes, 08/09) derrubou a barra de setembro no meio do
-- mes, sem nada na tela explicando.
--
-- CALL vencida de card fechado ja estava resolvida sem isto: `regraReuniaoVencida`
-- (lib/gestor/regras.ts) ignora card fechado desde o inicio. Ou seja, o trigger nunca precisou
-- tocar em reuniao para o relatorio ficar certo — tocar so custava a metrica.
--
-- O trigger continua valendo para TASK e afins: tarefa vencida de card fechado e lixo de agenda
-- e nao alimenta meta nenhuma.
--
-- Auditoria (tem que devolver zero):
--   select a.id, a.title, a.date from activities a join deals d on d.id = a.deal_id
--   where a.deleted_at is null and a.completed = false and a.date <= now()
--     and a.type <> 'CALL' and (d.is_won or d.is_lost);
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
     and date <= now()
     and type <> 'CALL';

  return null;
end;
$$;

comment on function public.zz_cancela_compromisso_vencido_do_card_fechado() is
  'Ao ganhar/perder um card, cancela (deleted_at) os compromissos vencidos e nao carimbados dele, EXCETO CALL — reuniao alimenta a meta de agendamentos da SDR. O que esta no futuro (lembrete de reabordagem) sobrevive.';

-- Devolve as 7 reunioes canceladas pelo ensaio manual de 28/09 (todas CALL, todas de card ja
-- fechado). Elas voltam a contar na meta e NAO voltam a aparecer na cobranca, porque a regra do
-- gestor ja ignora card fechado. Recorte estreito de proposito: so CALL, so card fechado, so a
-- janela daquela limpeza — nao mexe em remarcacao feita por humano nem pelo booker da Ana.
update public.activities a
   set deleted_at = null
  from public.deals d
 where d.id = a.deal_id
   and a.type = 'CALL'
   and a.completed = false
   and a.deleted_at between '2026-09-28 23:00:00+00' and '2026-09-29 00:00:00+00'
   and (d.is_won or d.is_lost);
