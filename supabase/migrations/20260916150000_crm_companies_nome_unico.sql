-- ============================================================================
-- EMPRESA DUPLICADA: a trava que faltava em `crm_companies`
--
-- 16/09/2026. Seis linhas idênticas "TEAM MONTEIRO TREINAMENTOS LTDA" nasceram em dois minutos:
-- a criação de negócio grava a empresa ANTES do contato, e o contato estava falhando (bug de RLS
-- consertado em `e85e705`), então cada nova tentativa do vendedor deixava mais uma empresa órfã.
--
-- POR QUE NO BANCO, E NÃO SÓ NO APP. Existem CINCO caminhos que inserem nesta tabela — o serviço
-- da interface, a rota pública de contatos, a rota pública de empresas, o import de CSV e a edge
-- function do webhook de entrada. Três já procuravam antes de inserir, cada um com um critério
-- DIFERENTE (`ilike`, `eq` sensível a maiúsculas, chave normalizada sem acento). Consertar o app
-- fecha o caminho que se conserta; o índice fecha os cinco de uma vez — e fecha também a corrida,
-- que nenhum "procura, depois insere" resolve, porque as duas requisições podem buscar antes de
-- qualquer uma inserir.
--
-- MOMENTO ESCOLHIDO: a tabela está VAZIA (as 6 órfãs foram apagadas hoje; nenhum contato ou
-- negócio nunca apontou para empresa nenhuma — 0 de 196 contatos e 0 de 215 negócios). Não há
-- duplicata legada para reconciliar antes de criar o índice, e não há risco de colar dois clientes
-- reais: não existe cliente com empresa ligada.
--
-- O CRITÉRIO É NOME, e nome é tudo o que esta tabela tem para desempatar (não há CNPJ; `website`
-- fica vazio em todos os caminhos automáticos). Normalizado por `lower(btrim(...))`: espaço nas
-- pontas e caixa não criam empresa nova. NÃO é fuzzy de propósito — acento, pontuação e sufixo
-- continuam distinguindo ("Monteiro Ltda" ≠ "Monteiro ME"), porque colar duas empresas diferentes
-- é pior que ter duas linhas parecidas.
--
-- ESCOPO POR ORGANIZAÇÃO: duas empresas clientes de organizações diferentes podem ter o mesmo
-- nome. O índice não pode ser global.
--
-- `WHERE deleted_at IS NULL`: empresa apagada não deve impedir o cadastro de uma nova com o mesmo
-- nome.
--
-- EFEITO EM QUEM INSERE. A partir daqui, um insert repetido ERRA com 23505 em vez de criar linha.
-- Quem trata: `companiesService.create` (pega o 23505, reconsulta e devolve a empresa que ganhou a
-- corrida). Quem não trata, e por que está tudo bem:
--   • rota pública de contatos e de empresas — já buscam antes; a corrida vira erro 4xx/5xx em vez
--     de duplicata silenciosa, o que é o comportamento preferível;
--   • import de CSV — monta o lote a partir dos que faltam, então só colide em corrida;
--   • edge function `webhook-in` — busca com `eq` SENSÍVEL A MAIÚSCULAS, então "Team Monteiro"
--     quando existe "TEAM MONTEIRO" passa a cair no 23505. O catch dela é best-effort e engole o
--     erro: o contato entra SEM empresa em vez de criar a duplicata. Regressão conhecida e aceita
--     (hoje 100% dos contatos já entram sem empresa); o conserto é trocar `eq` por `ilike` lá, e
--     exige deploy da edge function — anotado, fora deste commit.
--
-- REVERTER: drop index if exists public.crm_companies_nome_unico_por_org;
-- ============================================================================

create unique index if not exists crm_companies_nome_unico_por_org
  on public.crm_companies (organization_id, lower(btrim(name)))
  where deleted_at is null;

comment on index public.crm_companies_nome_unico_por_org is
  'Impede empresa duplicada por nome dentro da mesma organizacao (16/09/2026, caso das 6 linhas '
  'TEAM MONTEIRO). Normaliza caixa e espaco nas pontas; nao normaliza acento nem pontuacao. '
  'Ignora empresa apagada. Quem insere precisa tratar 23505 como "achei a existente".';
