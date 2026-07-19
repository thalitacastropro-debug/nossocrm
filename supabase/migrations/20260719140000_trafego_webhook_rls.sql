-- Papel 'trafego' (parceiro de trafego, ex.: Lobato) configura a ENTRADA de leads (webhook-in)
-- em Configuracoes -> Webhooks. As tabelas do intake sao admin-only via RLS; abrimos o INBOUND
-- (fontes de entrada + log de eventos recebidos) tambem p/ 'trafego', com policies EXPLICITAS
-- (as de admin ficam intactas). NAO abrimos integration_outbound_endpoints (follow-up p/ fora):
-- trafego so cuida da entrada — menos superficie de exfiltracao.
create policy "Trafego can manage inbound sources"
  on integration_inbound_sources for all to authenticated
  using (auth.uid() in (
    select id from profiles
    where organization_id = integration_inbound_sources.organization_id and role = 'trafego'))
  with check (auth.uid() in (
    select id from profiles
    where organization_id = integration_inbound_sources.organization_id and role = 'trafego'));

create policy "Trafego can view inbound webhook events"
  on webhook_events_in for select to authenticated
  using (auth.uid() in (
    select id from profiles
    where organization_id = webhook_events_in.organization_id and role = 'trafego'));
