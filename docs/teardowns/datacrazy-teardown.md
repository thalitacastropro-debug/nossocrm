# Teardown do DataCrazy → melhorias pro NIVA CRM (nossocrm)

> **O que é isto:** análise tela-por-tela do **DataCrazy** (`crm.datacrazy.io`), o CRM comercial que a Niva assina, feita em modo **read-only** direto na conta logada (workspace "Niva Consultoria"), para extrair melhorias concretas pro nosso CRM próprio (nossocrm).
>
> **Data:** 2026-07-20. **Método:** navegação observacional (Claude-in-Chrome), sem alterar dado, config ou disparar automação.
>
> **Privacidade:** foco em estrutura, UX e features. Dados reais de contatos/negócios da Niva **não** foram copiados; qualquer ilustração é anonimizada. (A conta está praticamente zerada — R$ 0,00 em quase tudo — então há pouco dado real de qualquer forma.)

**Posicionamento do produto (da home datacrazy.io):** "Não somos apenas um CRM. Somos Datacrazy" — CRM com IA integrada, focado em **WhatsApp e Instagram**, automação, multiatendimento, BI interno e "regras de negócio inteligentes". É o mesmo território do nossocrm (CRM conversacional com IA pra WhatsApp), então é um concorrente-espelho muito útil.

## Mapa de navegação (sidebar)

| Módulo | Rota | Ícone/label |
|---|---|---|
| Início (Dashboard) | `/` | Início |
| Pipelines (funil/kanban) | `/pipelines/1` | Pipelines |
| Leads (contatos) | `/leads` | Leads |
| Impulsos (boosts) | `/boosts` | Impulsos |
| Automações (flow builder) | `/flow` | Automações |
| Chat ao vivo (multiatendimento) | `/multiservice` | Chat ao vivo |
| Agentes de IA | `/ia` | Agentes de IA |
| Configurações | `/config/*` | Configurações (rodapé) |
| Agenda / Notificações / Ajuda | rodapé da sidebar | ícones de calendário, sino, ajuda |

Header do workspace mostra o nome da organização ("Niva Consultoria") com seletor (troca de workspace/conta). Sidebar é colapsável (modo ícone ↔ modo label).

---

## 1. Início / Dashboard — `/`

**Propósito:** visão geral de desempenho e atividades no período.

**Layout & navegação:**
- Header com título + seletor de **intervalo de datas** (default: últimos 7 dias).
- **Segmented control de 3 dimensões**: `Negócios` · `Multiatendimento` · `Atividades` — o mesmo dashboard troca de lente conforme a dimensão (deals vs atendimento vs tarefas). Padrão forte.
- **Linha de KPIs (lente Negócios):** Total criados · Total ganhos · Total perdidos · Total em aberto (ⓘ) · Total negócios (ⓘ). Cada card = valor em R$ + contagem de negócios + mini-ícone/sparkline.
- **Dados diários:** gráfico de linha por dia, com toggle **Valor ↔ Quantidade** (dropdown).
- **Percentual por atendente:** distribuição por atendente, mesmo toggle Valor/Quantidade.
- **Produtos mais vendidos** e **Atendentes com mais vendas:** rankings.

**Modelo de dados implícito:** negócio (deal) tem valor, status (criado/ganho/perdido/aberto), atendente responsável, produto associado, timestamps. Atendimento e Atividade são entidades próprias, dashboardáveis na mesma tela.

**UX que faz BEM:**
- **Dashboard multi-dimensão** num só lugar (deals / atendimento / atividades) via segmented control — em vez de 3 telas separadas.
- Toggle **Valor ↔ Quantidade** em todo gráfico (financeiro vs volume) — decisão de visualização barata e poderosa.
- **Tutorial contextual por tela** ("Assista ao nosso tutorial sobre a tela de Dashboard", com "Não mostrar novamente") — onboarding embutido, por módulo.
- Widget de **Suporte** fixo (canto inferior direito).
- **Produtos** como entidade de 1ª classe (ranking de mais vendidos) — CRM já pensa em catálogo/produto no deal.

**As 3 lentes em detalhe:**
- **Negócios:** KPIs financeiros (criados/ganhos/perdidos/aberto), dados diários, % por atendente, produtos mais vendidos, atendentes com mais vendas.
- **Multiatendimento:** Total de atendimentos, finalizados, em aberto (iniciados vs aguardando), com **% de variação** vs período anterior. Gráfico de atendimentos/dia + **heatmap dia-da-semana × hora** ("atendimentos iniciados por hora") + **Tempo de resposta** (médio) + **Tempo para iniciar atendimento** (first-response) em minutos.
- **Atividades:** atividades finalizadas por data, por atendente, por tipo (toggle Quantidade ↔ tempo total). Tabelas por atendente e por tipo com colunas **Total · Em aberto · Finalizadas · Atrasadas (overdue) · Tempo médio**.

**Roubar / melhorar pro nossocrm:**
- Dashboard com **lente de atendimento** (multiatendimento) além de deals — o nossocrm tem a Ana operando WhatsApp; painel de conversas, tempo de resposta e first-response por atendente/IA é natural.
- **Heatmap de horário de contato** (dia × hora) — saber quando os leads da Niva mais chamam ajuda a calibrar cadência/plantão.
- **SLA de atividades atrasadas** (overdue) por consultor — encaixa direto na cadência anti-no-show da Ana e no funil do corretor.
- Toggle **Valor ↔ Quantidade** (e Quantidade ↔ tempo) nos gráficos.
- **% de variação vs período anterior** nos KPIs (falta no nosso).
- **Onboarding contextual por tela** (tooltip/tutorial dismissível).
- Ranking **por atendente** e **por produto** (a Niva vende planos por operadora/produto).

---

## 2. Pipelines (funil / kanban) — `/pipelines/:id`

**Propósito:** gestão visual de negócios (deals) em kanban por etapa.

**Layout & navegação:**
- **Coluna de pipelines à esquerda**, agrupadas em **pastas/categorias** (na conta Niva: grupo "FUNIL DE VENDAS" → pipeline "Seguro Saúde - Captação Anúncios"; grupo "ADMIN" → pipeline "Pós Venda"). Botão **Nova pipeline**. Cada pipeline tem descrição ("Funil de leads captados em anúncios").
- **Kanban** com colunas = etapas, cada uma com: **dot colorido**, nome, **total em R$** e **contagem de negócios** no header, menu "⋯" por coluna, e "+ Novo negócio" no rodapé da coluna.
  - Ex. de etapas: Entrada de Leads (Conexão) · Follow-up Conexão · Envio de Cotação · Negociação · … · Perdido.
- **Toolbar:** busca, **Filtros**, **Ordenação**, e barra secundária com Ordenação | Mais recentes | Intervalo | Último ano (sort + janela temporal do board). Board rola na horizontal.

