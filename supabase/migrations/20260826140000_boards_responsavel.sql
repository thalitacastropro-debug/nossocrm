-- Responsavel do FUNIL: quem assume o card que CHEGA neste funil.
--
-- POR QUE (decisao da Thalita, 26/08/2026): "cada funil vai ser um dono diferente; assim que e dado
-- como ganho, o time de implantacao e o novo responsavel". Ate aqui o CRM so tinha dono POR CARD,
-- escrito uma unica vez na criacao — entao um card que mudava de funil continuava no nome de quem
-- nao trabalha mais nele.
--
-- NAO reaproveitamos `boards.owner_id`: aquela coluna ja existe e guarda quem CRIOU o funil (e a
-- Thalita nos cinco). Misturar as duas semanticas quebraria em silencio.
--
-- Quem le: a rota `POST /api/deals/[dealId]/proximo-funil`, que move o card ao ganhar. Se a coluna
-- estiver nula, o card muda de funil mantendo o dono que ja tinha.
alter table public.boards
  add column if not exists responsavel_user_id uuid references public.profiles(id) on delete set null;

comment on column public.boards.responsavel_user_id is
  'Quem assume o card ao ENTRAR neste funil. Null = mantem o dono que o card ja tinha.';

-- Backfill do time atual da Niva (26/08/2026). Por E-MAIL de propósito: UUID de perfil nao existe
-- num banco recem-criado, e o join com profiles faz a migracao virar no-op em vez de estourar.
--
-- REGRA DA THALITA (26/08): responsavel de funil e papel de DONO DA OPERACAO — nenhum colaborador
-- assume funil. Por isso TODOS os funis ficam com o Denilson, e nao um responsavel por funil.
update public.boards b
   set responsavel_user_id = p.id
  from public.profiles p
 where b.responsavel_user_id is null
   and b.organization_id = p.organization_id
   and p.email = 'denilsonnivaconsultoria@gmail.com';

-- ROLLBACK
-- alter table public.boards drop column if exists responsavel_user_id;
