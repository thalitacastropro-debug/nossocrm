-- =====================================================================
-- roadmap_items + roadmap_votes — o mural de melhorias do time
-- =====================================================================
-- Pedido da Thalita em 31/08/2026: *"um roadmap onde os colaboradores podem ir
-- colocando as melhorias que eles acham que deveria ter, e o que ja foi
-- aprovado, o que ja foi feito"* — no molde do roadmap publico do SuperSchema
-- (Ideas -> Prioritized -> In Progress -> Launched, com voto).
--
-- POR QUE ISTO EXISTE: hoje toda melhoria chega por WhatsApp para a Thalita e
-- morre no scroll. O consultor que sente a dor (o Pedro pediu telefone no card,
-- o Denilson pediu som de mensagem nova) nao tem onde registrar, e ninguem no
-- time consegue ver o que ja foi decidido — entao o mesmo pedido volta.
--
-- AS ETAPAS, e o que cada uma significa:
--   sugerido    -> qualquer colaborador escreveu. Ninguem prometeu nada.
--   aprovado    -> a dona decidiu que vai ser feito (ainda sem data).
--   em_andamento-> alguem esta construindo.
--   feito       -> esta no ar.
--   recusado    -> decidido que NAO vai ser feito, com o motivo escrito.
-- "recusado" existe de proposito: sem ele a lista vira cemiterio e o time perde
-- a confianca de que alguem le. Uma recusa com motivo ensina mais que silencio.
--
-- QUEM PODE O QUE: qualquer membro sugere e vota; SO admin muda de etapa.
-- Aprovar e uma decisao de dona (a Thalita e o Denilson sao os admins — ver
-- a decisao de 26/08 de nao promover mais ninguem). O autor pode corrigir o
-- proprio texto ENQUANTO estiver em "sugerido"; depois de decidido, congela —
-- senao alguem reescreve o pedido depois de aprovado e a decisao vira outra.
--
-- ROLLBACK no fim do arquivo.
-- =====================================================================

-- --------------------------------------------------------- 1) as tabelas
create table if not exists public.roadmap_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null,
  description     text,
  -- Onde dói: 'crm', 'ana', 'whatsapp', 'relatorios'... texto livre de
  -- proposito. Uma lista fechada envelheceria a cada modulo novo, e o valor
  -- aqui e agrupar visualmente, nao validar.
  area            text,
  status          text not null default 'sugerido'
                    check (status in ('sugerido','aprovado','em_andamento','feito','recusado')),
  created_by      uuid references public.profiles(id) on delete set null,
  -- Quem decidiu (aprovou/recusou/entregou) e por que. `decision_note` e o que
  -- transforma "recusado" em resposta, e nao em porta na cara.
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

comment on table public.roadmap_items is
  'Mural de melhorias do time: o colaborador sugere, o admin aprova, todo mundo ve o que ja foi feito. Pedido da Thalita em 31/08/2026.';
comment on column public.roadmap_items.status is
  'sugerido -> aprovado -> em_andamento -> feito. "recusado" e um fim legitimo, sempre com decision_note.';
comment on column public.roadmap_items.decision_note is
  'O motivo da decisao. Obrigatorio na pratica quando recusa: e o que faz o time continuar sugerindo.';

create index if not exists roadmap_items_org_status_idx
  on public.roadmap_items (organization_id, status) where deleted_at is null;

