-- =====================================================================
-- Diário individual no Telegram: endereço de cada pessoa + trava de reenvio
-- =====================================================================
-- Pedido da Thalita em 02/09/2026: ligar o disparo individual do gestor
-- comercial. O texto por colaborador já existe e está testado desde 31/08
-- (`lib/gestor/formato.ts`); o que faltava era PARA ONDE mandar.
--
-- POR QUE TELEGRAM E NÃO WHATSAPP: a primeira ideia era usar `profiles.phone`
-- pela instância da UAZAPI. Cai por um motivo concreto — o número do time
-- viraria conversa no CRM, e uma resposta ("ok") entra como mensagem INBOUND
-- de número desconhecido, que é exatamente o gatilho de lead novo no funil da
-- SDR. O time viraria lead, com a Ana atendendo. Telegram não toca no CRM,
-- não gasta a instância, e o texto já é HTML do Telegram (zero conversão).
--
-- POR QUE UM CHAT_ID POR PESSOA: o bot não pode puxar conversa (o Telegram
-- proíbe). Cada pessoa manda uma mensagem para o bot uma vez, e é isso que
-- gera o endereço de envio. Telefone não serve neste caminho.
--
-- ROLLBACK no fim do arquivo.
-- =====================================================================

-- ------------------------------------------- 1) o endereço de cada pessoa
alter table public.profiles
  add column if not exists telegram_chat_id text;

comment on column public.profiles.telegram_chat_id is
  'Chat privado da pessoa com o bot, para o diário individual das 8h. Preenchido pela própria pessoa em /profile (ela manda um código para o bot e o CRM casa o chat). NULL = não recebe — silêncio é o padrão, ninguém entra na lista sem ter pedido.';

-- --------------------------------------------- 2) a trava de reenvio
-- Uma linha por pessoa por dia. A PK composta É a regra: o INSERT falha se já
-- mandamos hoje, então não existe caminho em que a mesma pessoa receba o
-- mesmo diário duas vezes.
--
-- Isto não é paranoia: o cron `gestor-comercial` (0 11 * * 1-5) roda uma vez,
-- mas a rota é um GET protegido por segredo — qualquer chamada manual, um
-- retry do pg_net ou um redeploy que refaça a requisição mandaria de novo. Um
-- alerta repetido é o jeito mais rápido de o time parar de ler.
--
-- Grava-se ANTES de enviar, como a cadência de follow-up da Ana já faz: entre
-- mandar duas vezes e não mandar nenhuma quando o envio falha no meio, o
-- segundo erro é o barato — o diário de amanhã cobre o mesmo estoque.
create table if not exists public.gestor_envios (
  dia         date not null,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  chat_id     text not null,
  enviado_em  timestamptz not null default now(),
  -- Falha registrada é o que permite responder "por que o Pedro não recebeu?"
  -- sem depender do log da Vercel, que expira.
  erro        text,
  primary key (dia, profile_id)
);

comment on table public.gestor_envios is
  'Uma linha por pessoa por dia do diário individual. A PK impede reenvio; a coluna erro guarda a falha para diagnóstico.';

-- ----------------------------------------------------- 3) as policies
alter table public.gestor_envios enable row level security;

drop policy if exists gestor_envios_select on public.gestor_envios;

-- Ler: só admin. Não é dado de trabalho de ninguém, é registro operacional —
-- e mostrar para o time "quem recebeu o quê" convida comparação sem valor.
-- Quem ESCREVE é o cron, com service role, que não passa por RLS.
create policy gestor_envios_select on public.gestor_envios for select to authenticated
using (public.e_admin());

-- =====================================================================
-- ROLLBACK (colar no editor SQL):
--
--   drop table if exists public.gestor_envios;
--   alter table public.profiles drop column if exists telegram_chat_id;
--
-- Atenção: dropar a coluna desliga o disparo individual para todo mundo e
-- obriga cada pessoa a refazer o /start. Para só PAUSAR o disparo, rode
--   update public.profiles set telegram_chat_id = null;
-- que a rota do cron volta a mandar apenas o diário completo da dona.
-- =====================================================================
