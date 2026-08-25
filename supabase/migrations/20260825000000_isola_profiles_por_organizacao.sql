-- =====================================================================
-- profiles: leitura isolada por organização
-- =====================================================================
-- A policy era `profiles_select USING (true)`: QUALQUER usuário logado lia
-- nome, e-mail e papel de TODOS os perfis do banco — incluindo, num futuro
-- multi-empresa, os perfis de outros clientes do CRM. Levantado em 24/08/2026
-- na auditoria do que um vendedor enxerga, e a Thalita mandou arrumar.
--
-- Regra nova: cada um lê o PRÓPRIO perfil e os perfis da PRÓPRIA organização.
-- Não fui além (ex.: esconder colegas de um vendedor) de propósito: o nome do
-- dono aparece no card do funil, na timeline e no chat — esconder o time
-- quebraria a leitura da operação sem ganho real de segurança dentro da mesma
-- empresa. O que precisava sair de vista eram as CREDENCIAIS, e essas já
-- saíram (migração 20260824230000).
--
-- `minha_org()` é SECURITY DEFINER e lê profiles ignorando RLS — por isso não
-- há recursão ao usá-la aqui.
--
-- ROLLBACK:
--   drop policy if exists profiles_select on public.profiles;
--   create policy profiles_select on public.profiles
--     for select to authenticated using (true);
-- =====================================================================

drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or organization_id = public.minha_org()
);
