-- =====================================================================
-- Vínculo do Telegram: código secreto, de uso único, e um chat por pessoa
-- =====================================================================
-- Corrige duas falhas encontradas na revisão adversarial de 02/09/2026, antes
-- de o disparo individual ir ao ar.
--
-- ## 1. O código não podia ser derivado do id da pessoa
--
-- A primeira versão usava os 6 primeiros caracteres do `profiles.id`. Parecia
-- inofensivo — é um casamento interno, não uma senha. Mas `profiles_select`
-- (migração 20260825000000) deixa qualquer pessoa da organização ler o
-- `profiles.id` de todo mundo, e a tela do CRM já baixa essa lista. Então o
-- código de qualquer colega era calculável.
--
-- O ataque é curto: descobrir o código do gestor, mandar ESSE código para o bot
-- pelo Telegram próprio e esperar o gestor clicar em "conectar". O CRM acharia
-- a mensagem — que veio do chat errado — e gravaria o chat de quem forjou no
-- perfil do gestor. Resultado: o gestor deixa de receber e outra pessoa passa a
-- receber o relatório que contém o que a equipe tem em aberto, incluindo a
-- cobrança sobre ela mesma. Silencioso dos dois lados.
--
-- Agora o código é ALEATÓRIO, vive nesta tabela, expira e morre no uso. Ele
-- não está em `profiles` de propósito: lá, o mesmo `profiles_select` o
-- entregaria para a organização inteira e nada teria mudado.
--
-- ## 2. Um chat do Telegram não pode ser o destino de duas pessoas
--
-- Sem índice único, um `chat_id` repetido faria a mesma pessoa receber dois
-- relatórios diferentes — inclusive o do gestor, se ela tivesse ficado com o
-- vínculo dele. O índice torna isso impossível no banco, não só na intenção.
--
-- ROLLBACK no fim do arquivo.
-- =====================================================================

-- ------------------------------------------------ 1) um chat, uma pessoa
-- Parcial: `telegram_chat_id` é nulo para quem não ligou, e nulo repete à
-- vontade — só os valores preenchidos precisam ser únicos.
create unique index if not exists profiles_telegram_chat_id_unico
  on public.profiles (telegram_chat_id)
  where telegram_chat_id is not null;

-- ------------------------------------- 2) o código secreto, curto e mortal
create table if not exists public.telegram_vinculos_pendentes (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  codigo     text not null unique,
  expira_em  timestamptz not null,
  criado_em  timestamptz not null default now()
);

comment on table public.telegram_vinculos_pendentes is
  'Código de uso único que liga uma pessoa ao chat dela no bot do Telegram. Vive minutos e é apagado quando o vínculo se completa. NÃO mora em profiles de propósito: lá a policy de leitura da organização entregaria o código de um para todos.';

-- RLS ligada e NENHUMA policy: nem select, nem insert, nem update. Só o service
-- role (que ignora RLS) enxerga esta tabela — que é exatamente o ponto. Se um
-- dia alguém precisar ler daqui pelo cliente, é sinal de que o desenho mudou e
-- a decisão precisa ser revista, não a policy afrouxada.
alter table public.telegram_vinculos_pendentes enable row level security;

-- =====================================================================
-- ROLLBACK (colar no editor SQL):
--
--   drop table if exists public.telegram_vinculos_pendentes;
--   drop index if exists public.profiles_telegram_chat_id_unico;
-- =====================================================================