**Anatomia do card (ótima, densa mas legível):**
- Avatar + nome + **#número do negócio**.
- Link de **produto** ("Sem produto" quando vazio) — produto é 1ª classe no card.
- **Dot de temperatura** (quente/morno/frio).
- 💳 **Valor** (R$) editável inline.
- 📅 **Data**.
- ⏰ **"Sem atividades"** — sinaliza que **não há próxima atividade agendada** (nudge de follow-up embutido no card).
- ➡️ **"N campos adicionais"** — expande custom fields sem abrir o card.
- **Ícone WhatsApp** (verde) — ação rápida de abrir conversa direto do card.
- ➕ (adicionar atividade) e **tags/labels** coloridas ("Leads Forms N...").

**Modal de detalhe do negócio (2 painéis) — o coração do modelo de dados:**
- **Painel esquerdo = CONTATO/LEAD:** avatar editável, nome, tags (+add), **"+ Adicionar listas"** (segmentos), **"+ Executar automação do lead"** (dispara automação manualmente), **Notas**, e sub-abas **Perfil · Endereço · Campos adicionais**. Os campos adicionais do lead são a **qualificação** (ex. na Niva: "Quais as idades das pessoas", "Qual o número do seu CNPJ", "Quanto você paga atualmente no seu plano", "Você possui CNPJ", "Você possui plano de saúde"). Custom field com **tipo** (ícone T = texto) e "+ Adicionar".
- **Painel direito = NEGÓCIO/DEAL:** abas **Histórico · Atividades · Negócios · Arquivos · Atendimentos · Informações do Negócio**. Header: **Número · Valor Total · Data de Criação**. Toggle **Pipeline Completa ↔ Jornada do Negócio**. **Stepper visual das etapas** com ícone de relógio por etapa (tempo em etapa). Sub-abas do negócio: **Produtos e Valores · Campos adicionais · Anexos · Histórico · Atividades**.
- **Histórico auto-logado com origem**: cada evento mostra o autor/origem (ex. "Automação Formularios Netzach") + timestamp. "Netzach" parece ser o motor de automação/eventos interno. Filtro "Todos" + "Comentar" (comentário manual na timeline).

**Modelo de dados implícito:**
- **Contato (lead/pessoa)** 1—N **Negócios (deals)**. Contato tem perfil, endereço, campos adicionais (qualificação), notas, tags, listas.
- **Negócio** pertence a uma **pipeline** + **etapa**, tem valor, produtos (N), atendente responsável, campos adicionais próprios, anexos, atividades, atendimentos (conversas) vinculados, e histórico.
- **Pipelines agrupadas** em categorias/pastas.
- Etapa tem **cor** e agrega valor+contagem.

**UX que faz BEM:**
- **Pastas de pipelines** (Funil de Vendas / Admin / Pós-venda) — organiza vários funis por natureza. (No nossocrm são "boards" soltos.)
- **"Sem atividades" no card** como alerta de que falta agendar o próximo passo — disciplina de follow-up visível.
- **WhatsApp 1-clique** no card.
- **"Executar automação do lead"** e **"Adicionar listas"** direto do contato.
- **Jornada do Negócio** com **tempo em cada etapa** (relógio) — dá pra ver onde o deal empaca.
- **Campos adicionais expansíveis no card** sem abrir modal.
- **Histórico com origem/autor** de cada mudança (automação vs humano) — auditabilidade.
- Separação limpa **Contato ↔ Negócio** com 1 contato podendo ter vários negócios (recompra/renovação — casa com o "reajuste composto" e renovação de apólice da Niva).

**Roubar / melhorar pro nossocrm:**
- **Agrupar boards/funis em pastas** (Vendas, Pós-venda, Admin) em vez de lista flat.
- **Badge "sem próxima atividade"** no card — reforça a disciplina que a Ana já tenta manter (anti-no-show).
- **Tempo-em-etapa** visível na jornada do deal (identifica gargalo — ex. deals presos em "Novo Lead", bug já conhecido nosso).
- **1 contato → N negócios** de 1ª classe (renovação anual de plano = novo negócio no mesmo contato) — habilita métrica de recompra/LTV.
- **Histórico com origem** (IA/Ana vs consultor vs automação) — já temos activities; explicitar a origem no timeline ajuda a debugar a Ana.
- **"Executar automação manualmente"** num lead — útil pra reprocessar/re-disparar a Ana num deal específico.

---

## 3. Leads (contatos / base) — `/leads`

**Propósito:** base de contatos ("Consulte, crie, modifique ou remova seus leads"). Tabela com métricas comerciais por contato.

**Layout & navegação:**
- Tabela com **seleção em massa** (checkbox por linha). Colunas: **Nome** (avatar + nome + "Ticket médio R$"), **Contatos** (telefone + e-mail), **Tags**, **Dados** (bloco com **Total R$ · Compras · Ciclo de compra · Última compra** em dias), **Data de criação**, menu "⋯" por linha.
- Toolbar: **Novo Lead**, busca, contador de resultados ("184 resultados"), **Visões** (views salvas), **Filtros**, e toggle de layout (lista/tabela).

**Segmentação (Filtros) — rica:** Tags · Endereço · Negócios · **Listas** · Produtos · **Atendente** · **Origem** · **Campos adicionais** · Data de criação · **Última compra** · **Quantidade de negócios**. Cada um abre sub-condições. Combinado com "Visões", vira segmentos salvos.

**Modelo de dados implícito:** contato tem métricas de **recência/frequência/valor** (última compra, ciclo de compra, nº de compras, ticket médio, total) — modelo tipo RFM embutido. Tem **origem** (source), **listas**, **tags**, **campos adicionais**, **endereço**, e N negócios.

**UX que faz BEM:**
- **Métricas comerciais na própria linha** (ticket médio, última compra, ciclo) — dá pra ler a saúde da base sem abrir cada contato.
- **Filtro por "Última compra" e "Quantidade de negócios"** — segmentação de recência/recompra nativa.
- **Filtro por "Campos adicionais" e "Origem"** — dá pra isolar quem veio de qual isca/anúncio e quem respondeu o quê na qualificação.
- **Visões salvas** + **ações em massa** (checkbox) — operar a base em lote.

**Roubar / melhorar pro nossocrm:**
- **View de base com RFM** (última compra, nº de negócios, ticket médio) — habilita a **reativação da base fria** da Niva (projeto pendente): segmento "sem compra há X, tag = base fria" vira alvo de cadência.
- **Filtro por campo adicional + origem** — separar leads por isca/guia e por resposta de qualificação (idades, possui plano, quanto paga).
- **Views/segmentos salvos** reutilizáveis (o nossocrm tem boards, mas não segmentos de contato salvos).
- **Ações em massa** na base (mover, taggear, disparar automação em lote).

---

## 4. Impulsos (boosts / campanhas em massa) — `/boosts`

**Propósito:** "Gerencie seus impulsos de automação, acompanhe o progresso dos leads em tempo real e controle execuções." É o **motor de disparo em massa**: pega um segmento de leads e roda uma automação (ou template) sobre eles, com pacing.

