-- P0.4 (14/08) — dar VALIDADE ao auto-pause da Ana.
--
-- O webhook da UazAPI seta `contacts.ai_paused = true` em QUALQUER mensagem enviada de fora da
-- nossa API (`isFromMe` sem sender_type) — inclusive eco de automação. Como não havia carimbo de
-- tempo, a pausa era PERMANENTE e INVISÍVEL: matava resposta e follow-up pra sempre, sem ninguém
-- saber. Foi o que aconteceu com o Roger Bearare (pausado em 13/07 por 2 mensagens de automação;
-- voltou sozinho em 22/07 perguntando "teria algum plano sem carencia?" e caiu no vazio) e com a
-- Valdenice (pausada pelo eco do n8n, nunca atendida pela Ana).
--
-- Esta coluna permite expirar a pausa (ver PAUSE_TTL_HOURS em lib/ai/agent/agent.service.ts) e
-- mostrar no card DESDE QUANDO o lead está mudo.
--
-- Retrocompatibilidade deliberada: as linhas existentes ficam com `ai_paused_at = NULL`, e NULL
-- NÃO expira. Os 9 contatos pausados hoje incluem casos de takeover humano REAL (Mavie, Graci,
-- Josiane, Silvia) — expirar tudo de uma vez faria a Ana falar por cima do consultor. Quem for
-- despausado é decidido a dedo; daqui pra frente toda pausa nova nasce com carimbo e validade.

alter table public.contacts
  add column if not exists ai_paused_at timestamptz;

comment on column public.contacts.ai_paused_at is
  'Quando a IA foi pausada para este contato. NULL = pausa legada, sem validade (não expira). Ver P0.4 no crm-roadmap.';

-- Ajuda a varredura "quem está pausado há quanto tempo" sem escanear a tabela toda.
create index if not exists idx_contacts_ai_paused_at
  on public.contacts (ai_paused_at)
  where ai_paused;
