-- 20260713140000_lead_followup_cron.sql
-- Agenda o cron de follow-up (a cada 15 min) chamando o endpoint via pg_net.
-- PRÉ-REQUISITOS DE RUNBOOK (fora desta migration):
--   1) Habilitar pg_cron no dashboard: Database > Extensions (pg_net já está instalado).
--   2) Criar os secrets no Vault:
--        select vault.create_secret('https://nossocrm-wheat.vercel.app/api/cron/lead-followup', 'lead_followup_url');
--        select vault.create_secret('<CRON_SECRET de producao>', 'cron_secret');
-- Aplicar esta migration é seguro mesmo antes dos secrets: eles são lidos quando o job DISPARA.

-- Idempotência: remove um agendamento anterior, se houver.
DO $$
BEGIN
  PERFORM cron.unschedule('lead-followup');
EXCEPTION WHEN OTHERS THEN
  NULL; -- não existia (ou pg_cron off): segue
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'lead-followup',
    '*/15 * * * *', -- a cada 15 min; o endpoint filtra o horário comercial
    $cmd$
      SELECT net.http_get(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lead_followup_url'),
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
        )
      );
    $cmd$
  );
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'pg_cron indisponivel — habilite a extensao no dashboard e reaplique esta migration';
END $$;
