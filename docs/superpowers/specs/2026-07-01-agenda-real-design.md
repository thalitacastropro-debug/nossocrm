# Agenda real da Ana (SDR) — cravar horário de verdade

**Data:** 2026-07-01
**Branch:** `feat/lead-intake-route` (NÃO mergear na `main` — go-live acoplado ao cutover)
**Org:** Niva (`d9bf55f7-...`) · Board SDR `c2e36157` · Supabase `nossocrmv2` (`htmgjcelsnldxjbygfcw`)
**Depende de:** Cérebro da Ana (Partes 1–4, já no branch, em `observe`)

---

## 1. Objetivo

Hoje a Ana (SDR de IA) qualifica o lead e, no fim, **captura a preferência** de dia/turno pra
ligação do consultor (interino). Esta fase substitui o interino: a Ana passa a **cravar um
horário real** — lê a disponibilidade do consultor, oferece slots reais, e **cria a reunião**
no calendário do CRM quando o lead confirma. Ela nunca inventa horário e nunca dá um "fechado"
falso.

**Fora de escopo (próxima fase):** o lembrete **proativo** anti-no-show (a Ana iniciar contato
antes da ligação pra confirmar). Isso depende de um cron/agendamento e reusará a máquina de
remarcação desta fase. O que entra agora é só a reação a pedidos de mudança **dentro da conversa**.

## 2. Decisões (confirmadas com a Thalita, 2026-07-01)

- **Fonte de verdade = calendário INTERNO do CRM** (tabela `activities`). Sem Google Calendar,
  sem OAuth, sem sync externo. O consultor trabalha olhando o `ActivitiesCalendar` do CRM.
- **Consequência aceita:** a Ana só sabe que o consultor está ocupado se o compromisso estiver
  no CRM. Cabe ao consultor **bloquear seus horários ocupados no CRM** (mudança de hábito dele,
  não problema do sistema).
- **Abordagem = passo determinístico** (não function-calling). O código manda nos horários e na
  reserva; o LLM só conversa e detecta o aceite. Preserva o cérebro já validado em `generateText`.
- **Janela de atendimento:** seg–sex, 09:00–18:00 `America/São_Paulo`, **pulando 12:00–13:00** (almoço).
- **Slot = 40 min** (30 de conversa + 10 de folga), **início de hora em hora**.
- **Antecedência mínima = 2h**; **horizonte = próximos 5 dias úteis**.
- **Consultor = Denilson** (fixo por ora), configurável via `board_ai_config.consultant_user_id`
  (não hard-code).
- **Reserva ANTES da resposta** da Ana (confirmação sempre verdadeira).
- **Remarcação/cancelamento = tratados no v1** (a Ana cancela a antiga e marca a nova).
- **Regra de persona:** cancelamento **nunca** é ponto final — a Ana sempre puxa de volta pra um
  novo horário ou handoff explícito; nunca deixa solto no "vou precisar desmarcar".

## 3. Arquitetura (visão geral)

```
Lead (WhatsApp) → agent.service (respond)
  │
  ├─ [PRÉ-RESPOSTA] scheduling.detectAndBook()
  │     ├─ availability.getAvailableSlots()   ← janela − activities ocupadas
  │     ├─ detecção LLM: "lead aceitou algum slot? qual?"
  │     └─ booker: re-check slot livre → cria/cancela activity (só em respond)
  │           → grava deals.custom_fields.reuniao_agendada + tag + injeta status no contexto
  │
  ├─ context-builder.buildLeadContext()
  │     └─ injeta "## Horários disponíveis" + status da reunião (confirmada / slot encheu)
  │
  └─ generateText(persona + contexto) → resposta em bolhas
```

Módulos novos, isolados, em `lib/ai/scheduling/`:

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `availability.ts` | `getAvailableSlots({ now, busy, ...cfg }) → Slot[]` — **função pura** | nada (recebe `busy` já carregado) |
| `busy.ts` | Carrega as `activities` ocupadas do consultor no horizonte | Supabase |
| `booker.ts` | Reserva/cancela/remarca a `activity`; re-check + idempotência | Supabase |
| `detect.ts` | Extração LLM: aceite de horário / pedido de remarcação | `ai` (getModel) |
| `scheduling.service.ts` | Orquestra detect → book; devolve status pro contexto | os acima |

