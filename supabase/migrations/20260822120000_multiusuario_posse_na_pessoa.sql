-- =====================================================================
-- MULTI-USUARIO — ETAPA 1: capacidade, helpers e posse na PESSOA
-- =====================================================================
-- Esta migracao NAO muda o que ninguem enxerga. Ela so cria a estrutura e
-- preenche a posse. A troca das policies vem na etapa 2, separada de
-- proposito para dar chance de conferir os numeros no meio do caminho.
--
-- Decisoes da Thalita (22/08/2026):
--  - a posse e da PESSOA (contato), nao do card. A Niva atende por UM numero
--    de WhatsApp e a conversa pertence ao contato: dois consultores donos da
--    mesma pessoa falariam com ela pela mesma thread.
--  - quem ja tinha a pessoa fica com ela quando ela reaparece.
--  - o Denilson enxerga a carteira do time inteiro, sem virar admin.
-- =====================================================================

-- 1) Capacidade "enxerga o time", separada do papel.
--    Por que nao um papel 'gestor': ROLE_VALUES em lib/rbac.ts, os schemas Zod e
--    a tela de Usuarios enumeram os papeis. Um papel novo obrigaria a mexer em
--    todos eles so para expressar visibilidade. A capacidade e aditiva, nao toca
--    em nenhuma regra de rota e e lida apenas pela RLS.
alter table public.profiles
  add column if not exists ve_todos_os_leads boolean not null default false;

comment on column public.profiles.ve_todos_os_leads is
  'Enxerga os leads de todos os consultores (socio/gestor), sem os poderes de admin. Lido pela RLS.';

-- 2) Helpers usados pelas policies da etapa 2.
create or replace function public.minha_org()
returns uuid language sql stable security definer set search_path = public as $$
  select p.organization_id from public.profiles p where p.id = (select auth.uid());
$$;

create or replace function public.ve_tudo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and (p.role = 'admin' or p.ve_todos_os_leads = true)
  );
$$;

comment on function public.ve_tudo() is
  'true para admin ou para quem tem ve_todos_os_leads. Base das policies de deals/contacts/activities/conversas.';

create or replace function public.sou_dono_do_contato(p_contact_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_contact_id is not null and exists (
    select 1 from public.contacts c
    where c.id = p_contact_id and c.owner_id = (select auth.uid())
  );
$$;

grant execute on function public.minha_org() to authenticated;
grant execute on function public.ve_tudo() to authenticated;
grant execute on function public.sou_dono_do_contato(uuid) to authenticated;

-- 3) O Denilson enxerga o time.
update public.profiles
   set ve_todos_os_leads = true
 where email = 'denilsonnivaconsultoria@gmail.com';

-- 4) Posse na pessoa: o contato herda o dono do card, mas SO quando nao ha
--    ambiguidade (todos os cards vivos daquela pessoa apontam para o mesmo dono).
--    Contato ambiguo fica sem dono de proposito — melhor sem dono e visivel para
--    admin/gestor do que atribuido errado.
with donos as (
  select d.contact_id, min(d.owner_id::text)::uuid as dono
  from public.deals d
  where d.contact_id is not null
    and d.owner_id is not null
    and d.deleted_at is null
    and coalesce(d.is_lost,false) = false
  group by d.contact_id
  having count(distinct d.owner_id) = 1
)
update public.contacts c
   set owner_id = donos.dono
  from donos
 where c.id = donos.contact_id
   and c.owner_id is distinct from donos.dono;

-- 5) A conversa segue a pessoa.
update public.messaging_conversations mc
   set assigned_user_id = c.owner_id
  from public.contacts c
 where c.id = mc.contact_id
   and c.owner_id is not null
   and mc.assigned_user_id is distinct from c.owner_id;
