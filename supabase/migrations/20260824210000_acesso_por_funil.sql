-- =====================================================================
-- ACESSO POR FUNIL — o admin concede, pessoa a pessoa, funil a funil
-- =====================================================================
-- Decisao da Thalita (24/08/2026): "eu como adm concedo manualmente o acesso
-- aos funis; quando tivermos um time de implantacao, eles nao precisam ver
-- outros funis e assim por diante, dependendo da area que a pessoa atua".
--
-- O QUE ESTAVA ERRADO ANTES DESTA MIGRACAO:
--   boards e board_stages tinham policy literal `true` nos QUATRO comandos.
--   Qualquer usuario logado (inclusive um vendedor recem-convidado) enxergava
--   os 5 funis E podia APAGAR funil e etapa. O isolamento de 22/08 protegeu
--   deals/contacts/activities/conversas pela posse da pessoa, mas deixou a
--   estrutura dos funis aberta.
--
-- MODELO: default-DENY por funil.
--   - admin (profiles.role='admin') enxerga e administra TODOS os funis, sempre,
--     sem precisar de linha em board_access.
--   - qualquer outro papel enxerga SO os funis concedidos em board_access.
--   - so admin cria/edita/apaga funil e etapa.
--
-- ESTADO SEMEADO AQUI (confere com o banco em 24/08):
--   Thalita  = admin        -> os 5 funis, por ser admin
--   Denilson = vendedor     -> os 5 funis, concedidos explicitamente
--   Pedro    = vendedor     -> so "Comercial — Consultor"
--
-- ROLLBACK no fim do arquivo.
-- =====================================================================

-- ------------------------------------------------------- 1) a concessao
create table if not exists public.board_access (
  board_id   uuid not null references public.boards(id)   on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

comment on table public.board_access is
  'Quais funis cada pessoa enxerga. Admin nao precisa de linha aqui — ve todos. Default-deny para os demais papeis.';

create index if not exists board_access_user_idx on public.board_access(user_id);

alter table public.board_access enable row level security;

-- ---------------------------------------------------------- 2) helpers
create or replace function public.e_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

comment on function public.e_admin() is
  'true so para profiles.role = admin. Base das policies de estrutura (boards/board_stages/board_access).';

create or replace function public.pode_ver_board(p_board_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.e_admin() or (
    p_board_id is not null and exists (
      select 1 from public.board_access ba
      where ba.board_id = p_board_id and ba.user_id = (select auth.uid())
    )
  );
$$;

comment on function public.pode_ver_board(uuid) is
  'Admin ve qualquer funil; os demais so os concedidos em board_access.';

grant execute on function public.e_admin() to authenticated;
grant execute on function public.pode_ver_board(uuid) to authenticated;

-- ------------------------------------------- 3) policies de board_access
drop policy if exists board_access_select on public.board_access;
drop policy if exists board_access_write  on public.board_access;

-- A pessoa enxerga as proprias concessoes (a UI precisa saber o que ela tem);
-- o admin enxerga as de todo mundo para montar a tela de Equipe.
create policy board_access_select on public.board_access for select to authenticated
using (public.e_admin() or user_id = (select auth.uid()));

create policy board_access_write on public.board_access for all to authenticated
using (public.e_admin()) with check (public.e_admin());

-- ------------------------------------------------- 4) policies de boards
drop policy if exists "Enable read access for authenticated users"   on public.boards;
drop policy if exists "Enable insert access for authenticated users" on public.boards;
drop policy if exists "Enable update access for authenticated users" on public.boards;
drop policy if exists "Enable delete access for authenticated users" on public.boards;

create policy boards_select on public.boards for select to authenticated
using (public.pode_ver_board(id));

-- Criar, renomear e apagar funil e de admin. Um vendedor derrubar o funil SDR
-- inteiro era possivel ate esta migracao.
create policy boards_insert on public.boards for insert to authenticated
with check (public.e_admin());

create policy boards_update on public.boards for update to authenticated
using (public.e_admin()) with check (public.e_admin());

create policy boards_delete on public.boards for delete to authenticated
using (public.e_admin());

-- ------------------------------------------ 5) policies de board_stages
drop policy if exists "Enable read access for authenticated users"   on public.board_stages;
drop policy if exists "Enable insert access for authenticated users" on public.board_stages;
drop policy if exists "Enable update access for authenticated users" on public.board_stages;
drop policy if exists "Enable delete access for authenticated users" on public.board_stages;

create policy board_stages_select on public.board_stages for select to authenticated
using (public.pode_ver_board(board_id));

create policy board_stages_insert on public.board_stages for insert to authenticated
with check (public.e_admin());

create policy board_stages_update on public.board_stages for update to authenticated
using (public.e_admin()) with check (public.e_admin());

create policy board_stages_delete on public.board_stages for delete to authenticated
using (public.e_admin());

-- ------------------------------------------------ 6) o card segue o funil
-- Quem nao enxerga o funil nao enxerga os cards dele, mesmo sendo o dono.
-- Sem isto, um card do Pedro movido para a Nutricao continuaria aparecendo
-- para ele em relatorios e buscas que nao passam pelo seletor de funil.
drop policy if exists deals_select on public.deals;
drop policy if exists deals_update on public.deals;

create policy deals_select on public.deals for select to authenticated
using (
  public.pode_ver_board(board_id)
  and (
    public.ve_tudo()
    or owner_id = (select auth.uid())
    or public.sou_dono_do_contato(contact_id)
  )
);

create policy deals_update on public.deals for update to authenticated
using (
  public.pode_ver_board(board_id)
  and (
    public.ve_tudo() or owner_id = (select auth.uid()) or public.sou_dono_do_contato(contact_id)
  )
)
with check (
  public.pode_ver_board(board_id)
  and (
    public.ve_tudo() or owner_id = (select auth.uid()) or public.sou_dono_do_contato(contact_id)
  )
);

-- ------------------------------------------------------------ 7) o seed
-- Denilson: os 5 funis (ele acompanha a operacao inteira hoje).
insert into public.board_access (board_id, user_id, granted_by)
select b.id, p.id, (select id from public.profiles where role = 'admin' order by created_at limit 1)
from public.boards b
cross join public.profiles p
where p.email = 'denilsonnivaconsultoria@gmail.com'
  and b.deleted_at is null
on conflict do nothing;

-- Pedro: so o funil comercial.
insert into public.board_access (board_id, user_id, granted_by)
select b.id, p.id, (select id from public.profiles where role = 'admin' order by created_at limit 1)
from public.boards b
cross join public.profiles p
where p.email = 'pedrotiozzo22@hotmail.com'
  and b.deleted_at is null
  and b.name like 'Comercial%'
on conflict do nothing;

-- =====================================================================
-- ROLLBACK (colar no editor SQL se algum funil sumir para quem devia ver):
--
--   drop policy if exists boards_select on public.boards;
--   drop policy if exists boards_insert on public.boards;
--   drop policy if exists boards_update on public.boards;
--   drop policy if exists boards_delete on public.boards;
--   create policy "Enable read access for authenticated users" on public.boards
--     for select to authenticated using (true);
--   -- idem para board_stages.
--   -- e devolver deals_select/deals_update sem o pode_ver_board (ver
--   -- 20260822130000_multiusuario_policies.sql).
-- =====================================================================
