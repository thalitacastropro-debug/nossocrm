-- PERDIDO QUE VOLTA A FALAR (09/10/2026).
--
-- Pedido da Thalita em 11/09: *"quando vai pra perdido o lead some; precisamos ter onde resgatar
-- esse lead caso ele volte a conversar com o consultor"*. Voltou em 09/10 pela boca do Pedro:
-- *"se eu der perdido numa cliente e depois ela mandar mensagem, cai normalmente pra mim?"*.
--
-- A mensagem sempre chegou (a conversa fica no nome dele). O que some é o CARD: o funil abre no
-- filtro "Em Aberto", que não é persistido; a busca é cruzada com o filtro; e o perdido pelo
-- áudio vai para OUTRO funil (Nutrição). O único sinal era o relatório das 8h do dia seguinte,
-- e só se ninguém respondesse em 4h.
--
-- Agora, a cada mensagem que CHEGA de um contato cujo último card fechado é PERDIDO (e que não
-- tem card aberto), o banco:
--   1. registra o retorno em `lead_perdido_retornos` — é o que a faixa do funil lê;
--   2. avisa o DONO DO CARD no Telegram, na hora, com link que abre o card (onde está o Reabrir).
--      Uma vez a cada 12h por card: uma conversa de 10 bolhas não vira 10 avisos.
--
-- O card NÃO reabre sozinho. Dos 3 perdidos que voltaram a escrever até hoje, um disse "O PJ eu
-- fechei na outra corretora" e outro só "Ok" — quem decide se é reabertura é o consultor.
--
-- Fica no banco (trigger), e não no webhook nem na rota da Ana, porque é o único ponto por onde
-- TODA mensagem passa: a rota da Ana sai cedo em pausa/limite antes de olhar o card, e o webhook
-- é uma Edge Function à parte. ⚠️ O trigger está no caminho quente da entrada de mensagens:
-- qualquer erro aqui é engolido (EXCEPTION → WARNING). Avisar é bom; perder a mensagem, nunca.

create table if not exists public.lead_perdido_retornos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  deal_id uuid not null references public.deals(id) on delete cascade,
  contact_id uuid not null,
  owner_id uuid,
  primeira_msg_em timestamptz not null,
  ultima_msg_em timestamptz not null,
  ultima_previa text,
  qtd_msgs integer not null default 1,
  notificado_em timestamptz,
  dispensado_em timestamptz,
  dispensado_por uuid,
  created_at timestamptz not null default now()
);

-- Um retorno ABERTO por card: as mensagens seguintes atualizam o mesmo registro.
create unique index if not exists lead_perdido_retornos_aberto_uidx
  on public.lead_perdido_retornos (deal_id) where dispensado_em is null;

alter table public.lead_perdido_retornos enable row level security;

-- Quem vê o card vê o retorno dele (a subconsulta roda sob a RLS de `deals` de quem pergunta:
-- vendedor vê os dele, admin vê todos). Dispensar é UPDATE com a mesma régua.
drop policy if exists lead_perdido_retornos_select on public.lead_perdido_retornos;
create policy lead_perdido_retornos_select on public.lead_perdido_retornos
  for select to authenticated
  using (exists (select 1 from public.deals d where d.id = lead_perdido_retornos.deal_id));

drop policy if exists lead_perdido_retornos_update on public.lead_perdido_retornos;
create policy lead_perdido_retornos_update on public.lead_perdido_retornos
  for update to authenticated
  using (exists (select 1 from public.deals d where d.id = lead_perdido_retornos.deal_id))
  with check (exists (select 1 from public.deals d where d.id = lead_perdido_retornos.deal_id));

grant select, update on public.lead_perdido_retornos to authenticated;

create or replace function public.niva_html_escape(t text)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

create or replace function public.avisa_perdido_voltou_a_falar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact uuid;
  v_org uuid;
  v_deal record;
  v_ret record;
  v_fechado_em timestamptz;
  v_previa text;
  v_ret_id uuid;
  v_notificado_em timestamptz;
  v_nome text;
  v_bot text;
  v_chat text;
  v_app text;
  v_texto text;
