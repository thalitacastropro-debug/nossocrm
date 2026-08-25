-- =====================================================================
-- FECHA: credenciais legíveis por vendedor · organização editável por
--        qualquer logado · itens de negócio abertos
-- =====================================================================
-- Levantado em 24/08/2026, quando a Thalita perguntou "quais áreas do CRM um
-- vendedor não deveria ter acesso?" — com o Pedro já cadastrado. Cada item
-- abaixo foi PROVADO impersonando o login dele (`set local request.jwt.claims`).
--
-- 1) organization_settings — a policy "Members can view org settings" dava
--    SELECT da LINHA INTEIRA para qualquer membro. Teste com o login do Pedro:
--    ele lia `ai_google_key`, `ai_anthropic_key`, `telegram_bot_token` e
--    `internal_api_secret`. A tela nem era necessária: sai pela API REST.
--    A rota /api/settings/ai já fazia a coisa certa (mascara e só para admin);
--    o vazamento era o acesso direto à tabela. Ela passa a ler com service role.
--
-- 2) organizations — policy `FOR ALL USING (deleted_at IS NULL)`: qualquer
--    usuário logado podia RENOMEAR ou APAGAR a organização. Teste com o login
--    do Pedro: 1 linha renomeada. Agora leitura para a própria org e escrita só
--    para admin.
--
-- 3) deal_items — policy `FOR ALL USING (true)`: qualquer logado editava ou
--    apagava itens de QUALQUER negócio. Hoje a tabela está vazia (impacto zero
--    agora, furo latente). Passa a seguir o negócio: quem enxerga o card mexe
--    nos itens dele.
--
-- ROLLBACK no fim do arquivo.
-- =====================================================================

-- ------------------------------------------- 1) credenciais da organização
-- Admin continua com SELECT pela policy "Admins can manage org settings" (FOR
-- ALL cobre SELECT) — por isso basta remover a policy dos membros.
drop policy if exists "Members can view org settings" on public.organization_settings;

-- ------------------------------------------------------ 2) organizations
drop policy if exists authenticated_access on public.organizations;

create policy organizations_select on public.organizations for select to authenticated
using (deleted_at is null and id = public.minha_org());

create policy organizations_insert on public.organizations for insert to authenticated
with check (public.e_admin());

create policy organizations_update on public.organizations for update to authenticated
using (public.e_admin() and id = public.minha_org())
with check (public.e_admin() and id = public.minha_org());

create policy organizations_delete on public.organizations for delete to authenticated
using (public.e_admin() and id = public.minha_org());

-- -------------------------------------------------------- 3) deal_items
drop policy if exists "Enable all access for authenticated users" on public.deal_items;

create policy deal_items_select on public.deal_items for select to authenticated
using (
  exists (
    select 1 from public.deals d
    where d.id = deal_items.deal_id
      and public.pode_ver_board(d.board_id)
      and (
        public.ve_tudo()
        or d.owner_id = (select auth.uid())
        or public.sou_dono_do_contato(d.contact_id)
      )
  )
);

create policy deal_items_write on public.deal_items for all to authenticated
using (
  exists (
    select 1 from public.deals d
    where d.id = deal_items.deal_id
      and public.pode_ver_board(d.board_id)
      and (
        public.ve_tudo()
        or d.owner_id = (select auth.uid())
        or public.sou_dono_do_contato(d.contact_id)
      )
  )
)
with check (
  exists (
    select 1 from public.deals d
    where d.id = deal_items.deal_id
      and public.pode_ver_board(d.board_id)
      and (
        public.ve_tudo()
        or d.owner_id = (select auth.uid())
        or public.sou_dono_do_contato(d.contact_id)
      )
  )
);

-- =====================================================================
-- ROLLBACK (se algo parar de carregar para quem não é admin):
--
--   create policy "Members can view org settings" on public.organization_settings
--     for select to authenticated
--     using (organization_id = public.minha_org());   -- <- volta o vazamento
--
--   drop policy if exists organizations_select on public.organizations;
--   drop policy if exists organizations_insert on public.organizations;
--   drop policy if exists organizations_update on public.organizations;
--   drop policy if exists organizations_delete on public.organizations;
--   create policy authenticated_access on public.organizations
--     for all to authenticated using (deleted_at is null);
--
--   drop policy if exists deal_items_select on public.deal_items;
--   drop policy if exists deal_items_write on public.deal_items;
--   create policy "Enable all access for authenticated users" on public.deal_items
--     for all to authenticated using (true);
-- =====================================================================
