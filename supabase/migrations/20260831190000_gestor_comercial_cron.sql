-- =====================================================================
-- gestor-comercial: o diario da Thalita, 8h, dias uteis
-- =====================================================================
-- Pedido dela em 31/08/2026: *"como se eu fosse fazer uma daily com o
-- colaborador e atenta-lo para o que e necessario e mais urgente daquele dia"*.
-- Um bloco por colaborador; ela recebe tudo.
--
-- ## POR QUE ISTO E UM CRON DO BANCO, E NAO UMA TAREFA AGENDADA DO APP
--
-- Descoberto no mesmo dia: o briefing da Implantacao, criado em 28/08, **nunca
-- foi entregue nenhuma vez**. Cinco execucoes agendadas, cinco mortes — todas
-- nos primeiros segundos, sempre na primeira consulta ao banco, sem erro
-- registrado, nenhuma chegando ao passo do Telegram. E o painel mostrava
-- `lastRunAt` preenchido, entao a tarefa "rodou". Silencio virou "esta tudo bem"
-- por tres dias.
--
-- Tarefa agendada depende do desktop dela estar aberto. pg_cron roda na
-- infraestrutura, 24/7 — e como a cadencia de follow-up da Ana ja funciona
-- (20260713140000_lead_followup_cron.sql).
--
-- ## HORARIO
-- '0 11 * * 1-5' = 11:00 UTC = **08:00 em Brasilia**, segunda a sexta.
-- ⚠️ Offset fixo -03:00 (o Brasil nao tem mais horario de verao desde 2019). Se
-- voltar, este numero muda aqui E no TZ_OFFSET_HOURS do resto do CRM.
-- A rota tambem checa dia util por conta propria: cron e rota nao podem
-- discordar sobre quando o diario existe.
--
-- Reaproveita os MESMOS segredos do vault que o lead-followup usa. O
-- `gestor_comercial_url` precisa existir no vault — ver o bloco no fim.
-- =====================================================================

select cron.unschedule('gestor-comercial')
where exists (select 1 from cron.job where jobname = 'gestor-comercial');

select cron.schedule('gestor-comercial', '0 11 * * 1-5', $cmd$
  SELECT net.http_get(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'gestor_comercial_url'),
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    )
  );
$cmd$);

-- =====================================================================
-- PRE-REQUISITO (uma vez, no editor SQL) — sem isto o job roda e nao faz nada:
--
--   select vault.create_secret(
--     'https://crm.nivaconsultoria.com.br/api/cron/gestor-comercial',
--     'gestor_comercial_url'
--   );
--
-- CONFERIR:
--   select jobname, schedule, active from cron.job where jobname='gestor-comercial';
--   select jobname, status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 5;
--
-- TESTAR NA MAO (sem esperar as 8h):
--   select net.http_get(
--     url := (select decrypted_secret from vault.decrypted_secrets where name='gestor_comercial_url'),
--     headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')));
--
-- ROLLBACK:
--   select cron.unschedule('gestor-comercial');
-- =====================================================================
