# Design — Motor de follow-up da Ana (cadências 1 & 2)

> Spec de design. Status: **APROVADO pela Thalita (2026-07-13)** — seguir para writing-plans.
> Repo: `C:\Projetos\nossocrm`, branch `feat/lead-intake-route` (deploy = `git push origin feat/lead-intake-route:main`).
> Projeto Supabase: `nossocrmv2` (`htmgjcelsnldxjbygfcw`). Org: `d9bf55f7-c66d-439b-97b2-1fceff0fa9b2`.
> Estratégia-mãe: `niva-workspace/estrategia-follow-up-cadencias-ana.md`. Backlog: `niva-workspace/crm-roadmap.md` item **B1**.

## 1. Contexto & objetivo

A Ana (SDR IA) **não tem mecanismo de retomada**: se o lead para de responder, ele morre em silêncio (a Thalita viu isso com a Josiane). "O dinheiro está no follow-up." Este projeto entrega o **motor de cadências** que reengaja automaticamente:

- **Cadência 1 (FRIA):** lead recebeu o opener e **nunca respondeu**.
- **Cadência 2 (QUENTE):** lead **engajou e sumiu** no meio da qualificação.

Fora de escopo nesta leva (fast-follow, mesmo motor): **cadência 3** (lembrete anti-no-show antes da reunião). **Cadência 4** (resgate pós-no-show) **já está no ar** (`app/api/deals/[dealId]/no-show/route.ts`).

## 2. Escopo

**Entra:** classificador/agendador puro; endpoint batch `GET /api/cron/lead-followup` (reescrita do rascunho atual); motor de tempo `pg_cron`+`pg_net`; copy fria (roteiro fixo) e quente (IA + fallback); testes unitários; migration + runbook de deploy.

**Não entra:** cadência 3 (lembrete de reunião); UI de configuração de cadência; métricas/dashboard de follow-up (só logs e a tag `sem-resposta`); mudança na persona da Ana.

## 3. Decisões de produto (brainstorm 2026-07-13)

| Decisão | Escolha |
|---|---|
| Escopo | Cadências 1 + 2 + motor cron (cad. 3 = fast-follow) |
| Copy | **Híbrido**: fria = roteiro fixo (ângulos de valor); quente = IA lendo a conversa, com linha fixa de fallback |
| Agressividade | **Enxuto**: fria ~4 toques/10 dias; quente ~3 toques/7 dias |
| Toque quente 1 | **15 min** de silêncio |
| Frequência do cron | **15 min** (pg_cron; o endpoint é a autoridade do horário comercial) |
| Toque frio 2 | **NÃO** falar "não é cotação por WhatsApp"; reforçar que **o lead nos procurou porque tem um problema que a gente resolve** |

## 4. Arquitetura (3 peças, cada uma com um propósito só)

1. **Classificador/agendador** (`lib/ai/followup/schedule.ts`) — funções **puras**, zero I/O. Dado `{ cadence, anchorAt, count, now }` decide se há toque devido e qual. Testável isoladamente.
2. **Endpoint batch** (`app/api/cron/lead-followup/route.ts`) — busca elegíveis, aplica o classificador, renderiza a copy, envia via `sendAIResponse`, persiste estado. Protegido por `CRON_SECRET` + gate de horário comercial.
3. **Motor de tempo** (`supabase/migrations/<ts>_lead_followup_cron.sql`) — `pg_cron` chama o endpoint a cada 15 min via `pg_net` (`net.http_get` com `Bearer CRON_SECRET`).

Copy fica em módulos próprios: `lib/ai/followup/copy.ts` (fria fixa + fallback quente) e `lib/ai/followup/generate.ts` (quente por IA, irmão de `first-touch.ts`).

## 5. Detecção / elegibilidade

**IDs canônicos** (confirmados no banco em 2026-07-13):
- Board da Ana: `c2e36157-1b63-43cc-be35-bb1cab7a287f`.
- Stage `novo-lead`: `1e8026b1-88ef-4daa-bc06-fb12b2dceff7`.
- Stage `em-qualificacao`: `3128e500-7182-406a-a095-f7f7c5e772ac`.