-- Um voto por pessoa por item. A PK composta E a regra — nao precisa de guarda
-- no app para "ja votei".
create table if not exists public.roadmap_votes (
  item_id    uuid not null references public.roadmap_items(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

comment on table public.roadmap_votes is
  'Voto de "eu tambem preciso disso". Serve para a dona priorizar entre sugestoes, nao para decidir sozinho.';

create index if not exists roadmap_votes_item_idx on public.roadmap_votes (item_id);

-- ------------------------------------------- 2) carimbo automatico da decisao
-- Feito no BANCO e nao na rota: a etapa tambem muda por SQL na mao (foi assim
-- que o time consertou card orfao, posse de lead e prêmio em agosto), e um
-- carimbo que so existe na rota mente exatamente nesses casos.
-- SECURITY INVOKER de proposito: um BEFORE trigger que so mexe no NEW roda
-- depois da RLS de quem escreveu, entao nao precisa de DEFINER — e com DEFINER
-- o linter do Supabase acusa (certo) que a funcao fica chamavel por RPC em
-- /rest/v1/rpc/, ate por anon. O `revoke` abaixo fecha o resto.
create or replace function public.roadmap_carimba_decisao()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  new.updated_at := now();

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'sugerido' then
      -- Voltou para a fila: limpa o carimbo, senao fica um "decidido por" preso
      -- a uma decisao que foi desfeita.
      new.decided_by := null;
      new.decided_at := null;
    else
      new.decided_by := coalesce(new.decided_by, (select auth.uid()));
      new.decided_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.roadmap_carimba_decisao() from public, anon, authenticated;

drop trigger if exists roadmap_items_carimba_decisao on public.roadmap_items;
create trigger roadmap_items_carimba_decisao
  before update on public.roadmap_items
  for each row execute function public.roadmap_carimba_decisao();

-- -------------------------------------------------------- 3) as policies
alter table public.roadmap_items enable row level security;
alter table public.roadmap_votes enable row level security;

drop policy if exists roadmap_items_select on public.roadmap_items;
drop policy if exists roadmap_items_insert on public.roadmap_items;
drop policy if exists roadmap_items_update_admin on public.roadmap_items;
drop policy if exists roadmap_items_update_autor on public.roadmap_items;
drop policy if exists roadmap_items_delete on public.roadmap_items;

-- Ler: qualquer membro da organizacao. O ponto do mural e ser visivel — e o
-- que evita o mesmo pedido chegar tres vezes.
create policy roadmap_items_select on public.roadmap_items for select to authenticated
using (organization_id = public.minha_org());

-- Sugerir: qualquer membro, no proprio nome e SEMPRE em 'sugerido'. O
-- `status = 'sugerido'` no with check e o que impede alguem de nascer aprovado.
create policy roadmap_items_insert on public.roadmap_items for insert to authenticated
with check (
  organization_id = public.minha_org()
  and created_by = (select auth.uid())
  and status = 'sugerido'
);

-- Mover de etapa: so admin.
create policy roadmap_items_update_admin on public.roadmap_items for update to authenticated
using (public.e_admin() and organization_id = public.minha_org())
with check (public.e_admin() and organization_id = public.minha_org());

-- Autor corrige o proprio texto enquanto ninguem decidiu. O `status` nas duas
-- clausulas congela o item no instante em que ele sai da fila.
create policy roadmap_items_update_autor on public.roadmap_items for update to authenticated
using (
  organization_id = public.minha_org()
  and created_by = (select auth.uid())
  and status = 'sugerido'
)
with check (
  organization_id = public.minha_org()
  and created_by = (select auth.uid())
  and status = 'sugerido'
);

-- Apagar de vez: so admin (o autor "apaga" pedindo, ou o admin recusa com
-- motivo — que e melhor do que sumir com o registro).
create policy roadmap_items_delete on public.roadmap_items for delete to authenticated
using (public.e_admin() and organization_id = public.minha_org());

drop policy if exists roadmap_votes_select on public.roadmap_votes;
drop policy if exists roadmap_votes_insert on public.roadmap_votes;
drop policy if exists roadmap_votes_delete on public.roadmap_votes;

-- Votos sao visiveis para quem enxerga o item (a subconsulta reaproveita a
-- policy de leitura acima).
create policy roadmap_votes_select on public.roadmap_votes for select to authenticated
using (exists (select 1 from public.roadmap_items i where i.id = item_id));

-- Votar e desvotar: so no proprio nome.
create policy roadmap_votes_insert on public.roadmap_votes for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.roadmap_items i where i.id = item_id)
);

create policy roadmap_votes_delete on public.roadmap_votes for delete to authenticated
using (user_id = (select auth.uid()));

-- =====================================================================
-- ROLLBACK (colar no editor SQL):
--
--   drop trigger if exists roadmap_items_carimba_decisao on public.roadmap_items;
--   drop function if exists public.roadmap_carimba_decisao();
--   drop table if exists public.roadmap_votes;
--   drop table if exists public.roadmap_items;
--
-- Atencao: o drop APAGA as sugestoes do time. Para so tirar a tela do ar, remova
-- o item 'roadmap' de components/navigation/navConfig.ts e deixe as tabelas.
-- =====================================================================
