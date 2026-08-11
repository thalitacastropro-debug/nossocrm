# Spec — Áudio → IA → CRM (desfecho da call por voz) + botão "Reunião realizada"

> Data: 2026-07-11 · Repo: `nossocrm` · Branch de trabalho: `feat/lead-intake-route` (NÃO mergear na `main` até go-live)
> Produto: NIVA CRM · Board alvo: Consultor (`efbaa84e-cf4b-4465-8b50-41afd612088e`)
> Origem: HANDOFF (#11 "áudio→IA→CRM — a MAIOR dor") + `referencia-melhorias-crm-consultor.md` §2

## 1. Problema e objetivo

O consultor humano (Denilson) não atualiza o CRM — e sem o desfecho de cada ligação, o funil quebra (lead → cliente → nutrição). **Humano fala, não digita.** Depois da call, ele abre o card, grava uma nota de voz de ~30s ("fechei com a Valéria, 3 vidas, Amil, assina semana que vem"), a IA transcreve + estrutura o desfecho, mostra um **card de revisão editável**, e ao confirmar grava tudo no CRM. Além disso, um botão manual **"Reunião realizada"** (par simétrico do "No-show" que já existe) alimenta a **métrica de reuniões realizadas** — inclusive para leads que não passaram pela Ana (indicação/orgânico).

### Métricas de sucesso
- O consultor registra o desfecho de uma call em < 30s, só falando.
- O card reflete: desfecho, nota-resumo, próximo passo (com data), dados do negócio, etapa movida.
- O funil ganha o elo **Agendadas → Realizadas → Vendas** (hoje só existe Agendadas e No-show).

## 2. Fluxo ponta a ponta

```
Consultor abre o card (DealDetailModal)
  → aperta 🎤 (botão no cluster do header, ao lado de "Preparar")
  → grava voz (MediaRecorder)  → sobe o áudio (bucket privado deal-files)
  → [servidor] Gemini transcreve  → IA extrai desfecho ESTRUTURADO
  → CARD DE REVISÃO editável (transcrição visível + campos)
  → consultor confirma/edita  → [servidor] aplica tudo atomicamente
  → nota + próximo passo + dados do negócio + move etapa + marca reunião realizada
  → persiste transcrição/desfecho em voice_calls · invalida cache do card
```

Botão **"Reunião realizada"** (independente do áudio): no card do Kanban, gated ao board do Consultor → marca a CALL agendada como `completed=true` + `custom_fields.reuniao_realizada` → alimenta a métrica. O fluxo de áudio, ao confirmar, TAMBÉM marca realizada automaticamente (exceto desfecho `remarcar`/`nao_atendeu`).

## 3. Decisões de design

| # | Decisão | Escolha | Porquê |
|---|---|---|---|
| D1 | Canal de entrada | Microfone dentro do card | Zero ambiguidade de "qual lead"; cria o hábito de abrir o card (ref §1); sem número/bot novo. |
| D2 | Aplicar x revisar | **Card de revisão** (confirma antes) | Protege contra transcrição ruim (nome/valor); consultor já está no app. |
| D3 | Transcrição | **Servidor / Gemini** (`@google/genai`, já instalado) + guarda o áudio | Robusto no celular; guarda o áudio p/ a fase 3 "ouvir ligações"; sem dep nova. |
| D4 | Transcrever vs extrair | **2 passos** (transcreve → mostra texto → extrai estruturado) | Card mostra o texto cru = confiança + debug. Custo de token irrisório. |
| D5 | Onde grava o desfecho | Servidor, **1 rota atômica** (espelha o padrão no-show) | Evita 3 writes parciais do client; `custom_fields` é REPLACE (precisa spread seguro). |
| D6 | Persistência | Áudio → bucket **`deal-files`** (privado, signed URL); transcrição+desfecho → **`voice_calls`** (já existe, tem `deal_id`/`transcript`/`analysis` JSONB) | Reusa infra pronta; `voice_calls` é literalmente a tabela da fase "ouvir ligações". |
| D7 | Reunião realizada | Botão no card (par do No-show) + auto no confirm do áudio | Cobre com-áudio e sem-áudio; métrica consistente. |
| D8 | Métrica | Contagem de `activities` CALL/MEETING `completed=true` no período | Fonte de verdade única; a barra de meta hoje só vê deals. |

## 4. Arquitetura por componente (ancorado no código)

### 4.1 UI — microfone em destaque + card de revisão
- **Microfone como protagonista** (pedido da Thalita): o **composer de nota** da aba Timeline (o "Escreva uma nota… / Enviar" — hoje `handleAddNote`, `DealDetailModal.tsx:890-935`) é redesenhado pra deixar o **microfone em destaque** como ação primária, e é ali (no lugar da nota) que os **campos transcritos pela IA aparecem**. Digitar nota vira ação secundária. (Substitui o "Nenhuma atividade registrada" vazio por uma chamada pra gravar.)
- **Atalho no header** (`~L584`, ao lado de "Preparar"): botão `Mic` + o botão **"Reunião realizada"** (par de GANHO/PERDIDO) — pro consultor acionar sem rolar até a Timeline. Estado `showVoiceCapture` junto de `showBriefingDrawer` (~L171), resetado no `useEffect [isOpen, dealId]` (~L184).
- **Gravação no navegador**: extrair o fluxo `MediaRecorder` já pronto em `features/messaging/components/MessageInput.tsx:245-341` (getUserMedia → chunks → `File` no `onstop`). **Não** precisa converter webm→mp3 (o Gemini aceita ogg/webm e o bucket `deal-files` não restringe MIME) — dispensa `lamejs`.
- **Card de revisão**: espelha o layout do `QualificacaoSDRPanel.tsx`; renderizado **in-place** no lugar do composer (e/ou drawer perto do `<BriefingDrawer/>` ~L1307 pra valer em mobile e desktop). Gravar em `custom_fields.qualificacao` faz o painel exibir de graça.
- **Player**: reusar `components/ui/AudioPlayer.tsx` (compartilhado, hoje sem uso) com a signed URL.

### 4.2 Upload/armazenamento do áudio
- Reusar o padrão `lib/supabase/dealFiles.ts` (`uploadFile(dealId, file)` → bucket privado `deal-files`, path `{dealId}/voice/{uuid}.{ext}`, registro em `deal_files`, `getDownloadUrl` = signed URL 1h). **Não** reusar `/api/messaging/media/upload` (acoplado a `conversationId` + bucket público sem expiração — inadequado p/ áudio de call).
- O upload acontece **dentro da rota de transcrição** (§4.3): o client manda o Blob por multipart, o servidor sobe pro Storage E transcreve num passo só.

### 4.3 Transcrição (Gemini)
- Novo `lib/ai/call-outcome/transcribe.ts` espelhando `lib/ai/messaging/file-search.ts` (único uso de `@google/genai` no repo): `new GoogleGenAI({ apiKey })` + `models.generateContent({ model, contents: createUserContent([createPartFromBase64(audioB64, mimeType), 'Transcreva este áudio em português, verbatim.']) })`.
- `apiKey = aiConfig.structuredApiKey` (`ai_google_key`); `model = aiConfig.structuredModel` (`gemini-2.5-flash-lite`, suporta áudio). ~30s cabe **inline base64** (< 20MB).

### 4.4 Extração estruturada do desfecho
- Novo `lib/ai/call-outcome/schemas.ts` — `DesfechoSchema` (Zod v4), espelhando `niva-health.ts:21-52`:
  ```
  desfecho: enum(['fechou','vai_pensar','perdeu','remarcar','nao_atendeu'])
  nota_resumo: string
  tarefas: [{ descricao: string, data: string(ISO)|null }]   // TODAS as tarefas ditas no áudio → viram atividade na agenda
  dados_negocio: { operadora: string|null, vidas: int|null, valor: number|null }
  objecoes: MotivoTag[]                // objeções ouvidas na call (enum unificado §4.9)
  motivo_perda: MotivoTag | null       // só quando desfecho='perdeu'
  motivo_perda_detalhe: string | null
  reabordar_em: string(ISO) | null     // só 'perdeu' — data sugerida de reabordagem (§6.1), editável
  confidence: number (0..1)
  ```
  Todo campo com `.describe()` (a descrição É o prompt).
- Novo `lib/ai/call-outcome/call-outcome.service.ts` espelhando `lib/ai/extraction/extraction.service.ts:108-124`: `getModel('google', aiConfig.structuredApiKey ?? aiConfig.apiKey, aiConfig.structuredModel ?? aiConfig.model)` + `generateText({ model, output: Output.object({ schema: DesfechoSchema }), system, prompt: transcricao, maxRetries: 2 })`. **⚠️ Structured output SEMPRE no Gemini** (Anthropic rejeita min/max/int). Loga tokens em `ai_conversation_log` (`action_taken: 'call_outcome_extraction'`).
- Retorna `{ transcricao, desfecho, audioFilePath }` — **NÃO grava nada aqui** (gravação só após confirmação).

### 4.5 Rota de transcrição+extração (sem gravar)
- Novo `POST /api/deals/[dealId]/call-outcome/route.ts` espelhando `app/api/ai/board-config/generate-persona/route.ts`: `createClient()` → `auth.getUser()` → `profiles(organization_id)` → `getOrgAIConfig()` → sobe áudio (dealFiles) → `transcribe()` → `call-outcome.service`. `export const maxDuration = 60`. Aceita `multipart/form-data` (`audio` File). Guard: `structuredApiKey` vazio → 422 (org sem chave Google; na Niva existe).

### 4.6 Aplicação (confirmar → gravar) — rota atômica
- Novo `POST /api/deals/[dealId]/call-outcome/apply/route.ts` **carimba `enviado_em = now()` no servidor** (data/hora em que o consultor mandou o áudio) e executa, com spread seguro de `custom_fields` (REPLACE total) e tratando 23505/`check_deal_duplicate`:
  1. **Nota-resumo** → `activities` `type:'NOTE'`, `completed:true`, `date = enviado_em`, `description = nota_resumo`.
  2. **Tarefas** (TODAS as ditas no áudio) → uma `activity` `type:'TASK'` por item (⚠️ nunca `CALL` — evita o índice único `(owner_id,date) WHERE type='CALL'`), `date = tarefa.data ?? enviado_em`, `completed:false`, `owner_id` = consultor. **Toda tarefa transcrita vai pro calendário.**
  3. **Dados do negócio** → merge conservador em `custom_fields.qualificacao.{operadora,vidas,valor_pago_exato}` (só "meaningful"); `deals.value = valor` só se `>0` **e só no `fechou`** (não mexe na "mensalidade na mesa" da Ana).
  4. **Diagnóstico** → grava `custom_fields.objecoes` (enum §4.9); no `perdeu`, `custom_fields.motivo_perda` + `deals.loss_reason` (detalhe).
  5. **Roteamento por desfecho (§6)** — move board/stage server-side (padrão do no-show, service role, spread de `custom_fields`):
     - `fechou` → `is_won=true`, `closed_at=enviado_em`, move p/ **Implantação — ADM / Aguardando Documentação** (`851c641a` / `53589d9d`).
     - `perdeu` → `is_lost=true`, move p/ **Nutrição — Reativação / Recontato Agendado** (`4fb31290` / `2ee5e57e`) **+ cria lembrete de reabordagem** (`activity` `type:'TASK'`, `date = reabordar_em`, §6.1).
     - `vai_pensar` → move p/ **Negociação** `86179ae9` (fica no Consultor).
     - `remarcar` / `nao_atendeu` → não move (só nota/tarefa).
  6. **Reunião realizada** → marca a CALL agendada `completed:true` + `custom_fields.reuniao_realizada={realizada:true, at:enviado_em, by}` (exceto `remarcar`/`nao_atendeu`).
  7. **Persistir** → `voice_calls` (`mode:'human_call'`, `started_at`/`created_at`=`enviado_em`, `transcript`, `analysis=desfecho`, `deal_id`, `metadata.audio_path`).
- Client invalida `DEALS_VIEW_KEY` + `queryKeys.activities.all`.

### 4.7 Botão "Reunião realizada" (par do No-show)
- Rota nova `POST /api/deals/[dealId]/meeting-held/route.ts` — molde `app/api/deals/[dealId]/no-show/route.ts`: auth via RLS, idempotência via `custom_fields.reuniao_realizada`, marca a CALL de `custom_fields.reuniao_agendada.activity_id` como `completed:true` (ler o `activity_id` no **servidor**, do próprio deal). Se não houver `activity_id` (lead sem agendamento da Ana) → cria uma `activity` `type:'MEETING'` `completed:true` (não colide com o índice de CALL). **Não move de board** (diferente do no-show; é fechamento positivo, sem mensagem de resgate).
- Hook novo `lib/query/hooks/useMarkMeetingHeld.ts` (clone de `useMarkNoShow.ts`) → invalida `DEALS_VIEW_KEY` + `activities.all`. Exportar no barrel de hooks.
- Card: `features/boards/components/Kanban/DealCard.tsx` — prop `onMarkMeetingHeld?`, estado/handler espelhando `handleMarkNoShow` (L142-161, `window.confirm` + trava de duplo-clique + `stopPropagation`), `<button>` verde/emerald (ícone `CalendarCheck`/`CheckCircle2`) ao lado do No-show (L438-450).
- Fiação: `features/boards/components/Kanban/KanbanBoard.tsx` — `useMarkMeetingHeld()`, `handleMarkMeetingHeld` (~L211), e `onMarkMeetingHeld={boardId === CONSULTOR_BOARD_ID ? handleMarkMeetingHeld : undefined}` (~L356). **Mesmo gating do No-show.**
- **Também no header do card aberto** (`DealDetailModal` ~L584, par de GANHO/PERDIDO) via a mesma mutation — pro consultor marcar sem voltar pro Kanban.

### 4.8 Métricas & relatórios (capturar tudo agora, relatório em fase F6)

**Princípio (decisão da Thalita):** capturar TODOS os campos estruturados agora; a tela de relatório vem em fase. A maioria das métricas é **derivável** de timestamps/valores que já existem — o único trabalho de captura *nova* é estruturar objeções e motivos de perda em enum (§4.9).

| Grupo | Métricas | Fonte | Captura nova? |
|---|---|---|---|
| **A. Volume** | leads recebidos, qualificados vs fora_icp, agendadas, **realizadas**, vendas | `deals` por stage + `activities` (CALL agendada / completed) | só `reuniao_realizada` (esta feature) |
| **B. Conversão** | lead→agend., agend.→**realizada** (show rate), realizada→venda (close rate), lead→venda | derivável de A | não |
| **C. Diagnóstico** | **motivos de perda**, **objeções** (top N, por tier/operadora), distribuição de tier | `custom_fields.motivo_perda` + `.objecoes` (enum §4.9) + `.tier` | ✅ **estruturar em enum** (Ana + consultor) |
| **D. Receita** | valor na mesa (pipeline), ticket/prêmio médio, receita fechada, **vidas fechadas** | `deals.value` + `custom_fields.qualificacao.vidas` (soma nos `is_won`) | não |
| **E. Tempo** | SLA 1º toque, ciclo lead→fechamento, tempo em etapa, **cards parados** | `created_at`, `last_stage_change_date`, `activities.date`, `closed_at`, última atividade | não (calcula no relatório) |
| **F. Atribuição** | por criativo/campanha, por consultor (`owner_id`), por tier | `custom_fields.lead_form`/origem + `owner_id` | ⚠️ **depende do intake** enviar campanha/criativo (Make do Lobato — já no backlog); captura o que chega e melhora depois |

- **Fonte da métrica de reuniões**: `activities` `type IN ('CALL','MEETING') AND completed=true AND deleted_at IS NULL`, no período; escopo por `owner_id` (consultor) ou por deals do board.
- **Superfície agora (F5)**: seção "Reuniões" no `features/dashboard/DashboardPage.tsx` (Agendadas / Realizadas / No-show), espelhando `MessagingMetricsSection`. Client-side (`useActivities()` + `getDateRange`) dado o volume da Niva.
- **Relatório completo (F6, fase)**: RPC agregada `get_funnel_report(p_org_id, p_start, p_end, p_user_id)` (molde `get_messaging_metrics`, `messaging_metrics_columns.sql:75-80`) devolvendo os grupos A–F em JSONB; seção de relatório com filtro período/consultor e **export CSV** ("relatório quando requerido"). A captura dos §4.9 agora garante que esse relatório seja possível sem retrofit.

### 4.9 Taxonomia unificada de objeções e motivos de perda
- Novo módulo `lib/ai/taxonomy/motivos.ts` (enum + rótulos pt-BR), usado por **ambos** os extractors (a Ana na qualificação e o consultor na call) → o relatório agrega o funil inteiro.
  - **`MotivoTag`** (objeção/perda): `sem_oportunidade` (lead sem fit/budget real) · `ficou_na_atual` (inércia/medo de trocar) · `carencia` · `rede` (hospital/médico fora) · `concorrente` · `fora_icp` (sem CNPJ/inelegível) · `sem_resposta` (sumiu) · `timing` (adiou) · `reembolso` · `confianca` · `decisor` (precisa consultar sócio/cônjuge) · `burocracia` · `outro`.
- **Captura**:
  - Ana (`lib/ai/extraction/domain/niva-health.ts`): `objecoes` passa de `string[]` para `MotivoTag[]` (+ detalhe livre opcional). Merge conservador acumulando (como hoje).
  - Consultor (`DesfechoSchema` §4.4): `objecoes: MotivoTag[]` + `motivo_perda: MotivoTag` (quando `perdeu`) + `motivo_perda_detalhe`.
- **Gravação**: `custom_fields.motivo_perda = { categoria: MotivoTag, detalhe }` **e** `deals.loss_reason = detalhe||rótulo` (mantém a UI atual de perda funcionando). `custom_fields.objecoes` = lista de `{ categoria, detalhe, origem: 'ana'|'consultor' }`.

## 5. Modelo de dados (deltas)

- `deals.custom_fields.reuniao_realizada = { realizada:true, at:ISO, by:userId }` (novo — espelha `no_show`).
- `deals.custom_fields.motivo_perda = { categoria:MotivoTag, detalhe }` (novo, §4.9) + `deals.loss_reason` (existente, recebe o detalhe/rótulo).
- `deals.custom_fields.objecoes = [{ categoria:MotivoTag, detalhe, origem:'ana'|'consultor' }]` (muda de `string[]` p/ estruturado — §4.9; a Ana passa a gravar assim também).
- `deals.custom_fields.qualificacao.{operadora,vidas,valor_pago_exato}` (existente — merge conservador).
- `deals.value` (existente — só grava se `>0`).
- `activities`: 1 `NOTE` (resumo, `completed`, `date=enviado_em`), 0-N `TASK` (cada tarefa do áudio, c/ data → calendário), a `CALL` agendada vira `completed:true`; no `perdeu`, +1 `TASK` de reabordagem (`date=reabordar_em`).
- `voice_calls` (existente): 1 registro por call (`transcript`, `analysis`, `metadata.audio_path`).
- `deal_files` (existente): 1 registro do áudio (bucket `deal-files`).
- **Sem tabela nova.** (Evitar `deal_activities` type novo p/ não mexer no `deal_activities_type_check`.)

## 6. Mapeamento desfecho → ação/etapa/board

**IDs de destino** (adicionar em `lib/config/boards.ts`):
- **Implantação — ADM**: board `851c641a-ac99-404e-83d7-9712425b5fdf`, etapa entrada "Aguardando Documentação" `53589d9d-d0a5-4f62-8cda-20c89828a2b3`.
- **Nutrição — Reativação**: board `4fb31290-2ab4-46ac-83b1-555fbd4908cc`, etapa "Recontato Agendado" `2ee5e57e-e616-45e0-8e46-34741f64ef14`.

| desfecho | destino | flags | realizada? | efeito extra |
|---|---|---|---|---|
| `fechou` | **Implantação — ADM / Aguardando Documentação** | `is_won` + `closed_at` | ✅ | tarefas do áudio (docs/assinatura) → agenda |
| `perdeu` | **Nutrição — Reativação / Recontato Agendado** | `is_lost` + `loss_reason` + `motivo_perda` | ✅ | **lembrete de reabordagem** (data = `reabordar_em`, §6.1) |
| `vai_pensar` | **Negociação** `86179ae9` (fica no Consultor) | — | ✅ | tarefa de follow-up c/ data |
| `remarcar` | fica na etapa atual | — | ❌ | tarefa de remarcação |
| `nao_atendeu` | fica (sugere botão No-show) | — | ❌ | — |

> ✅ **`is_won`/`is_lost` são setados NO DESFECHO** (na hora que o consultor marca `fechou`/`perdeu`) — registra a venda/perda pra métrica no momento certo, independente da etapa do board de destino. Fechou → `is_won` + migra pra Implantação (ADM assume o onboarding). Perdeu → `is_lost` + motivo + migra pra Nutrição (ao reativar, vira `reativado` lá).

### 6.1 Reabordagem por motivo de perda (default; a IA sugere `reabordar_em` pela conversa real, editável)
| motivo | reabordar em (fallback) |
|---|---|
| `sem_oportunidade` | +6 meses |
| `ficou_na_atual` | vencimento da apólice (se souber) · senão +11 meses |
| `carencia` | +3 meses (gancho: transferência de carências) |
| `rede` | +6 meses |
| `concorrente` | +12 meses (perto da renovação do concorrente) |
| `timing` | +1 mês (ele mesmo adiou) |
| `reembolso` | +6 meses |
| `confianca` | +2 meses |
| `decisor` | +2 semanas (só falta o sócio/cônjuge) |
| `burocracia` | +1 mês |
| `sem_resposta` | +1 mês |
| `outro` | +3 meses |

> ✅ **Fallback confirmado.** A IA **SEMPRE prioriza o sinal da conversa real** sobre o fallback — em especial **quando o lead poderá reavaliar**: ex. "acabei de fechar com a concorrente" → reabordar perto do **vencimento do contrato dele** (não o default de 12m); vencimento de apólice conhecido → usa a data. O prompt de extração de `reabordar_em` deve caçar esses sinais de timing (vencimento, "faz X meses que troquei", "me chama em março").

## 7. Gotchas críticos (do mapeamento — obrigatórios no plano)

1. **`custom_fields` é REPLACE total** no UPDATE — SEMPRE spread do existente (senão apaga `qualificacao`/`tier`/`lead_form`/`reuniao_agendada`).
2. **Structured output só no Gemini** (`getModel('google', structuredApiKey...)`) — Anthropic rejeita min/max/int.
3. **Índice único** `activities (owner_id,date) WHERE type='CALL'` — próximo passo = `TASK`, fallback de realizada = `MEETING`; nunca criar `CALL` avulsa.
4. **MediaRecorder grava `audio/webm;opus`** — fora dos MIMEs do bucket `messaging-media`, mas `deal-files` não restringe; Gemini aceita webm/ogg → sem conversão mp3.
5. **`@google/genai` já instalado** (`^1.49.0`) — transcrição não adiciona dependência. Deploy Vercel usa **PNPM** (atualizar lock só se adicionar dep).
6. **Barrel `@/lib/supabase`** resolve pro FILE `lib/supabase.ts` (shadow) — exportar serviço novo no arquivo certo senão quebra o build.
7. **`maxDuration = 60`** na rota de transcrição (Vercel default 30 pode estourar).
8. **`voice_calls` tem FORCE RLS** — writes de servidor usam service role (há policy de bypass).
9. **Deal pode chegar ao board Consultor sem `reuniao_agendada.activity_id`** (indicação/orgânico) — tratar `activity_id` nulo (fallback MEETING completed).
10. **`gemini-2.0-*` aposentado** — usar 2.5 (flash-lite/flash/pro). Se a IA calar, checar o modelo.

## 8. Ordem de construção (fases — tudo em escopo)

- **F1 — Cano de voz**: gravação no card → upload `deal-files` → rota `call-outcome` (transcrição Gemini) → card de revisão exibindo transcrição. (sem gravar ainda)
- **F2 — Taxonomia + extração + aplicar**: módulo `lib/ai/taxonomy/motivos.ts` (§4.9) → `DesfechoSchema` (com `objecoes`/`motivo_perda`) + service → card de revisão editável → rota `apply` (nota + tarefas→agenda + dados negócio + `objecoes`/`motivo_perda` + `enviado_em` + `voice_calls`). Estruturar `objecoes` da Ana (`niva-health.ts`) usando o mesmo módulo. *Captura de diagnóstico já habilitada aqui.*
- **F3 — Roteamento por desfecho**: no apply, move board/stage por `desfecho` (mapa §6) via `moveStageByDealId` — `fechou`→Implantação, `perdeu`→Nutrição + lembrete de reabordagem, `vai_pensar`→Negociação.
- **F4 — Reunião realizada**: rota `meeting-held` + hook + botão no card (par do No-show) + auto-marca no apply.
- **F5 — Métrica**: seção "Reuniões" no dashboard (Agendadas/Realizadas/No-show).
- **F6 — Relatório do funil** (fase): RPC `get_funnel_report` (grupos A–F §4.8) + tela com filtro período/consultor + export CSV. Depende só da captura já feita nas fases anteriores.

## 9. Testes

- **Unit** (`test/`): `DesfechoSchema` valida/rejeita; mapa desfecho→etapa (função pura, como `classifyTier`); merge conservador de `custom_fields` (não apaga campos existentes); idempotência de `meeting-held`/`apply`.
- **Rota**: `call-outcome/apply` grava nota + task + value + move etapa (mock supabase) e é idempotente; `meeting-held` marca a CALL certa e trata `activity_id` nulo.
- **Guard**: `structuredApiKey` vazio → 422; 23505 → 409.
- Rodar `tsc` + `lint` + suíte (falhas pré-existentes de ambiente não contam).
- Smoke manual: gravar 30s no card de teste da Thalita (`+5511910312432`), confirmar, ver card + timeline + métrica.

## 10. Fora de escopo (YAGNI)

- Gravar/ouvir a ligação inteira em tempo real (fase 3 futura — mas `voice_calls`/`deal-files` já deixam a base pronta).
- Cadência/cron de cobrança de desfecho ("Digest da manhã").
- 1-call combinada (áudio→estruturado num request) — fica como otimização futura; F1/F2 usam 2 passos por transparência.
- Endurecer a RLS fraca de `deal_files` (`USING(true)`) — anotar como dívida, não bloquear a feature.

## 11. Decisões (resolvidas na revisão) + o que ainda confirmar

**✅ Resolvidas:**
- **Desfecho→board (§6)**: `fechou`→Ganho + move p/ **Implantação — ADM / Aguardando Documentação**; `perdeu`→Perdido + move p/ **Nutrição / Recontato Agendado** + lembrete de reabordagem; `vai_pensar`→Negociação; `remarcar`/`nao_atendeu` não movem.
- **`valor`**: atualiza `deals.value` só no `fechou`.
- **Métricas**: capturar todos os grupos A–F agora; relatório na F6; taxonomia unificada (§4.9).
- **"Reunião realizada"**: no card do Kanban **e** atalho no header do card aberto.
- **Taxonomia**: `preco` → **`sem_oportunidade`**; resto do enum §4.9 mantido.
- **Toda tarefa transcrita** vira atividade na agenda; **data/hora do envio do áudio** (`enviado_em`) é carimbada em tudo.

**✅ Também resolvidas (2ª rodada):**
- **Reabordagem (§6.1)**: fallback confirmado; a IA sempre prioriza o sinal da conversa (vencimento do contrato/apólice) sobre o default.
- **`is_won`/`is_lost`**: setados **no desfecho** (registram venda/perda na hora), independente da etapa do board de destino.
- **Entrada na Nutrição**: **"Recontato Agendado"** (`2ee5e57e`) — todo perdido aqui tem lembrete com data; "Aguardando Reabertura" fica só p/ o pool passivo sem data (base fria).

**Nada pendente — design 100% fechado. Próximo: writing-plans.**