**Passos (service-role admin client — ver §11):**
1. **Deals candidatos:** `board_id = ANA`, `stage_id IN (novo-lead, em-qualificacao)`, `is_won=false`, `is_lost=false`, `deleted_at IS NULL`, `contact_id IS NOT NULL`. Em código, descartar `custom_fields.followup.stopped === true`.
2. **Conversa (mais recente por contato):** `messaging_conversations` dos contatos candidatos com `last_message_direction = 'outbound'` (a última fala foi nossa). Selecionar `id, contact_id, first_response_at, last_message_at, last_message_direction, metadata, created_at`. Pular `metadata.ai_paused === true`.
3. **Contato:** `contacts.ai_paused` — pular quem o consultor assumiu.
4. **Reengajamento (batch):** para as conversas candidatas, `SELECT conversation_id, MAX(created_at) FROM messaging_messages WHERE direction='inbound' AND conversation_id IN (...) GROUP BY 1`. Usado no reset (§10).

**Discriminador fria vs quente = `messaging_conversations.first_response_at`:**
- `NULL` → **FRIA** (o lead nunca gerou uma "primeira resposta" — nunca respondeu).
- preenchido → **QUENTE** (o lead respondeu e a Ana respondeu de volta).

> Fundamento (trigger `calculate_first_response_time`, migration `20260208100000`): `first_response_at` só é setado num OUTBOUND quando já existe pelo menos um INBOUND na conversa. Entre os elegíveis (`last_message_direction='outbound'`), isso separa **fria** de **quente** de forma limpa.

> Auto-parada de graça (trigger de `last_message_*`, migration `20260205100000`): todo insert de mensagem atualiza `last_message_direction = NEW.direction`. Quando o lead responde, a conversa vira `inbound` e **sai da query do passo 2** — a cadência para sozinha, sem código extra.

## 6. Estado por deal (`custom_fields.followup`)

```jsonc
{
  "cadence": "cold" | "warm",
  "anchor_at": "2026-07-13T13:00:00.000Z", // ISO UTC, CONGELADO na 1ª detecção
  "count": 2,                               // toques já enviados (0 = nenhum)
  "last_sent_at": "2026-07-14T13:02:00.000Z",
  "stopped": false,
  "stopped_reason": null                    // "max_touches" | "reengaged" (quando reset)
}
```

`custom_fields` é **REPLACE total** no update → **todo writer faz spread** de `custom_fields` antes de gravar (mesma regra do booker/no-show/intake).

## 7. Âncoras & agendamento

**Âncora (congelada na 1ª detecção; nunca re-derivada de `last_message_at`, que o próprio toque atualiza):**
- **FRIA:** `custom_fields.lead_form.first_touch.sent_at` (o intake já carimba o opener — comentário no código: *"para o cron de follow-up"*). Fallback (leads que não passaram pelo intake): `conversation.last_message_at` no momento da detecção.
- **QUENTE:** `conversation.last_message_at` na detecção (nossa última resposta sem retorno = o momento em que ele ficou quieto).

**Schedules (offsets a partir da âncora):**
- `COLD_SCHEDULE = [3h, 24h, 96h, 240h]` → toques 1..4 (3h, 1d, 4d, 10d).
- `WARM_SCHEDULE = [15min, 24h, 120h]` → toques 1..3 (15min, 1d, 5d).

**Regra do agendador (pura):** para um deal com `count = c` e `schedule`:
- `due_at = anchor_at + schedule[c]`. Se `now >= due_at` → enviar toque `c`. Senão → pular.
- Inicialização + avaliação no MESMO run: se `followup` ausente, deriva a âncora (§7), `count=0`, e já avalia `due`.
- Após enviar: `count = c+1`, `last_sent_at = now`. Se `c+1 >= schedule.length` → `stopped=true`, `stopped_reason="max_touches"` + tag `sem-resposta`.

Horário comercial: seg–sex 08:00–17:30 **BRT (offset fixo −03:00**, igual à `lib/ai/scheduling`). Gate no endpoint (§11).

## 8. Copy

### 8.1 FRIA — roteiro FIXO (`lib/ai/followup/copy.ts`)
Bolhas curtas (uma por linha, enviadas separadas), sem emoji, sem travessão, "consultor" (nunca "vendedor"), `{nome}` = primeiro nome.

**Toque 1 (+3h) — reabre a porta**
```
Oi {nome}, consegue falar por aqui?
Já vou adiantando seu caso pro consultor pra ele chegar certeiro quando for te ligar.
```
**Toque 2 (+1 dia) — você nos procurou por um motivo**
```
{nome}, você chegou até a gente porque tem algo pra resolver no seu plano de saúde.
É exatamente isso que a gente faz: entende o seu caso e acha a melhor saída pra você e sua família.
Consigo te reservar 15 minutos com um consultor pra isso.
```
**Toque 3 (+4 dias) — reajuste composto**
```
{nome}, um detalhe que quase ninguém nota: todo ano no mesmo plano seu valor sobe, mesmo sem usar.
Dá pra revisar isso antes do próximo reajuste, e normalmente sobra dinheiro no seu bolso.
```
**Toque 4 (+10 dias) — despedida**
```
{nome}, não vou insistir à toa.
Paro por aqui, mas quando quiser resolver seu plano é só me chamar. Fico à disposição.
```