**Fluxo de criação (wizard de 4 passos):**
1. **Selecionar tipo de impulso** — (a) **Impulso de automação**: "Execute automações completas para nutrir e engajar seus leads"; (b) **Impulso de templates** (*Em breve*): "Envie templates do WhatsApp personalizados usando modelos pré-aprovados" (= templates oficiais aprovados da API WhatsApp).
2. **Selecionar automação** — qual fluxo rodar.
3. **Selecionar leads** — o segmento alvo.
4. **Configurar impulso** — **intervalos entre execuções** (drip/rate-limit), agendamento.

**Modelo de dados implícito:** um "impulso" = { automação/template + segmento de leads + configuração de intervalo + estado de execução }. Executa em lote com monitoramento em tempo real (progresso, execuções).

**UX/feature que faz BEM:**
- Separa **automação** (o fluxo/lógica) de **impulso** (a campanha que enfileira N leads naquele fluxo, com pacing) — arquitetura limpa: fluxo reutilizável, campanha descartável.
- **Intervalo entre execuções** nativo — reduz risco de ban por disparo em rajada (dor real da Niva no outbound frio via UAZAPI).
- Caminho dedicado pra **templates oficiais do WhatsApp** (opt-in/HSM) — casa com a migração da Niva pro WhatsApp oficial.

**Roubar / melhorar pro nossocrm:**
- **Motor de "impulso"/campanha em massa** por cima das automações — hoje o nossocrm dispara a Ana 1:1 por webhook; um enfileirador de segmento com **pacing configurável** habilita a **reativação da base fria** com segurança anti-ban.
- **Suporte a template oficial WhatsApp** como tipo de campanha (a Niva está migrando pro oficial; precisa de HSM aprovado + janela 24h).
- **Monitor de execução em tempo real** (quantos leads em cada passo, falhas) — observabilidade de campanha.

---

## 5. Automações (flow builder visual) — `/flow` e `/flow/:id`

**Propósito:** construtor visual de automações estilo Zapier/Make/n8n, embutido no CRM. **Este é o maior diferencial do DataCrazy vs nossocrm.**

**Layout & navegação:**
- **Lista de automações** agrupadas por **categoria** (ex. "Captação"), cada uma com **toggle on/off** e drag-handle pra reordenar. Botão "Adicionar automação". Busca.
- Cards com **thumbnail do grafo** + descrição ("Criar novo lead após a qualificação do Agente de IA") + "Abrir automação".
- Na conta Niva: **"Criar Novo Lead Qualificado"** (dispara após a IA qualificar) e **"Formularios Netzach"** (intake de formulário).

**Editor de fluxo (canvas de nós):**
- **Palette "Blocos básicos":**
  - **Mensagem** — envia mensagem (WhatsApp/canal).
  - **Ações** — ações do CRM (mover etapa, criar negócio, taggear, atribuir atendente…).
  - **Condições** — ramificação lógica (if/else).
  - **Espera** — delay/wait (drip).
  - **Randomizador** — split aleatório (A/B test).
  - **API** — requisição HTTP externa (`{}`).
  - **Operações de campos** — set/update/mapear campos adicionais.
  - **IA** — **nó de IA dentro do fluxo** (qualificar, classificar, gerar texto).
  - **JavaScript** — **nó de código arbitrário** (`<>`).
- **Nó "Início" (gatilho):** "O gatilho é responsável por acionar a automação." Tipo visto: **Requisição HTTP (Webhook)** com **endpoint gerado** (`https://api.datacrazy.io/v1/crm/api/...`) — copiável. Suporta **+ Adicionar gatilho** (múltiplos gatilhos). Aresta rotulada "Quando o evento ocorrer, então →".
- **Nó de mapeamento de campos** (Operações de campos): mapeia payload do webhook → campos do lead (Nome, Telefone…), com **avisos de validação** ("campos não serão preenchidos se não existir…").
- **Observabilidade inline por nó:** cada nó mostra **Sucessos · Alertas · Erros** (contadores de execução direto no card do nó). Excelente pra debugar.
- **Toolbar do fluxo:** toggle ativar/desativar, salvar, editar, **duplicar**, **exportar/download** (portável!), copiar, **excluir**, expandir.

**Modelo de dados implícito:** automação = grafo de nós tipados (trigger → ações/condições/espera/IA/JS) + estado ativo/inativo + categoria + contadores de execução por nó. Gatilhos: webhook (endpoint próprio), e outros (evento de CRM, formulário). Fluxos são **exportáveis** (JSON provável).

**UX/feature que faz MUITO BEM:**
- **Automação visual no-code/low-code** com **nós de IA e de JavaScript** — cobre desde marketing simples até lógica de engenharia, sem sair da tela.
- **Webhook trigger com endpoint gerado** — integra qualquer origem (Meta, Make, formulário) sem código.
- **Contadores Sucesso/Alerta/Erro por nó** — observabilidade de automação de 1ª classe (o nossocrm hoje depende de logs no Vercel/Supabase).
- **Categorias + toggle on/off + duplicar + exportar** — versionamento/portabilidade e organização.
- **Randomizador** pra A/B de copy/cadência.
- **Espera** nativa pra montar cadências (follow-up) visualmente.

**Roubar / melhorar pro nossocrm (ALTO valor, mas ALTO esforço):**
- O nossocrm hoje tem a lógica da Ana **hardcoded** no `agent.service` (TS). Um **builder visual** (mesmo que mínimo: trigger → condição → espera → mensagem → ação) deixaria a Thalita ajustar cadências **sem deploy**. Hoje cada ajuste da Ana é um `UPDATE` SQL ou commit.
- **Contadores por passo (sucesso/alerta/erro)** — dá pra implementar já com as `activities`/logs que temos, exposto numa tela; mata o "silêncio" que a gente só descobre olhando log.
- **Nó de IA reutilizável** — encapsular a chamada Claude/Gemini como um "bloco" configurável (prompt + saída estruturada) reaproveitável em vários fluxos.
- **Webhook trigger com endpoint por fluxo** — hoje temos uma route única; endpoints por automação simplificariam integrações (Meta/Make/isca) e o cutover do Caminho B.
- **Exportar/importar fluxo** (JSON) — versionar cadências no git.
- **Espera + Randomizador** — as 4 cadências da Ana (estratégia de follow-up) viram fluxos visuais com A/B, em vez de cron + código.

---

## 6. Agentes de IA — `/ia`

**Propósito:** "Gerencie seus agentes para que eles executem as tarefas para você." Plataforma pra montar uma **equipe de agentes de IA** configuráveis dentro do CRM.

**Layout & navegação:**
- Esquerda: lista de **Agentes** (empty state: "Você ainda não tem nenhum agente… Comece a construir a sua equipe de IA" + "Criar meu primeiro agente"). *(Conta Niva vazia — a Ana roda no nossocrm, não aqui.)*
- Direita: duas abas — **Bases de Conhecimento** (RAG: "Descubra, organize e gerencie suas bases de conhecimento", busca, "Nova Base") e **Servidores MCP** (conectar **servidores MCP** aos agentes).