begin
  begin
    -- Reação não é "voltar a falar".
    if new.content_type = 'reaction' then
      return new;
    end if;

    select c.contact_id, c.organization_id into v_contact, v_org
    from messaging_conversations c where c.id = new.conversation_id;
    if v_contact is null then
      return new;
    end if;

    -- Com card ABERTO o lead está visível no funil: não é um perdido voltando.
    if exists (
      select 1 from deals d
      where d.contact_id = v_contact and d.deleted_at is null
        and not coalesce(d.is_won, false) and not coalesce(d.is_lost, false)
    ) then
      return new;
    end if;

    -- O último card FECHADO decide: se foi ganho, é cliente falando (pós-venda), não resgate.
    select d.id, d.owner_id, d.title, d.is_lost, coalesce(d.closed_at, d.updated_at) as fechado_em
      into v_deal
    from deals d
    where d.contact_id = v_contact and d.deleted_at is null
      and (coalesce(d.is_won, false) or coalesce(d.is_lost, false))
    order by coalesce(d.closed_at, d.updated_at) desc
    limit 1;
    if not found or not v_deal.is_lost then
      return new;
    end if;

    v_fechado_em := v_deal.fechado_em;
    -- Só conta o que chegou DEPOIS do fechamento.
    if new.created_at <= v_fechado_em then
      return new;
    end if;

    v_previa := left(coalesce(
      nullif(new.content->>'text', ''),
      nullif(new.content->>'caption', ''),
      '[' || coalesce(new.content_type, 'mensagem') || ']'
    ), 200);

    -- Dispensado há pouco: a pessoa já viu e decidiu. O resto da mesma conversa não re-avisa.
    if exists (
      select 1 from lead_perdido_retornos r
      where r.deal_id = v_deal.id and r.dispensado_em > now() - interval '24 hours'
    ) then
      return new;
    end if;

    select * into v_ret from lead_perdido_retornos r
    where r.deal_id = v_deal.id and r.dispensado_em is null;

    if found and v_ret.primeira_msg_em > v_fechado_em then
      update lead_perdido_retornos
        set ultima_msg_em = new.created_at, ultima_previa = v_previa, qtd_msgs = qtd_msgs + 1,
            owner_id = v_deal.owner_id
      where id = v_ret.id;
      v_ret_id := v_ret.id;
      v_notificado_em := v_ret.notificado_em;
    elsif found then
      -- Retorno de um fechamento ANTERIOR (o card foi reaberto e perdido de novo): recomeça.
      update lead_perdido_retornos
        set primeira_msg_em = new.created_at, ultima_msg_em = new.created_at, ultima_previa = v_previa,
            qtd_msgs = 1, notificado_em = null, owner_id = v_deal.owner_id
      where id = v_ret.id;
      v_ret_id := v_ret.id;
      v_notificado_em := null;
    else
      insert into lead_perdido_retornos
        (organization_id, deal_id, contact_id, owner_id, primeira_msg_em, ultima_msg_em, ultima_previa)
      values (v_org, v_deal.id, v_contact, v_deal.owner_id, new.created_at, new.created_at, v_previa)
      returning id into v_ret_id;
      v_notificado_em := null;
    end if;

    if v_notificado_em is not null and v_notificado_em > now() - interval '12 hours' then
      return new;
    end if;

    -- Telegram do DONO do card; sem vínculo, o grupo da organização (onde já chegam os handoffs).
    select s.telegram_bot_token, s.app_base_url, s.telegram_chat_id
      into v_bot, v_app, v_chat
    from organization_settings s where s.organization_id = v_org;
    select coalesce(p.telegram_chat_id, v_chat) into v_chat
    from profiles p where p.id = v_deal.owner_id;
    if v_chat is null then
      select s.telegram_chat_id into v_chat from organization_settings s where s.organization_id = v_org;
    end if;
    if v_bot is null or v_chat is null then
      return new;
    end if;

    select ct.name into v_nome from contacts ct where ct.id = v_contact;

    v_texto :=
      '🔁 <b>Lead PERDIDO voltou a falar</b>' || chr(10) || chr(10) ||
      '👤 <b>' || niva_html_escape(coalesce(v_nome, v_deal.title)) || '</b>' || chr(10) ||
      '💬 <i>' || niva_html_escape(v_previa) || '</i>' || chr(10) || chr(10) ||
      'O card continua como perdido e fora do funil. Abra e use <b>Reabrir</b> se for retomar.';
    if v_app is not null then
      v_texto := v_texto || chr(10) || '🔗 <a href="' || rtrim(v_app, '/') || '/boards?deal=' || v_deal.id || '">Abrir o card</a>';
    end if;

    perform net.http_post(
      url := 'https://api.telegram.org/bot' || v_bot || '/sendMessage',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'chat_id', v_chat,
        'text', v_texto,
        'parse_mode', 'HTML',
        'disable_web_page_preview', true
      )
    );

    update lead_perdido_retornos set notificado_em = now() where id = v_ret_id;
  exception when others then
    raise warning '[avisa_perdido_voltou_a_falar] %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists zz_avisa_perdido_voltou_a_falar on public.messaging_messages;
create trigger zz_avisa_perdido_voltou_a_falar
  after insert on public.messaging_messages
  for each row
  when (new.direction = 'inbound')
  execute function public.avisa_perdido_voltou_a_falar();