Gating: tudo só atua na **board da Niva** (mesmo padrão do `domain-extraction` — registry/config
por board). Zero impacto em outras orgs/boards.

## 4. Motor de disponibilidade — `availability.ts`

**Função pura** (testável sem banco). Entrada: `now` (injetável), lista de intervalos `busy`
(reuniões/bloqueios do consultor), e config (janela, almoço, slot, antecedência, horizonte, TZ).
Saída: lista ordenada de `Slot { startIso, endIso, label }`.

Regras:
1. Gera candidatos hora cheia por dia útil: **09, 10, 11, 13, 14, 15, 16, 17** (o 12 cai no almoço).
   Cada slot = `[start, start+40min)`.
2. Descarta candidatos que começam antes de `now + 2h` (antecedência) ou no passado.
3. Descarta candidatos cujo `[start, end)` **colide** com qualquer intervalo `busy` (colisão
   parcial conta).
4. Varre dias pra frente até cobrir **5 dias úteis**; retorna todos os livres (o `context-builder`
   injeta e a Ana oferece 2–3 por vez).
5. Timezone `America/São_Paulo`; `startIso` gravado como instante UTC (`timestamptz`).

`busy.ts`: `SELECT ... FROM activities WHERE owner_id = consultant AND organization_id = niva
AND deleted_at IS NULL AND date >= <início> AND date < <fim>` → converte cada uma em intervalo
`[date, date+40min)`. (Reuniões e bloqueios são ambos linhas de `activities`; o bloqueio é só uma
activity que o consultor cria no CRM pra marcar "ocupado".)

## 5. Oferta e escolha — `context-builder.ts` + persona

**Injeção no contexto** (`buildLeadContext` chama `getAvailableSlots` + `scheduling.service`):

```
## Horários disponíveis para a ligação do consultor
Ofereça SOMENTE estes horários. NUNCA invente outro. Ofereça 2–3 por vez, não a lista toda.
Se nenhum servir, diga que vai confirmar a melhor data com o consultor (não prometa fora da lista).
- quinta, 03/07, às 10h
- quinta, 03/07, às 14h
- sexta, 04/07, às 9h
...

## Status da reunião
<um de:>
- REUNIÃO JÁ CONFIRMADA para quinta, 03/07, às 10h — confirme pro lead com naturalidade;
  o consultor liga nesse horário.
- O horário pedido acabou de ser preenchido — peça desculpa e ofereça: <novos slots>.
- (sem status: ainda não há reunião marcada)
```

**Persona (`board_ai_config`) — ajustes de texto:**
- Oferecer horário só **depois de qualificar** (fim da etapa "em-qualificação", onde ela já propõe
  a ligação hoje). Não abrir a conversa jogando horário.
- Oferecer **somente** horários da lista; se nenhum servir, cair no fallback (não prometer fora).
- **Regra de remarcação:** se o lead quiser mudar/cancelar, sempre reconduzir a um novo horário ou
  handoff — nunca deixar solto.

## 6. Detecção + reserva — `detect.ts` + `booker.ts` (só em `respond`)

Roda **antes** de gerar a resposta, quando: deal na board da Niva **e** já houve oferta de horário
**e** (sem reunião marcada **ou** o lead está pedindo pra mudar). **Nunca roda em `observe`** (criar/
cancelar activity é ação, igual `is_lost`).

**`detect.ts`** (extração estruturada, `generateText` + `Output.object`, gemini-flash): lê a
conversa e retorna:
```ts
{
  intent: 'accept' | 'reschedule' | 'cancel' | 'none',
  slotIso: string | null,   // horário aceito/desejado, dentre os oferecidos
}
```

**`booker.ts`** (determinístico, Supabase):
- `accept`: valida `slotIso` bate com o grid **e** está livre agora (re-query `busy`).
  - Livre → `INSERT activities` (ver §7) + grava `reuniao_agendada` + tag `reuniao:agendada`.
    Devolve status `confirmada`.
  - Tomado/erro → **não marca**; devolve status `slot_encheu` (+ novos slots). Nunca confirma falso.
- `reschedule`: marca `deleted_at` na activity antiga (via `reuniao_agendada.activity_id`) e cria a
  nova (mesmo caminho do `accept`). Atualiza `reuniao_agendada`.
