-- =====================================================================
-- ad_creatives — de qual criativo (video) o lead veio
-- =====================================================================
-- Registro no repo de um DDL que JA foi aplicado no banco em 26/08/2026
-- (projeto htmgjcelsnldxjbygfcw). Tudo aqui e idempotente: rodar de novo
-- nao quebra nada.
--
-- O CASO REAL: um lead falou pro Pedro que tinha vindo "por causa do video do
-- anuncio", e o Pedro nao sabia qual video era nem o que ele prometia. O id do
-- anuncio JA chega no formulario e JA fica gravado em
-- deals.custom_fields.lead_form.fields.anuncio (e em .raw.anuncio) — so que um
-- id nao diz nada pro consultor no meio da ligacao.
--
-- POR QUE UM CADASTRO MANUAL, e nao a Marketing API do Meta: no banco inteiro
-- existe UM UNICO id ('120245158337780451'), repetido em 35 leads de 10/07 a
-- 25/08, com 'conjunto' igual ao 'anuncio' e 'campanha' SEMPRE vazia. Ou seja,
-- o dado que chega hoje nao distingue criativo — ou rodaram um criativo so, ou
-- o conector manda um valor fixo. Decisao da dona: nao depender da agencia nem
-- de integracao com o Meta. Ela mesma liga id -> nome + URL do video +
-- promessa, e o consultor le isso no card.
--
-- ad_id e TEXT de proposito: os ids do Meta (120...) passam de 2^53 e
-- estourariam o inteiro seguro do JavaScript, entao bigint arredondaria o id
-- no cliente e o lead cairia no criativo errado.
--
-- ROLLBACK no fim do arquivo.
-- =====================================================================

-- --------------------------------------------------------- 1) a tabela
create table if not exists public.ad_creatives (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ad_id           text not null,
  name            text not null,
  creative_url    text,
  promise         text,
  platform        text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.ad_creatives is
  'De qual criativo o lead veio. O admin cadastra id do anuncio -> nome + URL do video + promessa; o consultor le no card, na aba Origem.';

comment on column public.ad_creatives.ad_id is
  'Id do anuncio como chega do Meta. TEXT porque os ids 120... estouram o inteiro seguro do JavaScript.';
comment on column public.ad_creatives.creative_url is
  'Link do video (Drive/YouTube) — e o que o consultor abre antes de ligar.';
comment on column public.ad_creatives.promise is
  'O que o anuncio PROMETEU. E a informacao que faltou pro Pedro na ligacao de 26/08.';

-- Alvo do upsert da tela Configuracoes -> Anuncios: cadastrar o mesmo id duas
-- vezes atualiza o cadastro em vez de duplicar a linha (e a mesma unicidade que
-- o consultor assume ao ler o card — um id, um criativo).
create unique index if not exists ad_creatives_org_ad_id_key
  on public.ad_creatives (organization_id, ad_id);

alter table public.ad_creatives enable row level security;

-- -------------------------------------------------------- 2) as policies
-- Leitura para qualquer membro da organizacao: o consultor PRECISA ler a
-- promessa do criativo no card. Escrita so pra admin — quem cadastra e a dona.
drop policy if exists ad_creatives_select on public.ad_creatives;
drop policy if exists ad_creatives_insert on public.ad_creatives;
drop policy if exists ad_creatives_update on public.ad_creatives;
drop policy if exists ad_creatives_delete on public.ad_creatives;

create policy ad_creatives_select on public.ad_creatives for select to authenticated
using (organization_id = public.minha_org());

create policy ad_creatives_insert on public.ad_creatives for insert to authenticated
with check (public.e_admin() and organization_id = public.minha_org());

create policy ad_creatives_update on public.ad_creatives for update to authenticated
using (public.e_admin() and organization_id = public.minha_org())
with check (public.e_admin() and organization_id = public.minha_org());

create policy ad_creatives_delete on public.ad_creatives for delete to authenticated
using (public.e_admin() and organization_id = public.minha_org());

-- =====================================================================
-- ROLLBACK (colar no editor SQL se o cadastro precisar sair do ar):
--
--   drop policy if exists ad_creatives_select on public.ad_creatives;
--   drop policy if exists ad_creatives_insert on public.ad_creatives;
--   drop policy if exists ad_creatives_update on public.ad_creatives;
--   drop policy if exists ad_creatives_delete on public.ad_creatives;
--   drop table if exists public.ad_creatives;
--
-- Atencao: o drop da tabela APAGA os cadastros da Thalita. Se a intencao for
-- so desligar a tela, tire a aba em features/settings/SettingsPage.tsx e
-- deixe a tabela viva.
-- =====================================================================