### 8.2 QUENTE — IA na voz da Ana (`lib/ai/followup/generate.ts`)
`generateWarmFollowupBubbles({ supabase, organizationId, boardId, firstName, conversationId, count })` — irmão de `generateFirstTouchBubbles`: mesma persona (`board_ai_config.persona_prompt`) + provider/modelo (`getOrgAIConfig` + `getModel`). Lê as últimas ~12 mensagens da conversa + `custom_fields.qualificacao/lead_form` e escreve o toque **retomando de onde parou**. `maxRetries: 2`; qualquer falha/vazio → **fallback fixo**.

Intenção por toque + **fallback**:
- **Toque 1 (+15min):** retoma o ponto / refaz a última pergunta. Fallback: `{nome}, ainda por aí? Podemos continuar de onde paramos.`
- **Toque 2 (+1 dia):** re-frame de valor ancorado no que o lead disse. Fallback: `{nome}, consigo agilizar seu atendimento com o consultor. Quer que eu já organize?`
- **Toque 3 (+5 dias):** despedida — **sempre fixa** (não chama a IA): `{nome}, vou pausar por aqui. Quando quiser retomar, é só responder.`

## 9. Envio

`sendAIResponse({ supabase, conversationId, response })` (`lib/ai/agent/agent.service.ts`): busca `channel_id`+`external_contact_id`, quebra `response` em bolhas (`splitIntoBubbles`, que também tira travessões) e envia pelo `ChannelRouter` com stagger. Passamos a copy do toque com **bolhas separadas por `\n`**. `sender_type='ai'`, `metadata.sent_by_ai=true` (a Ana enxerga o próprio toque no histórico e não re-cumprimenta).

Recomendado: marcar `metadata.source='followup'` e `cadence`/`touch` no insert (rastreabilidade) — se `sendAIResponse` não expõe metadata custom, aceitar o default (não bloqueia o MVP).

## 10. Paradas & reset

- **Lead responde** → `last_message_direction='inbound'` → sai da query (§5) → cadência para. (zero código)
- **Max toques** → `stopped=true`, `stopped_reason="max_touches"`, tag `sem-resposta`.
- **Consultor assumiu** (`contacts.ai_paused` ou `conversation.metadata.ai_paused`) → pulado.
- **Deal saiu do board / ganho / perdido** → fora da query.
- **Reengajamento (reset):** se existe INBOUND com `created_at > followup.anchor_at` (§5 passo 4), o lead voltou depois do início da cadência. **Reset:** limpar `followup` e reiniciar como **QUENTE** ancorado no `last_message_at` atual, `count=0` (a Ana viva já assume; se ele sumir de novo, começa uma cadência quente fresca). `stopped_reason` transitório = `"reengaged"`.

## 11. Segurança / multi-tenant

- **Client:** o cron roda sem sessão de usuário → usar **service-role admin client** (`createStaticAdminClient`, mesmo import do intake `@/lib/supabase/server`). ⚠️ O rascunho atual usa `createClient` (RLS-scoped, sem usuário) — **corrigir na reescrita** senão as leituras voltam vazias.
- **Auth do endpoint** (copiar verbatim de `daily-briefing/route.ts`): `GET`, `const cronSecret = process.env.CRON_SECRET; if (!cronSecret || authHeader !== 'Bearer '+cronSecret) return 401`. Falha fechada se o env faltar. `export const maxDuration = 60`.
- **Gate de horário comercial** no endpoint (retorna `{ skipped: true }` fora dele) — autoridade sobre o cron, que roda a cada 15 min sempre.
- **Escopo de org:** o endpoint filtra pela board da Niva (`c2e36157`), que já é single-org. Manter o gate por board.

## 12. Infra — pg_cron + pg_net

**Precedentes no repo:** `pg_cron` em `20260409120000_hitl_pending_alerts.sql` (`cron.schedule` dentro de `DO $$ ... EXCEPTION WHEN undefined_object ...`); `pg_net` (`net.http_post` com header `Bearer`) em `20251201000000_schema_init.sql`. **Novo:** compor os dois (cron que faz HTTP) — inédito no repo.