**Modelo implícito:** Agente (persona/tarefa) + **Bases de Conhecimento** (RAG anexável) + **Servidores MCP** (ferramentas externas via MCP). É o mesmo tripé de um agente moderno: instruções + conhecimento + ferramentas.

**UX/feature que faz BEM:**
- **Agentes de IA como entidade configurável de produto** (não hardcoded) — o cliente monta o próprio agente.
- **Bases de Conhecimento (RAG)** nativas pra alimentar o agente.
- **Servidores MCP** — o agente pluga ferramentas via MCP (arquitetura aberta e atual).
- O nó **IA** do flow builder + os **Agentes de IA** se complementam: agente conversacional + IA pontual dentro de automações.

**Roubar / melhorar pro nossocrm:**
- **Base de Conhecimento (RAG) plugável na Ana** — hoje a persona da Ana é prompt gigante em SQL; uma KB (argumentos de reajuste composto, carência, reembolso, objeções) recuperável seria mais manutenível e escalável por cliente.
- **Config de agente via UI** (persona, modelo, tools) em vez de `UPDATE` SQL — deixa a Thalita versionar/testar a Ana sem código. (Casa com o projeto "qualidade da Ana x modelo".)
- **MCP como camada de ferramentas do agente** — a Ana poderia acessar agenda/CRM via tools MCP declaradas, não via código acoplado.
- Se o nossocrm virar produto multi-cliente, "Agentes de IA + KB + MCP" é o modelo de produtização (cada cliente monta seu SDR).

---

## 7. Chat ao vivo (multiatendimento) — `/multiservice`

**Propósito:** inbox operacional de **multiatendimento** — conversas de **WhatsApp + Instagram** centralizadas numa fila com status/SLA, atribuíveis a atendentes, com a IA/automação respondendo inline.

**Layout (3 colunas):**
- **Esquerda — fila de conversas:** busca ("Pesquise seus contatos"), ícones (refresh, notificações, config). **Chips de status com contadores** — ex.: **Não iniciados (20)**, + fileira de filtros com contagens (20 / 23 / 79 / 23) e ícones de **resolvidos (✓)**, **alerta (⚠)** e **arquivados**. "Filtros" + menu "⋯". Cada item: avatar com **badge do canal** (Instagram / WhatsApp), nome, **preview da última mensagem**, timestamp, **bolinha de não-lida**, **tags** (ex. origem "Página de…") e, em alguns, **relógio laranja = SLA estourado**.
- **Centro — thread:** header com nome + canal + **#número do negócio** (vínculo conversa↔deal) + **"Marcar como lida"** + **"Finalizar"** (resolver) + "⋯". Mensagens com separadores de data; respostas do bot aparecem **rotuladas "Automação"** com checkmarks de entrega (transparência de quem respondeu). **Composer** rico: anexo, **calendário (agendar)**, **respostas rápidas**, **áudio**, texto, emoji.
- **Direita — painel do contato/lead:** nome + telefone/id + **vínculo com lead**: quando não há lead, mostra **"Lead não encontrado"** → **"Criar lead"** / **"Atribuir a lead existente"**. Ou seja, a **conversa existe antes do lead** e pode ser promovida/linkada depois.

