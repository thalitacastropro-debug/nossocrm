-- =====================================================================
-- MULTI-USUARIO — ETAPA 2: as policies (isolamento por pessoa)
-- =====================================================================
-- SO APLICAR DEPOIS DA ETAPA 1 (20260822120000) e depois de conferir os numeros.
--
-- Antes desta migracao, deals/contacts/activities tinham policy literal `true`:
-- qualquer usuario logado enxergava tudo.
--
-- MODO SOMBRA rodado em 22/08/2026, com a posse ja simulada:
--   151 cards abertos · Denilson 21 · sem dono 130
--   Thalita (admin) veria 151 · Denilson COM a capacidade veria 151
--   Denilson SEM a capacidade veria 21  <-- por isso a etapa 1 vem antes
--   45 conversas: 21 do Denilson, 24 sem dono (7 sem card nenhum)
--   1658 mensagens: 1334 seriam do Denilson
-- Ou seja: para quem existe hoje, esta migracao e um NO-OP visual.
--
-- REGRA DO CARD SEM DONO: ele NAO fica invisivel para todos — admin e gestor
-- continuam vendo. E o modo de falha mais perigoso deste projeto e por isso e
-- explicito aqui: 130 dos 151 cards abertos estao sem dono hoje.
--
-- ROLLBACK: cada bloco tem o `create policy ... using (true)` equivalente
-- comentado no fim do arquivo.
-- =====================================================================

-- ---------------------------------------------------------------- deals
drop policy if exists "Enable all access for authenticated users" on public.deals;

create policy deals_select on public.deals for select to authenticated
using (
  public.ve_tudo()
  or owner_id = (select auth.uid())
  or public.sou_dono_do_contato(contact_id)
);

create policy deals_insert on public.deals for insert to authenticated
with check (organization_id = public.minha_org());

create policy deals_update on public.deals for update to authenticated
using (
  public.ve_tudo() or owner_id = (select auth.uid()) or public.sou_dono_do_contato(contact_id)
)
with check (
  public.ve_tudo() or owner_id = (select auth.uid()) or public.sou_dono_do_contato(contact_id)
);

-- Apagar card e de admin/gestor. Consultor perde lead marcando como perdido,
-- que e reversivel; delete nao e.
create policy deals_delete on public.deals for delete to authenticated
using (public.ve_tudo());

-- ------------------------------------------------------------- contacts
drop policy if exists "Enable all access for authenticated users" on public.contacts;

create policy contacts_select on public.contacts for select to authenticated
using (public.ve_tudo() or owner_id = (select auth.uid()));

create policy contacts_insert on public.contacts for insert to authenticated
with check (organization_id = public.minha_org() or organization_id is null);

create policy contacts_update on public.contacts for update to authenticated
using (public.ve_tudo() or owner_id = (select auth.uid()))
with check (public.ve_tudo() or owner_id = (select auth.uid()));

create policy contacts_delete on public.contacts for delete to authenticated
using (public.ve_tudo());

-- ----------------------------------------------------------- activities
-- A atividade nao tem posse propria confiavel (owner_id preenchido em 16 de 51):
-- ela deriva do card. Atividade sem card cai no dono dela.
drop policy if exists "Enable all access for authenticated users" on public.activities;

create policy activities_select on public.activities for select to authenticated
using (
  public.ve_tudo()
  or owner_id = (select auth.uid())
  or exists (
    select 1 from public.deals d
    where d.id = activities.deal_id
      and (d.owner_id = (select auth.uid()) or public.sou_dono_do_contato(d.contact_id))
  )
);

create policy activities_insert on public.activities for insert to authenticated
with check (organization_id = public.minha_org() or organization_id is null);

create policy activities_update on public.activities for update to authenticated
using (
  public.ve_tudo()
  or owner_id = (select auth.uid())
  or exists (
    select 1 from public.deals d
    where d.id = activities.deal_id
      and (d.owner_id = (select auth.uid()) or public.sou_dono_do_contato(d.contact_id))
  )
);

create policy activities_delete on public.activities for delete to authenticated
using (public.ve_tudo() or owner_id = (select auth.uid()));

-- ---------------------------------------------- conversas e MENSAGENS
-- A regra antiga era por business_unit e tinha DOIS defeitos:
--   1) unidade unica com zero membros = Inbox vazio (o Denilson ficou 0 de 45);
--   2) a CONVERSA era protegida por unidade mas a MENSAGEM so por organizacao —
--      esconder a conversa nao escondia o conteudo dela.
-- Agora as duas derivam da mesma regra: a conversa segue a PESSOA.
drop policy if exists "Users view conversations in accessible units" on public.messaging_conversations;
drop policy if exists "Users update conversations they can access" on public.messaging_conversations;

create policy conversas_select on public.messaging_conversations for select to authenticated
using (
  organization_id = public.minha_org()
  and (
    public.ve_tudo()
    or assigned_user_id = (select auth.uid())
    or public.sou_dono_do_contato(contact_id)
  )
);

create policy conversas_update on public.messaging_conversations for update to authenticated
using (
  organization_id = public.minha_org()
  and (
    public.ve_tudo()
    or assigned_user_id = (select auth.uid())
    or public.sou_dono_do_contato(contact_id)
  )
);

drop policy if exists "Users view messages in accessible conversations" on public.messaging_messages;
drop policy if exists "Users insert messages to accessible conversations" on public.messaging_messages;

create policy mensagens_select on public.messaging_messages for select to authenticated
using (
  exists (
    select 1 from public.messaging_conversations c
    where c.id = messaging_messages.conversation_id
      and c.organization_id = public.minha_org()
      and (
        public.ve_tudo()
        or c.assigned_user_id = (select auth.uid())
        or public.sou_dono_do_contato(c.contact_id)
      )
  )
);

create policy mensagens_insert on public.messaging_messages for insert to authenticated
with check (
  exists (
    select 1 from public.messaging_conversations c
    where c.id = messaging_messages.conversation_id
      and c.organization_id = public.minha_org()
      and (
        public.ve_tudo()
        or c.assigned_user_id = (select auth.uid())
        or public.sou_dono_do_contato(c.contact_id)
      )
  )
);

-- =====================================================================
-- ROLLBACK (colar no editor SQL se algo sumir do funil):
--
--   drop policy if exists deals_select on public.deals;
--   drop policy if exists deals_insert on public.deals;
--   drop policy if exists deals_update on public.deals;
--   drop policy if exists deals_delete on public.deals;
--   create policy "Enable all access for authenticated users" on public.deals
--     for all to authenticated using (true);
--   -- idem para contacts e activities.
-- =====================================================================