- `cancel`: marca `deleted_at` na antiga, seta `reuniao_agendada.status = 'cancelada'`, remove a tag.
  A persona reconduz (novo horário/handoff).
- **Idempotência:** se já há `reuniao_agendada.status = 'confirmada'` pro mesmo `slotIso`, no-op.

**Trava de corrida (banco):** índice único parcial pra impedir dois leads no mesmo slot:
```sql
CREATE UNIQUE INDEX uniq_consultant_call_slot
  ON public.activities (owner_id, date)
  WHERE type = 'CALL' AND deleted_at IS NULL;
```
Se o `INSERT` violar a unique → o booker trata como `slot_encheu` e re-oferece.

## 7. O que é gravado ao marcar

**`activities`** (nova linha):
- `type = 'CALL'` (ligação — o consultor liga; casa com o enum `'CALL'|'MEETING'|'EMAIL'|'TASK'`)
- `title = "Ligação diagnóstica — {nome do lead}"`
- `description` = resumo curto (tier + o essencial da qualificação)
- `date` = início do slot (`timestamptz`)
- `owner_id` = consultor (`board_ai_config.consultant_user_id`)
- `deal_id`, `contact_id`, `organization_id`, `participant_contact_ids = [contact_id]`

**`deals.custom_fields.reuniao_agendada`**:
```json
{ "data_hora": "2026-07-03T13:00:00Z", "activity_id": "...", "status": "confirmada", "criada_em": "..." }
```
+ tag `reuniao:agendada`. Alimenta o handoff (o ping no Telegram passa a incluir o horário) e o
futuro anti-no-show.

**Config nova:** `board_ai_config.consultant_user_id UUID` (nullable; se null → fallback interino,
sem marcar). Setado com o `profile_id` do Denilson na board da Niva.

## 8. Bordas e erros

| Situação | Comportamento |
|---|---|
| Sem horário livre em 5 dias úteis | Não inventa; contexto manda "confirmar data com o consultor" → interino (preferência + handoff) |
| Lead pede fora da janela (sábado, 20h) | Explica horário comercial, oferece o mais próximo; se insistir, captura preferência + sinaliza |
| Corrida (2 leads no mesmo slot) | Re-check + unique index → 2º vira `slot_encheu`, re-oferece |
| Falha de rede ao gravar | Booker retorna não-marcou → trata como `slot_encheu`; nunca confirma falso |
| Conversa atravessa dias (slot velho) | Disponibilidade recalculada por turno; slot passado/tomado não aparece; re-check pega no aceite |
| Lead quer remarcar/cancelar | v1 trata (§6); persona nunca deixa solto |
| `consultant_user_id` null | Sem marcação; cai no interino (preferência) — degrada com segurança |

## 9. Testes

**Unitários determinísticos (CI) — o núcleo à prova de bala:**
- `availability.ts`: `now` fixo; pula almoço/fim de semana; respeita 2h e horizonte 5 dias úteis;
  subtrai `busy` (inclusive colisão parcial); bordas (17h ok, 12h fora, slot que cruza 18h).
- `booker.ts` (Supabase mockado): valida slot ∈ grid + livre; idempotência; remarcação (cancela+cria);
  cancelamento; corrida (tomado → não marca); falha de banco → não marca.

**Validação ao vivo (LLM) em `observe`** — igual ao cérebro (gemini-2.5-flash real, script no
scratchpad, chave lida de `.secrets/credenciais.env`, nunca no chat): conversas de teste
("pode ser quinta 10h", "qualquer um serve", "não posso essa semana", "prefiro remarcar") → conferir
nos logs se `detect.ts` classificou certo. Em `observe` o booker **não** marca; valida-se injeção de
slots + detecção.

**Rollout:** `observe` (injeta slots + loga detecção, não marca) → validar → `respond` (marca de
verdade) → entra no go-live junto com o cutover do webhook. **Tudo no branch `feat/lead-intake-route`.**

## 10. Arquivos tocados

**Novos:** `lib/ai/scheduling/{availability,busy,booker,detect,scheduling.service}.ts` +
testes em `test/scheduling/`. Migration da unique index + coluna `consultant_user_id`.

**Editados:** `lib/ai/agent/context-builder.ts` (injeta slots + status), `lib/ai/agent/agent.service.ts`
(chama `scheduling.service` pré-resposta, só em respond), `board_ai_config` da Niva (persona +
`consultant_user_id`).