**Modelo de dados implícito:** Conversa (atendimento) tem canal, status (não iniciado / em andamento / aguardando / finalizado / arquivado), atendente, SLA, tags, e vínculo opcional a **lead** e a **negócio (#)**. Mensagens têm autor (contato / atendente / **Automação**) e status de entrega.

**UX que faz BEM:**
- **Inbox multicanal unificado** (WhatsApp + Instagram) com badge de canal por conversa.
- **Fila por status com contadores** (não iniciado / aguardando / resolvido / arquivado) — visão operacional de plantão.
- **SLA visível por conversa** (relógio laranja quando estoura).
- **Bot rotulado "Automação"** dentro do thread — dá pra auditar exatamente o que a IA mandou, no mesmo lugar do humano.
- **Conversa → lead → negócio** como promoção progressiva (não exige lead pré-existente).
- **Composer com agendar + respostas rápidas + áudio** — ferramentas de venda no atendimento.

**Roubar / melhorar pro nossocrm:**
- **Fila por status com contadores + SLA por conversa** — hoje o nosso inbox mostra conversas, mas uma **fila "não iniciado / aguardando / resolvido"** com relógio de SLA dá controle de plantão (e casa com o first-response do dashboard).
- **Badge de canal** e caminho pra **Instagram** além de WhatsApp (a Niva capta muito no IG via ManyChat/iscas).
- **"Finalizar" atendimento** explícito (resolver) — separa conversa ativa de encerrada, alimentando métrica de finalizados.
- **Rotular claramente as mensagens da Ana** como automação no thread (auditabilidade — ajuda a debugar a Ana no próprio inbox).
- **Respostas rápidas + agendar** direto do composer (o consultor agenda sem sair da conversa).
- **Promoção conversa→lead→negócio** com "atribuir a lead existente" (dedupe manual quando o match automático falha).

---

## 8. Configurações — `/config/*`

**Propósito:** central de configuração da conta/organização. O sub-menu revela boa parte do **modelo de dados e do modelo operacional** do produto.

**Sub-navegação completa (17 seções) — todas abertas e verificadas:**
| Seção | Rota | O que é (observado) |
|---|---|---|
| **Meu perfil** | `/config/my-profile` | Nome, telefone, e-mail, **alterar senha**, imagem, **Sair**; **Preferências → Tema** (Claro/escuro, *Beta*). |
| **Planos e uso** | `/config/plans` | Plano **Mini Starter — R$ 147,00/mês** (cartão ****6629, renova 15/ago); medidores de uso; add-on **Crazy IA** (pacotes de 50M tokens). Detalhe abaixo. |
| **Empresa** | `/config/company` | Perfil da org: nome, e-mail, **nicho**, telefone, logo, **documentos (Tipo de Pessoa)**, cidade. |
| **Tags** | `/config/tag` | CRUD de tags/labels (nome + cor). *(Tela pesada — travou no render; estrutura idêntica às outras tabelas de config.)* |
| **Produtos** | `/config/product` | **Catálogo de 58 produtos** = operadoras/planos de saúde (SKU + preço). Detalhe abaixo. |
| **Motivos de perda** | `/config/business-loss-reason` | **83 motivos de perda estruturados**, específicos de plano de saúde, cada um com flag **Obrigatório**. Detalhe abaixo. |
| **Listas** | `/config/list` | Listas/segmentos **estáticos** de contatos (nome + descrição). Vazio na conta. |
| **Campos adicionais** | `/config/additional-fields` | **Custom fields em 3 escopos** (lead / negócio / empresa), com tipo, descrição, privacidade, "sempre visível", grupo e ordem. Detalhe abaixo. |
| **Departamentos** | `/config/departments` | Departamentos (nome + data). Vazio. **Grouping leve — NÃO é matriz de permissões/roles** (não há tela de Usuários/Permissões). |
| **Horários de trabalho** | `/config/working-hours` | Agendas de **business hours** nomeadas ("Horário Comercial": Seg–Sáb, 9h/dia), atribuíveis a colaboradores/departamentos. |
| **Tipos de atividades** | `/config/activities` | **6 tipos com cor**: Follow-up, Nota, Tarefa, Email, Reunião, Ligação. |
| **Integrações** | `/config/integrations` | **Webhooks de entrada** nomeados — "Automações via webhooks". |
| **Conexões** | `/config/instances` | **Conexões de canal** (Instagram API + UAZAPI). |
| **Servidor MCP** | `/config/mcp-server` | **Servidor MCP embutido** com toggle **por ferramenta** + selo de risco. Detalhe abaixo. |
| **Armazenamento** | `/config/storage` | Gestão de storage + contratar extra. **"Em breve"** (ainda não disponível). |
| **Lixeira** | `/config/trash` | **Soft-delete recuperável**, retenção de **7 dias**, por entidade (Automações/Pipelines/Negócios/Leads/Instâncias) com "Dias restantes". |
| **Execuções** | `/config/jobs` | **Fila de jobs de IMPORTAÇÃO/EXPORTAÇÃO** (Tipo·Entidade·Status·Período; progresso, erro, arquivos). = o módulo de import/export. |

**Integrações (webhooks de entrada) — detalhe:** cada integração é um **endpoint de webhook nomeado** que recebe dados e mapeia pra criar lead + associar negócio + adicionar tags automaticamente. Na Niva: "Entrada de Negócios" alimentada pela "Página de Vendas — Diagnóstico" (o formulário de captação). Com toggle on/off e "Gerenciar". É exatamente o **Caminho B** (route de entrada de lead) do nossocrm, mas configurável por UI.

**Conexões (canais) — detalhe:** plugam **provedores de mensageria**:
- **Instagram API** (oficial) — handle `nivaconsultoria`, "receber e responder mensagens diretas". *Conectado.*
- **Uazapi** (`uazapi.dev`) — "API de terceiros para integração e automação de mensagens no WhatsApp". *Conectado.* → **O DataCrazy usa a MESMA UAZAPI que o nossocrm** como provider de WhatsApp; a camada "Conexões" é o que abstrai o provider.

**Motivos de perda — detalhe (achado forte):** **83 motivos estruturados**, curados pra plano de saúde, com flag "Obrigatório". Exemplos reais: *"Operadora recusou emissão por análise interna"*, *"Não atende área de cobertura da operadora"*, *"CNPJ recém-aberto sem faturamento (operadoras que exigem)"*, *"Não possui CNPJ ativo para planos empresariais"*, *"Menos vidas do que o mínimo exigido"*, *"Cliente não aceitou regras do plano coletivo"*, *"Vai ver novamente após melhorar condição financeira"*, *"Prioridade mudou no momento"*, *"Sem economia"*. → **A Niva já curou uma taxonomia de 83 motivos reais** aqui — ativo direto pra importar pro nossocrm (unificar com a taxonomia de 13 do caminho por voz) e pra alimentar reabordagem/Nutrição.

**Produtos — detalhe:** **58 operadoras/planos** (Alice, Geap, Fusex, Postal, Cassi, Afresp, Sermed, Medial — "estrutura antiga absorvida, mas ainda aparece em bases" —, Trasmontano, Smile Saúde…) com SKU + preço. Outro ativo de dado já curado (universo de produtos da Niva).

**Campos adicionais — detalhe:** custom fields em **3 escopos** (lead / negócio / empresa), cada campo com **tipo** (texto/número/data/seleção), **descrição**, **privacidade** (público/privado), **"sempre visível"**, **grupo** e **ordem** (arrastável). Campos de lead reais da Niva: Orçamento, Origem do Lead, Porte da Empresa, Próximo Contato, co-participação, Dificuldade, Hospital preferencial, Operadora atual, Plano atual, idades, CNPJ, possui plano. Ótima referência do que a Ana deveria capturar/estruturar.

**Servidor MCP — detalhe:** **servidor MCP embutido no CRM** ("conecte seu agente de IA ao servidor MCP", endpoint `/api/mcp`, auth `Authorization: Bearer <token>`). **Toggle por ferramenta individual**, cada uma com **selo de risco (Baixo/Médio)**, agrupadas em ~15 categorias com contadores habilitados/total: Leads 4/15 · Negócios 0/10 · Pipelines 0/7 · Campos Adicionais 0/7 · Produtos/Tags/Listas/Atividades/Motivos de Perda/Conversas/Departamentos 0/5 cada · Atendentes/Horários/Conexões 0/2 (~70+ tools no total). "Habilitar todos".

**Planos e uso — detalhe (estratégico):** a Niva paga **Mini Starter R$ 147,00/mês** (cartão ****6629). Limites: 5 pipelines/8 etapas, 10k leads, **2 membros**, **2 conexões (2/2 — no talo)**, 5 automações, 2 webhooks — com medidores de uso (Leads 184/10000; Automações 2/5; Pipelines 2/5). O **add-on de IA "Crazy IA"** (responder com IA, seguir fluxos por intenção, resumo automático de conversas) é vendido em **pacotes de 50 milhões de tokens** — e está com **quantidade 0**: a Niva **não usa a IA do DataCrazy**, roda a Ana no nossocrm. Ou seja, hoje paga R$147/mês só pelo shell do CRM; **migrar de vez pro nossocrm elimina esse custo**.

**UX/feature que faz BEM:**
- **Motivos de perda estruturados** — padroniza o "porquê perdeu" (analisável), em vez de texto livre.
- **Campos adicionais / Tipos de atividade / Horários de trabalho** todos **configuráveis por UI** — o modelo é data-driven, não hardcoded.
- **Conexões como abstração de canal** (IG oficial + UAZAPI) — multicanal plugável.
- **Integrações = webhooks nomeados com mapeamento** — intake sem código.
- **Lixeira (soft-delete recuperável)** + **Execuções (logs)** — segurança operacional e observabilidade.
- **Departamentos** como unidade de organização/escopo.
- **Tema claro/escuro** nativo.

**Roubar / melhorar pro nossocrm:**
- **Motivos de perda estruturados** — encaixa DIRETO no projeto "Áudio→IA→CRM" (objeções/perdas estruturadas) e alimenta o board de Nutrição/reabordagem. *(Já existe taxonomia de 13 categorias em `lib/ai/taxonomy/motivos.ts` no caminho por VOZ, mas o botão "Perdido" MANUAL grava texto livre em `deals.loss_reason` via `LossReasonModal.tsx` — falta unificar. Ver seção final.)*
- **Tipos de atividade geridos por UI** — hoje são enum hardcoded (`ActivityFormModalV2.tsx`). *(Nuance: a tela de **Campos adicionais** JÁ EXISTE no nossocrm — `CustomFieldsManager.tsx`; não confundir. Ver seção final.)*
- ~~**Camada "Conexões"** pra abstrair UAZAPI/Instagram/(WhatsApp oficial)~~ — **✅ já temos**: `lib/messaging/providers/` (uazapi, evolution, z-api, meta-cloud, instagram, email) + `ChannelsSection.tsx`. Falta só a Niva **plugar o canal oficial** por essa UI (a plumbing existe).
- **Horários de trabalho** — o motor da Ana JÁ respeita `business_hours` (`agent.service.ts` passo 8), mas só é ajustável por JSON no banco; **falta o toggle na UI** de config da Ana.
- **Lixeira (soft-delete recuperável) exposta** — o nossocrm já teve bug de soft-deleted aparecendo no board; uma Lixeira de verdade (retenção de 7d, por entidade) resolve os dois lados (some do board, recuperável).
- **Importação/Exportação com fila de jobs** (a "Execuções" dele) — o nossocrm JÁ TEM import/export de **contatos** (`features/contacts/components/ContactsImportExportModal.tsx` + `api/contacts/import|export`), mas **síncrono, só contatos, sem monitor de jobs**. O delta é: estender a **negócios** e ter uma **fila assíncrona com progresso/erro/arquivo**.
- **UI de toggle por ferramenta do MCP + selo de risco** — o nossocrm já tem servidor MCP (código), mas expor uma tela pra ligar/desligar cada tool com rótulo de risco dá governança (ex.: deixar só read-only pra um agente externo).
- **Importar os 83 motivos de perda + 58 produtos** que a Niva já curou no DataCrazy — dado pronto, evita recomeçar do zero no nossocrm.
- **Integrações por UI (webhook nomeado + mapeamento)** — produtiza o Caminho B e o intake do Meta/Make sem tocar em código.
- **RBAC: aqui o nossocrm está À FRENTE** — o DataCrazy não tem tela de Usuários/Roles/Permissões (só "Departamentos" como grouping leve); o nossocrm tem papéis admin/vendedor/trafego com middleware default-deny. Não copiar; manter.

---

# Melhorias priorizadas pro nossocrm

O DataCrazy nos ganha em três frentes concretas: **segmentação de base** (RFM, filtro por origem/qualificação, segmentos salvos e ação em massa — hoje a nossa tela de Contatos é praticamente um `select('*')` sem agregação), **campanha/impulso em massa** (não existe entidade `campaign`; nosso único disparo em lote é o follow-up da Ana, hardcoded numa board só) e **edição sem SQL** (persona da Ana, cadências e KB ainda são tunados por `UPDATE` em produção). A boa notícia: quase tudo tem o plumbing pronto no banco — o gap é de **UI + uma camada fina de orquestração**, não de fundação.

> ⚙️ Este ranking foi **cruzado com o código real do nossocrm** (não com achismo): cada item marcado `implementada` / `parcial` / `ausente` com o arquivo que prova. Vários "features do concorrente" que pareciam faltar **já existem** — estão em **"Já temos (não reconstruir)"** no fim. Ordenado por **impacto ↓ × esforço ↑**.

| # | Melhoria | Módulo | Estado | Impacto | Esforço | Evidência/arquivo (nossocrm) |
|---|----------|--------|--------|---------|---------|------------------------------|
| 1 | Editar persona/prompt do agente na UI (fim do UPDATE SQL) | Agentes de IA | parcial | alto | baixo | `PUT /api/ai/board-config/[boardId]` já aceita `persona_prompt`, mas `BoardAIConfigModal.tsx` é read-only; `ai_base_system_prompt` sem editor → tuning por `docs/niva-ana-persona-tweaks-*.sql` |
| 2 | Relógio de SLA por conversa (aguardando resposta há X) | Chat ao vivo | parcial | alto | baixo | FRT só agregado; por conversa só a janela 24h (`WindowExpiryBadge` em `ConversationItem.tsx`). Dado pronto: `last_message_direction` + `last_message_at` |
| 3 | Visão contato → N negócios + renovação vira novo deal | Pipelines | parcial | alto | médio | Schema permite N deals/contato (`deals.contact_id` sem unique); falta aba de deals no contato (`ContactsPage.tsx:236`) e automação de renovação (`BoardCreationWizard.tsx:227`) |
| 4 | Filtro de contatos por origem e por qualificação | Leads | ausente | alto | médio | `ContactsServerFilters` sem `source` (existe em `schema_init.sql:245`); qualificação em `deals.ai_extracted`/`custom_fields` (`contacts.ts:344-382`) |
| 5 | Ações em massa reais (mover, taggear) na base | Leads | parcial | alto | médio | Seleção em massa existe (`useContactsController.ts:300-320`) mas só EXCLUIR; mover reusa `useUpdateContactStage`; tag exige `contact_tags` (não existe) |
| 6 | Template HSM aprovado como campanha em lote | Impulsos | parcial | alto | médio | HSM 1:1 completo (`send-template/route.ts`, `TemplateManager.tsx`) mas aceita 1 `conversationId`; falta iterar segmento reusando `router.sendTemplate` |
| 7 | Base de conhecimento (RAG) plugável na Ana | Agentes de IA | parcial | alto | médio | Read-path pronto (`file-search.ts` + `agent.service.ts:904-925`), mas `createFileSearchStore`/`uploadToFileSearchStore` nunca chamados — sem UI de upload |
| 8 | Respostas rápidas + agendar reunião no composer | Chat ao vivo | parcial | alto | médio | `useQuickScripts` + `ScheduleModal` existem no inbox SDR (`FocusContextPanel.tsx`) mas o `MessageInput.tsx` do multiatendimento só tem HSM+emoji+mídia |
| 9 | Promover conversa → lead → negócio no fallback manual | Chat ao vivo | parcial | alto | médio | `ContactLinkModal.tsx` só vincula CONTATO; `ContactPanel` só "Ver Deals" — sem "criar/atribuir negócio" |
| 10 | Motivos de perda estruturados (unificar voz + botão manual) | Configurações | parcial | alto | médio | Taxonomia de 13 categorias em `lib/ai/taxonomy/motivos.ts` (só caminho por VOZ); botão "Perdido" manual grava TEXTO LIVRE em `deals.loss_reason` via `LossReasonModal.tsx` — não unificado; funnel report só cobre as por voz |
| 11 | Métricas RFM por contato na base | Leads | parcial | alto | alto | `contacts` tem `last_purchase_date`/`total_value` mas sem count/avg/ciclo; query sem join em deals (`contacts.ts:337-390`) |
| 12 | Motor de campanha/disparo em massa com pacing | Impulsos | parcial | alto | alto | Zero tabela `campaigns`; único motor em lote é `lib/ai/followup/run.ts` (batch 40) hardcoded a `ANA_SDR_BOARD_ID` |
| 13 | Builder visual de automação (trigger→condição→espera→ação) | Automações | ausente | alto | alto | Sem lib de canvas no `package.json`, sem tabela `automations`; cadências são constantes TS (`followup/schedule.ts`) |
| 14 | Produtização multi-cliente (agente+KB+MCP self-serve) | Agentes de IA | parcial | alto | alto | Multi-tenant + `board_ai_config` + MCP por org + installer existem; falta KB self-serve (item 7), onboarding coeso e billing/SKU |
| 15 | SLA de atividades atrasadas por consultor no dashboard | Dashboard | ausente | médio | baixo | Primitivo de overdue existe (`overdueActivitiesAnalyzer.ts`), sem agregação por `owner_id` nem widget |
| 16 | Ranking por produto (e vendedor na Visão Geral) | Dashboard | parcial | médio | baixo | Leaderboard de vendedor em Relatórios (`ReportsPage.tsx:109-132`); produto ausente apesar de `deal.productId` + `useProductsQuery.ts` |
| 17 | "Há Xd nesta etapa" no card/modal do deal | Pipelines | parcial | médio | baixo | `last_stage_change_date` já gravado (`useMoveDeal.ts`); ampulheta cobre estagnado (`DealCard.tsx:351-358`) mas sem dwell-time por etapa |
| 18 | Contadores por rodada da cadência em tela | Automações | parcial | médio | baixo | `runLeadFollowup` retorna `{processed,failed,skipped}` só em `console.log` (`route.ts:59`); reusar padrão de `WebhooksSection.tsx` |
| 19 | Confirmar/terminar disparo de webhook de saída | Automações | parcial | médio | baixo | `integration_outbound_endpoints` é config-only (`WebhooksSection.tsx`); sem dispatcher server-side em `deal.stage_changed` |
| 20 | Selo "Automação (Ana)" na bolha do thread | Chat ao vivo | ausente | médio | baixo | `sender_type` existe no banco mas `MessagingMessage` (`message.types.ts:211-230`) não carrega; `MessageBubble` não pinta selo |
| 21 | Toggle "só responder em horário comercial" na UI da Ana | Configurações | parcial | médio | baixo | Motor já respeita `business_hours` (`agent.service.ts` passo 8, `adaptive-context.ts`); só ajustável por JSON em `stage_ai_config` — sem toggle na UI |
| 22 | Heatmap dia-da-semana × hora de entrada de lead | Dashboard | ausente | médio | médio | Zero heatmap; lógica dow/hora só p/ agendamento (`availability.ts`); precisa RPC agregando `messaging_messages` inbound + grade SVG |
| 23 | Agrupar funis em pastas (Vendas/Pós-venda/Admin) | Pipelines | ausente | médio | médio | `BoardSelector.tsx:68-129` renderiza lista flat; `boards.type` existe mas nunca agrupa |
| 24 | Timeline do deal com autor/origem (Ana vs consultor vs automação) | Pipelines | parcial | médio | médio | Origem em `deal_activities.metadata.triggered_by`, mas timeline lê de `activities` (`DealDetailModal.tsx:234-237`); manual vira "Sistema" |
| 25 | Views/segmentos salvos de contatos | Leads | ausente | médio | médio | Filtros são `useState` efêmero (`useContactsController.ts:58-77`); sem `contact_segments`; depende do item 4 |
| 26 | Monitor de execução de campanha em tempo real | Impulsos | ausente | médio | médio | Sem monitor por passo; depende do item 12; app já tem Supabase Realtime (`useRealtimeSync.ts`) |
| 27 | Nó de IA reutilizável (Claude/Gemini como bloco) | Automações | parcial | médio | médio | Primitiva pronta (`catalog.ts` + `ai_prompt_templates`), mas chamadas por código, sem fluxo que as hospede |
| 28 | Nó de espera + randomizador A/B na cadência | Automações | parcial | médio | médio | Esperas fixas em `schedule.ts` (COLD/WARM); sem A/B — bucketizar por hash de `deal.id` (idempotência no cron, não `Math.random`) |
| 29 | Fila de inbox por status com contadores | Chat ao vivo | parcial | médio | médio | Enum só `open`/`resolved` (`create_messaging_system.sql:239`); abas sem contador; "aguardando" derivável de `last_message_direction` |
| 30 | Lixeira / soft-delete recuperável na UI | Configurações | parcial | médio | médio | `deleted_at` + triggers de cascata + RLS já no schema; sem tela de restauração (`DataStorageSettings.tsx` só "Zerar Database" = hard delete) |
| 31 | Tela de Execuções (logs de webhook in/out) na UI | Configurações | parcial | médio | médio | Só "Últimos recebidos" (3 eventos) em `WebhooksSection.tsx`; `webhook_events_out`/`webhook_deliveries` existem sem UI |
| 32 | Rodar automação escolhida num deal específico | Pipelines | parcial | médio | alto | Disparos manuais de valor já existem (no-show/resgate, reativar IA); genérico só compensa virando builder (item 13) |
| 33 | Mapeamento de campos configurável no webhook de entrada | Configurações | parcial | médio | alto | Webhook nomeado+roteável pronto (`integration_inbound_sources` + `WebhooksSection.tsx`), mas mapeamento HARDCODED em `functions/webhook-in/index.ts` |
| 34 | Toggle Valor↔Quantidade nos gráficos | Dashboard | ausente | baixo | baixo | Gráficos fixos (`FunnelChart`=qtd, `RevenueTrendChart`=valor); dá pra switch local `useState` sobre `funnelData` |
| 35 | Contar finalizados na métrica de mensagens | Chat ao vivo | parcial | baixo | baixo | Botão "Marcar como resolvida" pronto (`MessagingPage.tsx:275-284`) mas `get_messaging_metrics` não conta `status='resolved'` |
| 36 | Onboarding contextual por tela (coachmarks) | Dashboard | parcial | baixo | médio | Só modais globais (`OnboardingModal.tsx`, `AIOnboarding.tsx`); sem lib de tour por tela |
| 37 | Tipos de atividade configuráveis por UI | Configurações | ausente | baixo | médio | Enum hardcoded (`ActivityFormModalV2.tsx`, `lib/validations/schemas.ts`); sem tabela `activity_types`. Os 4-5 tipos fixos bastam pra Niva hoje |
| 38 | Export/import de cadência em JSON | Automações | ausente | baixo | médio | Cadências são constantes TS já versionadas no git; só vale quando "automação" virar tabela |

**Complemento (2ª passada em Configurações — encaixam no tier médio/médio, ~itens 22–31):**

| Melhoria | Módulo | Estado | Impacto | Esforço | Evidência/arquivo (nossocrm) |
|----------|--------|--------|---------|---------|------------------------------|
| Import/export de **negócios** + fila de jobs assíncrona com progresso | Configurações | parcial | médio | médio | Import/export de **contatos** já existe (`ContactsImportExportModal.tsx`, `api/contacts/import`+`export`), mas síncrono e só contatos; sem job queue nem negócios |
| UI de habilitar/desabilitar **tools do MCP** por item + selo de risco | Agentes de IA | parcial | médio | médio | Servidor MCP + catálogo existem (`lib/mcp/crmToolCatalog.ts`, `app/api/[transport]/route.ts`) mas sem UI de toggle por tool — hoje é code-defined |
| **Importar os 83 motivos de perda + 58 produtos** já curados no DataCrazy | Configurações | dado externo | alto | baixo | Ativo pronto na conta DataCrazy da Niva; casa com item 10 (`lib/ai/taxonomy/motivos.ts`) e com `useProductsQuery.ts` — evita recriar do zero |

> A **importação dos 83 motivos + 58 produtos** é o quick-win oculto: impacto alto (padroniza perda + catálogo real de operadoras), esforço baixo (é migração de dado, não código). Faria par com os quick wins abaixo.

### Quick wins (alto impacto, baixo esforço) — fazer primeiro

- **Textarea de persona editável na UI** — adicionar campo de `persona_prompt` (e de `ai_base_system_prompt`) no modo avançado do `BoardAIConfigModal.tsx`; o `PUT /api/ai/board-config/[boardId]` já persiste. Mata os `UPDATE` em produção, hoje o maior risco operacional da Ana.
- **Relógio de SLA por conversa** — badge vermelho em `ConversationItem.tsx` quando `last_message_direction='inbound'` passa de X min sem resposta; dado já existe, move o ponteiro de conversão pela velocidade.
- **Filtro por origem na base** — expor a coluna `source` (já em `schema_init.sql:245`) no `ContactsServerFilters` + `ContactsFilters.tsx`, isolando lead por isca/guia como alvo de cadência.
- **Mover em massa** — plugar `useUpdateContactStage` na barra de seleção que já existe em `ContactsList.tsx:190-244`, operacionalizando a reativação da base fria.
- **Selo "Automação (Ana)" na bolha** — puxar `sender_type` na query de mensagens, mapear em `MessagingMessage`, pintar pill quando `sender_type in ('ai','agent')`, pro humano que assume saber o que a Ana já falou.

### Apostas grandes (alto impacto, alto esforço) — roadmap

- **Motor de campanha/impulso em massa com pacing** (`campaigns` + worker que enfileira segmento reusando o espaçamento já provado em `lib/ai/followup`) — caminho pra reativar a base fria com anti-ban (dor real da Niva no outbound UAZAPI), casa com o template HSM (item 6).
- **RFM/segmentação de contato** (RPC/materialized view agregando deals por contato + colunas na `ContactsList`) — remapeado pra seguro-saúde (prêmio médio + recência de interação, não recompra); alimenta a régua de reativação e a cadência por segmento; base do funil de retenção anual.
- **Base de conhecimento self-serve na Ana** (fechar o write-path do File Search + reativar o Step 3 do wizard) — tira operadoras/objeções/carência do prompt gigante, deixa só estilo+regra no persona; pré-requisito pra vender o CRM multi-cliente sem SQL.
- **Produtização multi-cliente (agente+KB+MCP num onboarding só)** — os blocos existem (multi-tenant, agente por org, MCP por org, installer); falta amarrar num fluxo guiado + billing/limites. Transforma o CRM interno num SKU vendável — validar com 1 cliente-piloto 100% pela UI antes do packaging.

### Já temos (NÃO reconstruir) — o teardown parecia gap, mas o código já cobre

- **Lente de multiatendimento no dashboard** (mensagens enviadas, FRT, taxa de resposta, split Humanos/IA/Sistema) — `features/dashboard/components/MessagingMetricsSection.tsx` + RPC `get_messaging_metrics`. Ajuste barato: a subquery de FRT (linhas 163-172) não filtra por `p_user_id`.
- **% de variação vs período anterior nos KPIs** — `features/dashboard/hooks/useDashboardMetrics.ts` (`getPreviousDateRange`/`calculateChange`/`changes`), consumido nos StatCards.
- **Badge "sem próxima atividade" no card** — `ActivityStatusIcon.tsx` (triângulo amarelo) via `getActivityStatus` em `useBoardsController.ts:44-45`, aplicado em `DealCard.tsx:534-536`.
- **MCP como camada de ferramentas do agente** — servidor em `app/api/[transport]/route.ts` (auth por `api_key` por org) + catálogo de ~50 tools em `lib/mcp/crmToolCatalog.ts` + tool-loop em `lib/ai/crmAgent.ts`. (A agenda determinística da Ana em `lib/ai/scheduling/*` fica como está — migrar pra tool-call só traria regressão.)
- **Badge de canal por conversa + Instagram 1ª classe** — `ChannelIndicator.tsx` + provider `lib/messaging/providers/instagram/meta.provider.ts` + webhook `messaging-webhook-meta`. Falta só CONFIGURAR o canal IG da Niva em Settings, não código.
- **Tela de gestão de Campos adicionais (custom fields)** — `features/settings/components/CustomFieldsManager.tsx` (criar/editar/remover; tipos text/number/date/select com opções), valores em `deals.custom_fields` (JSONB). Robusto. *(Nuance conhecida: o intake/webhook não semeia esses campos na criação do lead.)*
- **Camada "Conexões" / abstração de provedor de canal** — `lib/messaging/providers/` (uazapi, evolution, z-api, meta-cloud, instagram, email) + `channel-factory.ts` + `channel-router.service.ts` + tabela `messaging_channels` + UI `ChannelsSection.tsx`/`ChannelSetupWizard.tsx` + `lead_routing_rules`. Paridade (ou superior) com o "Conexões" do DataCrazy — que, aliás, roda o WhatsApp pela **mesma UAZAPI** que a gente.

---

## Meta-observações do teardown

- **DataCrazy = concorrente-espelho**: mesmo território (CRM conversacional com IA pra WhatsApp/Instagram), mesmo provider de WhatsApp (**UAZAPI**). O que ele empacota em produto, a gente tem em código — o delta é quase todo **UI de configuração** e uma **camada de campanha em massa**.
- **O maior diferencial dele é o flow builder visual** (`/flow`) com nós de IA e JavaScript + contadores por nó. É a aposta grande #13 e a que mais muda o jogo pra Thalita operar a Ana sem deploy.
- **Onde a gente já ganha**: dashboard de atendimento, MCP tools, custom fields UI, abstração de canais, badge de próxima atividade, %-variação — tudo já existe e não precisa reconstruir. E em **RBAC** (papéis/permissões) o nossocrm está à frente: o DataCrazy nem tem tela de usuários/roles.
- **Custo & migração**: a Niva paga **R$ 147/mês** pelo DataCrazy (plano Mini Starter) **sem usar a IA dele** (add-on "Crazy IA" em quantidade 0 — a Ana roda no nossocrm). Concluir a migração pro nossocrm **elimina esse custo recorrente**. Só há 2/2 conexões no talo (IG + UAZAPI) e 184/10000 leads.
- **Ativos de dado já curados no DataCrazy pra puxar**: **83 motivos de perda** estruturados (plano de saúde) e **58 produtos/operadoras** (SKU+preço). Importar em vez de recriar.
- ✅ **Cobertura**: todos os 8 módulos + as 17 telas de Configurações foram abertos e verificados (o navegador travou em várias views pesadas — flow canvas, modal de deal, tabelas grandes — mas com recuperação por aba nova cada tela foi capturada). Único item não-renderizado: a tabela de **Tags** (trava no volume), cuja estrutura é idêntica às demais tabelas de config (nome + cor + data).