**Fatos:** `pg_net 0.20.0` **instalado**; `pg_cron 1.6.4` **disponível mas NÃO instalado** (precisa habilitar 1× no dashboard: Database → Extensions). Endpoint é `GET` → usar `net.http_get` (não `http_post`, que daria 405).

**Migration (idempotente):**
```sql
-- Requer pg_cron habilitado no dashboard (Database > Extensions). pg_net já está.
DO $$
BEGIN
  PERFORM cron.unschedule('lead-followup');   -- idempotência no re-run
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'lead-followup',
    '*/15 * * * *',                            -- a cada 15 min; o endpoint filtra horário comercial
    $cmd$
      SELECT net.http_get(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'lead_followup_url'),
        headers := jsonb_build_object(
          'Authorization',
          'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
        )
      );
    $cmd$
  );
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'pg_cron indisponível — habilite a extensão no dashboard e reaplique';
END $$;
```

**Segredos no Vault (runbook de deploy, fora da migration — nunca commitar o secret):**
```sql
select vault.create_secret('https://nossocrm-wheat.vercel.app/api/cron/lead-followup', 'lead_followup_url');
select vault.create_secret('<CRON_SECRET de produção>', 'cron_secret');
```
Aplicar a migration é seguro mesmo antes de criar os secrets (eles são lidos quando o JOB dispara, não no apply). Rotação de secret/domínio = re-`create_secret` (o job relê a cada disparo).

## 13. Testes

- `test/followup/schedule.test.ts` — puro: dado `{cadence, anchor_at, count, now}` → toque devido correto (limites de cada janela fria/quente; nada antes da hora; `stopped` no último). Discriminador fria/quente. Regra de reset.
- `test/followup/copy.test.ts` — seleção de copy por (cadência, count); interpolação de `{nome}`; toque 3 quente sempre fixo; nenhuma bolha com emoji/travessão.
- Espelhar o estilo de `test/scheduling/booker.test.ts`. Lógica pesada mora nas funções puras; o endpoint fica fino.

## 14. Rollout / operação

1. `pnpm install` limpo + `pnpm tsc` + `pnpm lint` + `pnpm test` verdes localmente.
2. Habilitar `pg_cron` no dashboard do `nossocrmv2` (1×).
3. Criar os 2 secrets no Vault (§12).
4. Deploy do código (`git push origin feat/lead-intake-route:main`).
5. Aplicar a migration do cron.
6. **Smoke:** um deal na board da Ana com `last_message_direction='outbound'` e âncora vencida → conferir o toque no WhatsApp + `custom_fields.followup.count` incrementado + `last_message_at` atualizado. Nº de teste da Thalita: +5511910312432.

## 15. Riscos & mitigações

- **Ban do número UAZAPI:** cadência enxuta + só horário comercial + para no 1º "não"/resposta. Leads são opt-in (deram o número no formulário).
- **Duplo envio:** o avanço do `count` é **persistido ANTES do envio** (revert best-effort se o envio falhar). Se a função morrer ou o persist falhar, o mesmo toque nunca é reenviado — trade: no pior caso o lead perde 1 toque (aceitável) em vez de receber duplicado (risco de ban). Um run só envia o toque devido uma vez.
- **Timezone:** offset fixo −03:00 (sem DST, sem lib) — igual ao resto do projeto; não introduzir `Intl`/tz que derive.
- **Reengajamento fantasma:** o reset (§10) evita que um lead que voltou e sumiu de novo fique preso no `stopped`.

## 16. Fast-follow (fora desta leva)

Cadência 3 (lembrete anti-no-show) reusa este motor: chave = `deals.custom_fields.reuniao_agendada.data_hora` com `status='confirmada'`, janela `-24h`/`-2h`; frase via `slotLabelFromIso(data_hora, '-03:00')`. Sem schema novo. (Descoberto no mapa do subsistema.)

## 17. Arquivos a criar / alterar

**Criar:**
- `lib/ai/followup/schedule.ts` (puro: cadência, schedules, "toque devido", reset)
- `lib/ai/followup/copy.ts` (COLD_TOUCHES fixos + WARM_FALLBACK + tag)
- `lib/ai/followup/generate.ts` (`generateWarmFollowupBubbles`, IA + fallback)
- `supabase/migrations/<ts>_lead_followup_cron.sql`
- `test/followup/schedule.test.ts`, `test/followup/copy.test.ts`

**Reescrever:**
- `app/api/cron/lead-followup/route.ts` (rascunho atual: 4h fixo, 2 toques genéricos, `createClient` → trocar por admin client, classificador, schedules, copy híbrida, reset).
