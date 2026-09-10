-- gestor_envios: guardar o TEXTO do relatório enviado.
--
-- A tabela sabia dia, quem, chat e erro — não o conteúdo. Em 10/09/2026 isso impediu de responder
-- "a cobrança do prêmio apareceu no relatório do Pedro hoje?", justamente quando a resposta diria
-- se um conserto tinha funcionado: o envio constava como sucesso e o texto era irrecuperável,
-- porque o log da Vercel expira.
--
-- Sem risco de vazamento: a RLS desta tabela já tem SELECT só para `e_admin()`, e o relatório
-- individual sai sem os itens sigilosos (o formatador pula `regra.sigiloso`).
--
-- Nullable de propósito: as linhas anteriores a esta migration não têm como recuperar o texto, e
-- um default vazio faria parecer que o relatório daquele dia foi enviado em branco.
alter table public.gestor_envios add column if not exists mensagem text;

comment on column public.gestor_envios.mensagem is
  'Texto exato do relatório enviado no dia. NULL nas linhas anteriores a 10/09/2026, quando a coluna passou a existir.';
