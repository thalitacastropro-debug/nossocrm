# Cadência 3 — Lembrete anti-no-show (Ana) + Cancelar reunião

> Design fechado com a Thalita em 2026-07-17. Antecessor: `2026-07-13-followup-cadencias-ana-design.md`
> (cadências 1 e 2, no ar desde 07-14, validadas ao vivo 07-15).
> Estratégia de produto: `niva-workspace/estrategia-follow-up-cadencias-ana.md`.
> Branch: `feat/lead-intake-route` (push = `git push origin feat/lead-intake-route:main`).

## 1. Objetivo

O lead marca a conversa com o consultor e some no dia. Hoje nada lembra ele — o resgate de
no-show (cadência 4) só age **depois** do prejuízo. Esta cadência ataca antes: dois toques na
voz da Ana, amarrados à hora da reunião.

Não-objetivo: substituir o resgate de no-show, mexer nas cadências 1/2, ou criar cron novo.

## 2. Decisões

| # | Decisão | Motivo |
|---|---------|--------|
| 1 | **2 toques**: véspera + ativação (T-30min). Sem T+0. | A Ana já confirma o horário na conversa ao marcar (`booker.ts:130` grava o label e ela responde). Um toque T+0 do cron seria ela repetindo sozinha o que acabou de dizer. |
| 2 | **Módulo novo**, cron existente | A cadência 3 diverge do B1 em seleção, matemática, parada e nos dois `if` que são a espinha do `run.ts`. Estender viraria `if (cadence === 'meeting')` espalhado num motor recém-validado ao vivo. |
| 3 | **Ignora `contact.ai_paused`** | A pausa existe pra Ana não CONVERSAR por cima do consultor. Lembrete de hora marcada é aviso operacional. Sem isso a feature só alcança lead que o consultor nunca tocou — o oposto do alvo. Apurado: `sendAIResponse` **não** checa pausa (a checagem vive em `processAIMessage`, `agent.service.ts:253-277`); o B1 faz a própria em `run.ts:98`. "Ignorar" = não copiar aquele `if`. |
| 4 | **Ignora `last_message_direction`** | No B1 o gatilho é *silêncio* (se o lead falou por último, não há o que resgatar). Aqui o gatilho é *hora marcada*. |
| 5 | **`activities` é a fonte da verdade**, não `custom_fields.reuniao_agendada` | Ver §3. Decisão mais importante do design. |
| 6 | **Copy fixa, sem IA** | Em 07-15 a IA alucinou `[estado/cidade]` e a persona disse "listinha" (`ana-tuning-log.md` #7/#8). O conteúdo aqui é um horário que já vem pronto do `slotLabelFromIso`. Zero upside em improvisar; a cadência 3 nasce com custo zero de IA. |
| 7 | **Botão "Cancelar reunião" entra no escopo** | Ver §7. Sem ele a cadência 3 não deve ir pro ar. |

## 3. A virada: `activities` como fonte da verdade

O design original ancorava em `deals.custom_fields.reuniao_agendada` e afirmava que
`data_hora >= agora` cobria sozinho os critérios de parada. **A revisão adversarial derrubou essa
premissa e o banco de produção confirmou.** O JSON é escrito por um caminho só (`booker.ts:123`)
mas lido como se fosse verdade universal, e na prática:

- **`status` é terminal.** `'cancelada'` é escrito em **um único lugar do repositório inteiro**
  (`booker.ts:176`, dentro de `cancelMeeting`), com **um único chamador**
  (`scheduling.service.ts:76`), que morre no early-return quando o board não é o da Ana
  (`config.ts:26-29`). Prova em produção: a reunião da Clara (15/07 13h) segue `confirmada` dois
  dias depois de ter passado.
- **O schema diverge.** O card da Josiane, agendado por SQL na mão (handoff 07-13), tem
  `{status: "confirmed", datetime: "...", booked_by: "thalita_manual"}` — `datetime` em vez de
  `data_hora`, `"confirmed"` em vez de `"confirmada"`, sem `criada_em`. A query original a
  excluiria por dois motivos independentes.
- **Nada sincroniza o JSON com o calendário.** A página de Atividades deixa o consultor editar a
  data (`useActivitiesController.ts:181-189`) ou deletar a ligação — e o delete é **físico**
  (`activities.ts:250`, sem `deleted_at`). Nenhum dos dois escreve em `custom_fields`.

A `activities` tem tudo que o design precisa, como coluna tipada, e o booker cria **uma activity
nova a cada marcação** — então cada linha é por-reunião por construção:

| Necessidade | JSON | `activities` |
|---|---|---|
| hora da reunião | `data_hora` \| `datetime` (string; schema divergente) | **`date`** `timestamptz NOT NULL` |
| quando foi marcada | `criada_em` (ausente na Josiane) | **`created_at`** |
| cancelada? | `status` (terminal) | **`deleted_at`** |
| realizada? | `reuniao_realizada` (congela, ver §9) | **`completed`** |
| consultor | ler owner do deal | **`owner_id`** |

Ancorar aqui **dissolve** três achados em vez de remendá-los: atividade deletada some da query;
`completed=true` (botão de reunião realizada **ou** áudio→CRM) exclui; data editada na mão passa
a ser a verdade — o lembrete usa a data certa sozinho, sem detecção de divergência. E a Josiane
volta a receber lembrete, apesar do JSON torto, porque a activity dela está correta
(`17dfae58`, `2026-07-22 14:00+00`, aberta).

## 4. Matemática dos toques

Funções **puras** de `(date, created_at, agora)`, no espírito do `schedule.ts` — sem I/O.

| Toque | Abre (`due`) | Expira | Copy |
|---|---|---|---|
| **Véspera** | 17h00 SP do último dia útil antes da reunião | 17h30 SP no mesmo dia | "sua conversa com o {consultor} é {label}" |
| **Ativação** | `date - 30min` | `date` (T-0) | "o {consultor} já vai te ligar, deixa o telefone à mão" |

Envia se **todas** valerem:

1. `due <= agora <= expira`
2. `due >= created_at + GAP` — onde `GAP = 3h` para a véspera e `0` para a ativação
3. o toque ainda não foi enviado (estado, §6)

### 4.1 Por que a condição 2 (o gap)

`minLeadMinutes: 120` + último slot às 17h (`config.ts:14-16`) ⇒ **toda marcação feita depois das
15h00 SP cai obrigatoriamente no próximo dia útil** (verificado numericamente: às 15h00 ainda
oferta hoje 17h; às 15h01 pula pra amanhã 9h). Sem gap, o lead que marca às 16h54 recebe
"confirmando sua conversa de amanhã" no tick das 17h00 — **6 minutos depois de combinar
exatamente isso no mesmo chat**. Não é borda: é faixa determinística, todo dia útil. Os ticks das
17h00, 17h15 e 17h30 caem todos dentro da janela, então não é uma chance de errar, são três.

`GAP = 3h` põe a fronteira às 14h00 SP. Quem marca entre 14h e 15h perde a véspera e fica só com
a ativação — custo aceitável. O invariante real que a constante aproxima: **não lembrar de um
horário que acabou de ser combinado na mesma sessão de conversa.** Precedente no repo:
`schedule.ts:60-68` (o `gapDueMs` anti-rajada do B1).

### 4.2 Por que a condição 1 (expira)

Cobre cron parado. Se o motor cair das 9h às 10h30, a ativação de uma reunião das 10h **não**
dispara às 10h35 dizendo "já vai te ligar" de uma ligação que já aconteceu — morre.

**"Queimado" não é estado, é cálculo.** As três condições derivam tudo a cada tick; nada de
`burned` persistido.

### 4.3 Último dia útil

`ultimoDiaUtilAntes(date)`: recua 1 dia em SP; enquanto cair em sábado/domingo, recua mais 1;
crava 17h00 SP. Reunião de segunda 9h ⇒ véspera na sexta 17h. Funciona porque a copy usa
`slotLabelFromIso` (data **absoluta**: "segunda, 20/07, às 9h", nunca "amanhã") — o texto
continua verdadeiro 3 dias antes. A ativação não é afetada: continua 30min antes, sempre entre
8h30 e 16h30, dentro do gate.

**Limitação conhecida (aceita):** feriado não existe em lugar nenhum do sistema — nem no
`getAvailableSlots` (que oferta 07/09 às 9h), nem no gate do cron (`daysOfWeek [1..5]`). Bug
pré-existente do agendamento, não introduzido aqui. Registrado no roadmap.

## 5. Seleção

```sql
FROM activities a JOIN deals d ON d.id = a.deal_id
WHERE a.type = 'CALL'
  AND a.deleted_at IS NULL
  AND a.completed = false
  AND a.date >= now() AND a.date <= now() + interval '4 days'
  AND d.deleted_at IS NULL AND d.is_won = false AND d.is_lost = false
```

Sem filtro de board/etapa: o card pode estar em "Agendado ✓" (onde estão hoje) ou no Comercial
(caso Josiane). O horizonte de 4 dias cobre a véspera mais distante (reunião segunda 17h ⇒ due
sexta 17h = 3 dias) com margem. Índice existente que serve: `uniq_consultant_call_slot` em
`(owner_id, date) WHERE type='CALL' AND deleted_at IS NULL`.

**Guard do no-show** (o único que a `activities` não resolve — a rota de no-show **não toca na
activity**, só grava `no_show_at` no JSON e move o board). **Em JS, no módulo — não na query**:
o `custom_fields` já vem carregado, e comparar `text` (`->>`) com `timestamptz` em SQL exige cast
explícito e é fácil de errar em silêncio.

```ts
const noShowAt  = Date.parse(String(cf.no_show_at ?? ''));
const criadaEm  = Date.parse(act.created_at);
if (Number.isFinite(noShowAt) && Number.isFinite(criadaEm) && noShowAt > criadaEm) return; // pula os 2 toques
```

Comparação com `created_at`, **nunca** `no_show === true` flat: ninguém limpa `no_show` em lugar
nenhum, então o check flat mataria permanentemente o lembrete de todo lead que deu no-show e
remarcou — exatamente o público que a cadência 4 despeja aqui. Como o booker cria activity nova
na remarcação, `created_at` renova e o lembrete se reabilita sozinho. `no_show_at` ausente
(legado) ⇒ não pula.

Sem risco de escrita concorrente com o B1: `run.ts:41` filtra `stage_id IN (novo-lead,
em-qualificação)` e todo deal com reunião está em `agendado` ou fora da board da Ana — os
conjuntos são disjuntos.

## 6. Estado

`deals.custom_fields.meeting_reminder`:

```ts
{ activity_id: string, date: string, vespera_sent_at?: string, ativacao_sent_at?: string }
```

Se `activity_id` **ou** `date` divergirem da activity atual ⇒ reunião diferente ⇒ estado
descartado e toques recomeçam. Cobre os dois caminhos: remarcação pelo booker (activity nova) e
edição manual da data (mesma activity, `date` novo).

**Persiste ANTES de enviar** (lição do B1). Se a função morrer entre gravar e mandar, o lead
perde um lembrete; na ordem inversa, levaria o mesmo lembrete a cada 15 minutos. Em canal com
risco de ban, errar para o lado do silêncio. Envio falhou ⇒ reverte best-effort e conta `failed`.
Persist falhou ⇒ não envia.

`custom_fields` é **REPLACE total** no update ⇒ sempre spread do existente.

## 7. Cancelar reunião (pré-requisito de entrega)

**Não existe hoje nenhuma forma de cancelar uma reunião neste CRM.** `cancelMeeting` está escrito
e correto (soft-delete da activity + `status='cancelada'`), mas é inalcançável fora do board da
Ana; o intent `'cancel'` existe e está testado (`detect.ts:14`) e é código morto naquele board.
Hoje isso é inofensivo porque ninguém afirma nada. Com a cadência 3 no ar vira: lead cancela na
quinta 16h ⇒ sexta 8h30 a Ana manda "sua conversa é hoje às 9h, deixa o telefone à mão". E como a
decisão 3 bypassa `ai_paused`, não sobra nem kill switch.

1. **Rota `POST /api/deals/[dealId]/cancel-meeting`** no molde exato de
   `app/api/deals/[dealId]/no-show/route.ts` (auth + gate de org, admin client, spread do
   `custom_fields`, idempotente). Chama `cancelMeeting({ supabase, dealId, activityId })` lendo o
   `activity_id` do JSON; se o JSON não tiver (caso legado), resolve pela activity `CALL` aberta
   do deal. Não move board, não marca perdido.
2. **Botão "Cancelar reunião"** no card, gated como os vizinhos
   (`KanbanBoard.tsx:374-375`, `DealDetailModal.tsx:589`).
3. Efeito na cadência 3: sai da query por `deleted_at` — de graça, sem regra nova.

**Fora de escopo (registrar):** destravar o `cancel` da própria Ana (extrair o ramo de
cancelamento pra antes do gate de config em `scheduling.service.ts:45-48`).

## 8. Copy

Bolhas curtas, sem emoji, sem travessão, "consultor" nunca "vendedor". Nome do consultor:
`activities.owner_id` → `profiles.name` → `firstName()` (o helper de `copy.ts:45`, já testado).
Fallback `"o consultor"` se `owner_id` for nulo. Não cravar "Denilson" em código.
(Nota: usar `profiles.name`, **não** `profiles.first_name` — essa coluna está populada com o nome
inteiro em produção.)

**`renderBubbles` NÃO serve.** Ela só faz `replaceAll('{nome}')` (`copy.ts:50-58`); a assinatura
nem recebe outras variáveis. Seguir o design original ao pé da letra entregaria
`"Maria, sua conversa com o consultor é {label}."` literal no WhatsApp — e isso **compila limpo**
(`tsconfig` com `strict: false`, `no-unused-vars` desligado em `eslint.config.mjs:47`), num toque
que só executa de verdade às 17h da véspera de uma reunião real. A primeira execução natural seria
em produção, num lead.

⇒ `renderReminder(bubbles, vars)` **local** ao módulo: `replaceAll` de cada chave de `vars`, mesma
limpeza do B1 (`\s{2,}`, pontuação órfã, `trim`), `filter(Boolean)`, join `'\n\n'`. Vars:
`{ nome, label, consultor }`. **Não** mexer em `renderBubbles` nem nos callers do B1 — módulo
recém-validado ao vivo, refatorar por zero benefício é a troca errada. Reusar `firstName`.

## 9. Riscos aceitos

- **`reuniao_realizada.at` congela.** `meeting-held/route.ts:40-41` early-returna em
  `already?.realizada` e `apply/route.ts:86` só grava `if (!existingCf.reuniao_realizada)`. Não
  afeta este design (que lê `activities.completed`, não o JSON), mas registrar: o carimbo trava na
  1ª call e nunca refresca.
- **Feriados** (§4.3).
- **Lembrete atravessando conversa do consultor** — consequência aceita da decisão 3.
- **Split-brain de cópia**: `boards.next_board_id` do board da Ana aponta pro Comercial, e
  `useMoveDeal.ts:178-213` cria **cópia** com `custom_fields` spreadado. Verificado no banco em
  17/07: **zero** activity_id com mais de um card — não se materializou. Se aparecer, dedupe por
  `activity_id` no tick. (Como a fonte agora é `activities`, a query já é naturalmente
  1-linha-por-reunião; o join é que poderia multiplicar.)

## 10. Testes

Puros (o grosso), tabela:
- `created_at = due - 1min` ⇒ queima · `due - 2h59` ⇒ queima · `due - 3h01` ⇒ envia
- marcou 8h p/ reunião 10h hoje ⇒ véspera queima (regressão do exemplo do design)
- `created_at = due + 20min` (marcou depois da janela abrir) ⇒ queima
- gap **não** se aplica à ativação
- cron parado 1h ⇒ ativação expirada não dispara
- reunião segunda 9h ⇒ véspera sexta 17h
- `date` mudou / `activity_id` mudou ⇒ estado reseta

Orquestrador (deps injetadas, molde do `run.ts`):
- activity `completed=true` ⇒ não seleciona · `deleted_at` ⇒ não seleciona
- `no_show_at > created_at` ⇒ pula · `no_show_at < created_at` (remarcou) ⇒ envia
- persist falhou ⇒ não envia · envio falhou ⇒ reverte
- **placeholder**: para cada toque, a saída renderizada não casa `/\{/` (cobre `{nome}`,
  `{label}`, `{consultor}` de uma vez), incluindo os fallbacks (nome nulo, owner nulo)
- guard-rail: toda chave `{x}` presente na copy existe como key em `vars` — adicionar variável
  nova sem wire quebra o teste, não o lead

## 11. Arquivos

Novos: `lib/ai/followup/meeting-reminder.ts` (copy fixa + `renderReminder` **dentro** do módulo —
são 2 toques, não justifica arquivo próprio), `app/api/deals/[dealId]/cancel-meeting/route.ts`,
`test/followup/meeting-reminder.test.ts`.
Tocados: `app/api/cron/lead-followup/route.ts` (chama a 2ª função, soma o resultado no log),
`KanbanBoard.tsx` + `DealCard.tsx` + `DealDetailModal.tsx` (botão), hook `useCancelMeeting`.
**Não tocados:** `run.ts`, `schedule.ts`, `copy.ts`, `generate.ts`, migration/pg_cron/Vault.

## 12. Proveniência

Design revisado por workflow adversarial de 20 agentes (4 lentes independentes + cético por
achado): 15 achados, 8 refutados, **7 confirmados** — 2 HIGH (ausência de cancelamento;
critério de parada cego pra `activities`), 5 MEDIUM (véspera sem gap; "realizada" antecipada por
dois caminhos; `no_show` fora da query; `renderBubbles` sem `{label}`). Todos endereçados acima.
Achados 2, 4 e 5 foram **dissolvidos** pela virada da §3 em vez de remendados. Premissas checadas
contra o banco de produção (`nossocrmv2` = `htmgjcelsnldxjbygfcw`) em 2026-07-17.
