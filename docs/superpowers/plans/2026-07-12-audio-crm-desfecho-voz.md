# Áudio → IA → CRM (desfecho da call por voz) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O consultor grava uma nota de voz de ~30s dentro do card do deal; o servidor transcreve (Gemini) e estrutura o desfecho da call; um card de revisão editável confirma; ao confirmar, o CRM grava atômico (nota + tarefas na agenda + dados do negócio + objeções/motivo de perda), roteia o board por desfecho e marca a reunião como realizada. Botão "Reunião realizada" (par do No-show) e métricas de funil completam o elo Agendadas → Realizadas → Vendas.

**Architecture:** Reusa o padrão do No-show (rota atômica server-side + hook + gating por `CONSULTOR_BOARD_ID`). Transcrição no `@google/genai` (já instalado, 0 dep nova). Áudio no bucket privado `deal-files`; transcrição+desfecho em `voice_calls` (tabela já existe). Structured output SEMPRE no Gemini via `getModel('google', structuredApiKey…)` (Anthropic rejeita min/max/int nos schemas). Sem tabela nova.

**Tech Stack:** Next.js 16 (App Router, rotas em `app/api`), React 19, TypeScript 5, Zod v4, Vercel AI SDK (`ai` v6 `generateText`/`Output.object`) + `@google/genai` v1.49 (áudio), Supabase (SSR client p/ autorização via RLS; static admin client p/ writes de sistema), TanStack Query v5, Tailwind v4, Vitest 4 (`happy-dom`, `globals:true`, alias `@`→raiz).

**Spec de origem:** `docs/superpowers/specs/2026-07-11-audio-crm-desfecho-voz-design.md` (design 100% fechado). **Branch:** `feat/lead-intake-route` (NÃO `main`).

> ## ✅ STATUS: EXECUTADO (F1–F6) em 12–13/07/2026
> Commits `0564b1f`…`HEAD` na `feat/lead-intake-route`. 75 testes verdes, tsc+lint limpos.
> **Desvios do plano (documentados inline):** (1) testes RTL `.test.tsx` omitidos — checkout sem `@testing-library/dom` (gap de ambiente, pré-existente); (2) rota `apply` em ordem **deal-first** (ver F2.5); (3) upload sem `organization_id` (tabela não tem); (4) **revisão adversarial multi-agente** entre F2 e F3 achou e corrigiu: HIGH de segurança (transcribe route sem gate RLS do deal), conversão webm/mp4→mp3 no client (docs do Gemini contraditórias p/ webm), campos de motivo de perda no card de revisão, `loss_reason = detalhe ?? rótulo`, +9 testes; (5) F5 conta no-show EXATO via `custom_fields.no_show_at` (não derivado); (6) RPC `get_funnel_report` JÁ APLICADA no banco nossocrmv2 (aditiva, inerte até o deploy).
> **Pendente fora do código:** `pnpm install` limpo (repor `react-is`/`@testing-library/dom`), smoke manual ao vivo (gravar 30s no card de teste), decisão de deploy/cutover.

---

## Correções de âncora do spec (confirmadas lendo o código — obrigatórias)

O spec cita caminhos/linhas que mudaram; use ESTES:

1. **DealDetailModal:** `features/boards/components/Modals/DealDetailModal.tsx` (NÃO `features/deals/`). Props `{ dealId, isOpen, onClose }`. Estado perto de `showBriefingDrawer` em L143–175; reset `useEffect [isOpen, dealId]` em L183–201; cluster do header (botão "Preparar") em L584–607; composer de nota (`handleAddNote` L318–335, JSX L890–911) com um `<div />` vazio à esquerda do botão Enviar (L902) que é o ponto natural pro microfone; `<BriefingDrawer/>` em L1307–1312. Já consome `QualificacaoSDRPanel` + `sdrPanelHasData`.
2. **QualificacaoSDRPanel:** `features/deals/components/QualificacaoSDRPanel.tsx` (NÃO `components/features/`). Exporta `QualificacaoSDRPanel` e `sdrPanelHasData`, e um `Row` interno (label/value) que vamos espelhar.
3. **`moveStageByDealId` (`lib/public-api/dealsMoveStage.ts`) NÃO troca `board_id` e NÃO faz spread de `custom_fields`** — move só DENTRO do board atual. Para mover ENTRE boards (fechou→Implantação, perdeu→Nutrição) **espelhe o UPDATE inline do no-show** (`app/api/deals/[dealId]/no-show/route.ts` L100–118): `.update({ board_id, stage_id, is_won/is_lost, closed_at, loss_reason, last_stage_change_date, updated_at, custom_fields: {...spread} })`.
4. **A rota do no-show NÃO escreve activities** — o `apply` vai escrever nota/tarefas do zero (não há o que espelhar; siga este plano).
5. **`useMarkNoShow` invalida SÓ `DEALS_VIEW_KEY`** — no `meeting-held` e no `apply` invalide também `queryKeys.activities.all`.
6. **`dealFilesService` (`lib/supabase/dealFiles.ts`) usa o client de NAVEGADOR** (`lib/supabase/client`). A rota server-side não pode chamá-lo; vamos criar um upload server-side (static admin client) com a MESMA convenção de bucket/caminho.
7. **`@google/genai` no repo hoje só faz File Search** (`lib/ai/messaging/file-search.ts`) e NÃO usa `createUserContent`/`createPartFromBase64` — nós vamos introduzi-los (são exportados pela v1.49).
8. **Não existe service de `voice_calls`** — o INSERT é novo (inline no `apply`, via admin client; a tabela tem FORCE RLS + policy `service_role`).
9. **Activity type** = `'CALL' | 'MEETING' | 'EMAIL' | 'TASK' | 'NOTE' | 'STATUS_CHANGE'`. Índice único `uniq_consultant_call_slot ON activities (owner_id, date) WHERE type='CALL' AND deleted_at IS NULL` → tarefas = `TASK`; fallback de realizada = `MEETING`; **nunca** criar `CALL` avulsa. `owner_id`/`deleted_at` NÃO aparecem no type de app `Activity` (existem no banco) → inserir activities server-side com shape do BANCO via admin client.
10. **`getDateRange` é privado** em `features/dashboard/hooks/useDashboardMetrics.ts`. Para F5 use `periodToDateRange` (exportado, `lib/utils/periodToDateRange.ts`, retorna ISO) ou os filtros `dateFrom`/`dateTo` do `useActivities`.

---

## File Structure

**Criar:**
- `lib/config/boards.ts` → **modificar** (add IDs Implantação/Nutrição/Negociação).
- `lib/ai/taxonomy/motivos.ts` — enum `MotivoTag` (Zod) + rótulos pt-BR. Usado pela Ana E pelo consultor.
- `lib/ai/call-outcome/transcribe.ts` — transcrição de áudio (Gemini `@google/genai`).
- `lib/ai/call-outcome/schemas.ts` — `DesfechoSchema` (Zod v4).
- `lib/ai/call-outcome/call-outcome.service.ts` — extração estruturada do desfecho.
- `lib/ai/call-outcome/routing.ts` — funções puras: `routeForDesfecho`, `reabordarEmFallback`.
- `lib/supabase/dealFilesServer.ts` — upload server-side pro bucket `deal-files`.
- `app/api/deals/[dealId]/call-outcome/route.ts` — transcreve + extrai (não grava).
- `app/api/deals/[dealId]/call-outcome/apply/route.ts` — aplica atômico.
- `app/api/deals/[dealId]/meeting-held/route.ts` — botão "Reunião realizada".
- `lib/query/hooks/useCallOutcome.ts` — mutations (transcrever + aplicar).
- `lib/query/hooks/useMarkMeetingHeld.ts` — clone do `useMarkNoShow`.
- `features/deals/components/VoiceOutcomeCapture.tsx` — gravação + card de revisão editável (in-place no composer).
- `features/dashboard/components/ReunioesMetricsSection.tsx` — F5.
- `lib/query/hooks/useFunnelReportQuery.ts` — F6.
- `features/dashboard/components/FunnelReportSection.tsx` — F6 (tela + CSV).
- `supabase/migrations/<ts>_get_funnel_report.sql` — F6 RPC.
- Testes: `test/callOutcome.transcribe.test.ts`, `test/callOutcome.schema.test.ts`, `test/callOutcome.routing.test.ts`, `test/callOutcomeRoute.test.ts`, `test/callOutcomeApplyRoute.test.ts`, `test/meetingHeldRoute.test.ts`, `lib/ai/taxonomy/motivos.test.ts`, `features/deals/components/VoiceOutcomeCapture.test.tsx`.

**Modificar:**
- `features/boards/components/Modals/DealDetailModal.tsx` — microfone no composer + estado do capture + botão "Reunião realizada" no header.
- `features/deals/components/QualificacaoSDRPanel.tsx` — (nenhuma mudança de código; só espelhamos o `Row`).
- `lib/ai/extraction/domain/niva-health.ts` — `objecoes: string[]` → `MotivoTag[]`.
- `features/boards/components/Kanban/DealCard.tsx` — prop/handler/botão "Reunião realizada".
- `features/boards/components/Kanban/KanbanBoard.tsx` — hook/handler/gating.
- `lib/query/hooks/index.ts` — exportar novos hooks.
- `features/dashboard/DashboardPage.tsx` — render da seção Reuniões + link do relatório.

---

## Convenções compartilhadas (leia antes de qualquer task)

- **Rodar 1 teste:** `pnpm vitest run <caminho> -t "<nome do it>"` (o repo usa **pnpm**; scripts: `pnpm test:run`, `pnpm typecheck`, `pnpm lint`). Se `pnpm` não estiver no PATH, use `npx vitest run …`.
- **Idioma dos testes:** `import { describe, it, expect, vi, beforeEach } from 'vitest'`. Rota: montar `new Request('http://localhost/…')` e context `{ params: Promise.resolve({ dealId }) }`. Mockar `@/lib/supabase/server` (`createClient`) e `@/lib/supabase/staticAdminClient` (`createStaticAdminClient`) com query-builders `vi.fn().mockReturnThis()` + `single/maybeSingle` async. Ver `test/briefingApi.test.ts` como molde.
- **⚠️ Testes de componente (RTL / `.test.tsx`) NÃO rodam neste checkout:** falta o peer `@testing-library/dom` no `node_modules` (o próprio `DealDetailModal.test.tsx` já falha com `Cannot find module '@testing-library/dom'`). É gap de ambiente, não de código. Portanto: os testes com `render()` do RTL foram **omitidos**; a UI é verificada via **preview** (browser). Se o ambiente for corrigido (`@testing-library/dom` instalado), reintroduza os `.test.tsx` deste plano. Os testes `.test.ts` (schema/routing/rotas/serviços) rodam normalmente.
- **Mock de classe com `new`:** para mockar `@google/genai` (`new GoogleGenAI()`), use `vi.fn(function () { return {…} })` (função normal), NUNCA arrow — arrow não é constructor.
- **UUID guard:** reusar `const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;`.
- **`custom_fields` é REPLACE total** — SEMPRE `{ ...existingCf, … }`.
- **Commits frequentes** (1 por task, mensagem `feat:`/`test:`). NÃO abrir PR nem tocar `main`.

---

# FASE F1 — Cano de voz (gravar → upload → transcrever → mostrar transcrição)

**Entregável:** No card, o microfone grava; o servidor sobe o áudio pro `deal-files`, transcreve no Gemini e devolve o texto; o card mostra a transcrição + player. **Ainda não grava desfecho.**

### Task F1.1: IDs de board de destino em `lib/config/boards.ts`

**Files:**
- Modify: `lib/config/boards.ts`

- [ ] **Step 1: Adicionar as constantes** (o valor de Negociação será confirmado na F3 — deixe o TODO com o prefixo conhecido; NÃO invente o UUID completo).

Append ao final de `lib/config/boards.ts`:

```ts

/** Board "Implantação — ADM" (destino do desfecho `fechou`). */
export const IMPLANTACAO_ADM_BOARD_ID = '851c641a-ac99-404e-83d7-9712425b5fdf';

/** Etapa de entrada "Aguardando Documentação" no board de Implantação. */
export const IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID = '53589d9d-d0a5-4f62-8cda-20c89828a2b3';

/** Board "Nutrição — Reativação" (destino do desfecho `perdeu`). */
export const NUTRICAO_REATIVACAO_BOARD_ID = '4fb31290-2ab4-46ac-83b1-555fbd4908cc';

/** Etapa "Recontato Agendado" no board de Nutrição (todo perdido com lembrete de data). */
export const NUTRICAO_RECONTATO_STAGE_ID = '2ee5e57e-e616-45e0-8e46-34741f64ef14';

/**
 * Etapa "Negociação" dentro do board do Consultor (destino do desfecho `vai_pensar`).
 * ⚠️ CONFIRMAR o UUID completo na F3 (spec dá só o prefixo `86179ae9`): rodar
 *   SELECT id,name FROM board_stages WHERE board_id='efbaa84e-cf4b-4465-8b50-41afd612088e';
 */
export const NEGOCIACAO_STAGE_ID = '86179ae9-0000-0000-0000-000000000000'; // TODO(F3): substituir pelo UUID real
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (novas const não usadas ainda; sem erro).

- [ ] **Step 3: Commit**

```bash
git add lib/config/boards.ts
git commit -m "feat: add Implantação/Nutrição/Negociação board+stage ids"
```

### Task F1.2: `lib/ai/call-outcome/transcribe.ts` (transcrição Gemini)

**Files:**
- Create: `lib/ai/call-outcome/transcribe.ts`
- Test: `test/callOutcome.transcribe.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `test/callOutcome.transcribe.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContentMock = vi.fn(async () => ({ text: 'fechei com a Valéria, 3 vidas, Amil' }));

vi.mock('@google/genai', () => ({
  // Função normal (NÃO arrow) que RETORNA o objeto → utilizável com `new` (arrow
  // não é constructor e quebra `new GoogleGenAI()` com "is not a constructor").
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: generateContentMock } };
  }),
  createUserContent: vi.fn((parts: unknown) => parts),
  createPartFromBase64: vi.fn((data: string, mimeType: string) => ({ inlineData: { data, mimeType } })),
}));

import { transcribeAudio } from '@/lib/ai/call-outcome/transcribe';
import { createPartFromBase64 } from '@google/genai';

describe('transcribeAudio', () => {
  beforeEach(() => vi.clearAllMocks());

  it('chama o Gemini com o áudio inline e retorna o texto', async () => {
    const text = await transcribeAudio({
      apiKey: 'k',
      model: 'gemini-2.5-flash-lite',
      audioBase64: 'AAAA',
      mimeType: 'audio/webm',
    });
    expect(text).toBe('fechei com a Valéria, 3 vidas, Amil');
    expect(createPartFromBase64).toHaveBeenCalledWith('AAAA', 'audio/webm');
    expect(generateContentMock).toHaveBeenCalledOnce();
    const arg = generateContentMock.mock.calls[0][0] as { model: string };
    expect(arg.model).toBe('gemini-2.5-flash-lite');
  });

  it('retorna string vazia quando o modelo não devolve texto', async () => {
    generateContentMock.mockResolvedValueOnce({ text: undefined } as unknown as { text: string });
    const text = await transcribeAudio({ apiKey: 'k', model: 'm', audioBase64: 'x', mimeType: 'audio/ogg' });
    expect(text).toBe('');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run test/callOutcome.transcribe.test.ts`
Expected: FAIL ("Cannot find module '@/lib/ai/call-outcome/transcribe'").

- [ ] **Step 3: Implementar**

Create `lib/ai/call-outcome/transcribe.ts`:

```ts
/**
 * Transcrição de áudio de call via @google/genai (Gemini aceita ogg/webm inline).
 * ~30s cabe base64 inline (< 20MB). Structured output NÃO acontece aqui — só texto.
 */
import { GoogleGenAI, createUserContent, createPartFromBase64 } from '@google/genai';

const TRANSCRIBE_PROMPT =
  'Transcreva este áudio em português do Brasil, verbatim (palavra por palavra). ' +
  'Não resuma, não interprete, não adicione pontuação de fala. Devolva apenas o texto falado.';

export async function transcribeAudio(opts: {
  apiKey: string;
  model: string;
  audioBase64: string;
  mimeType: string;
}): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const response = await ai.models.generateContent({
    model: opts.model,
    contents: createUserContent([
      createPartFromBase64(opts.audioBase64, opts.mimeType),
      TRANSCRIBE_PROMPT,
    ]),
  });
  return response.text ?? '';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run test/callOutcome.transcribe.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/call-outcome/transcribe.ts test/callOutcome.transcribe.test.ts
git commit -m "feat: add Gemini audio transcription helper"
```

### Task F1.3: `lib/supabase/dealFilesServer.ts` (upload server-side)

**Files:**
- Create: `lib/supabase/dealFilesServer.ts`

> Sem teste unitário dedicado (é só cola do Storage/DB; é exercitado pelo teste de rota com mock). Espelha a convenção do `dealFilesService` (bucket `deal-files`, path `{dealId}/{uuid}.{ext}`, registro em `deal_files`) mas usa o **static admin client** e recebe um `Buffer`.

- [ ] **Step 1: Implementar**

Create `lib/supabase/dealFilesServer.ts`:

```ts
/**
 * Upload server-side de um arquivo de deal pro bucket privado `deal-files`.
 * O dealFilesService (client de navegador) não serve em rota; aqui usamos o
 * static admin client (write de sistema). Mesma convenção de path/registro.
 */
import { createStaticAdminClient } from './staticAdminClient';

const BUCKET_NAME = 'deal-files';

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
};

export async function uploadDealAudioServer(opts: {
  dealId: string;
  buffer: Buffer;
  mimeType: string;
  createdBy?: string | null;
}): Promise<{ filePath: string | null; error: Error | null }> {
  const admin = createStaticAdminClient();
  const ext = MIME_TO_EXT[opts.mimeType.split(';')[0]] ?? 'audio';
  const filePath = `${opts.dealId}/voice/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET_NAME)
    .upload(filePath, opts.buffer, { contentType: opts.mimeType });
  if (uploadError) return { filePath: null, error: uploadError as Error };

  const { error: insertError } = await admin.from('deal_files').insert({
    deal_id: opts.dealId,
    file_name: filePath.split('/').pop(),
    file_path: filePath,
    file_size: opts.buffer.length,
    mime_type: opts.mimeType,
    created_by: opts.createdBy ?? null,
  });
  if (insertError) return { filePath, error: insertError as Error };

  return { filePath, error: null };
}

/** Signed URL de 1h pro áudio (usado pelo card de revisão / player). */
export async function getDealAudioSignedUrl(filePath: string): Promise<string | null> {
  const admin = createStaticAdminClient();
  const { data } = await admin.storage.from(BUCKET_NAME).createSignedUrl(filePath, 3600);
  return data?.signedUrl ?? null;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

> ✅ Confirmado no schema_init: `deal_files` NÃO tem `organization_id` (colunas: id, deal_id, file_name, file_path, file_size, mime_type, created_at, created_by). O insert acima omite org_id de propósito (espelha o `dealFilesService` do client). O path `{dealId}/voice/…` isola por deal. Bucket privado (`public=false`, 10MB).

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/dealFilesServer.ts
git commit -m "feat: add server-side deal audio upload helper"
```

### Task F1.4: Rota `POST /api/deals/[dealId]/call-outcome` (transcreve, não grava)

**Files:**
- Create: `app/api/deals/[dealId]/call-outcome/route.ts`
- Test: `test/callOutcomeRoute.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `test/callOutcomeRoute.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

let profileQB: Record<string, unknown>;
let supabaseClientMock: Record<string, unknown>;
let aiConfig: unknown;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/ai/agent/agent.service', () => ({ getOrgAIConfig: vi.fn(async () => aiConfig) }));
vi.mock('@/lib/ai/call-outcome/transcribe', () => ({ transcribeAudio: vi.fn(async () => 'texto transcrito') }));
vi.mock('@/lib/supabase/dealFilesServer', () => ({
  uploadDealAudioServer: vi.fn(async () => ({ filePath: `${DEAL_ID}/voice/x.webm`, error: null })),
}));

import { POST } from '@/app/api/deals/[dealId]/call-outcome/route';

function buildProfileQB(orgId: string | null = ORG_ID) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: orgId ? { organization_id: orgId } : null, error: null })),
  };
}
function auth(userId: string | null = USER_ID) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) } };
}
async function callPost(dealId = DEAL_ID, hasFile = true): Promise<Response> {
  const form = new FormData();
  if (hasFile) form.set('audio', new File([new Uint8Array([1, 2, 3])], 'a.webm', { type: 'audio/webm' }));
  const req = new Request(`http://localhost/api/deals/${dealId}/call-outcome`, { method: 'POST', body: form });
  return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('POST /api/deals/[dealId]/call-outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileQB = buildProfileQB();
    aiConfig = { structuredApiKey: 'gkey', structuredModel: 'gemini-2.5-flash-lite' };
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => { if (t === 'profiles') return profileQB; throw new Error('unexpected ' + t); }),
    };
  });

  it('401 sem usuário', async () => {
    supabaseClientMock = { ...auth(null), from: vi.fn() };
    expect((await callPost()).status).toBe(401);
  });

  it('400 quando dealId inválido', async () => {
    expect((await callPost('nao-uuid')).status).toBe(400);
  });

  it('400 sem arquivo de áudio', async () => {
    expect((await callPost(DEAL_ID, false)).status).toBe(400);
  });

  it('422 quando a org não tem chave Google (structuredApiKey vazio)', async () => {
    aiConfig = { structuredApiKey: '', structuredModel: 'm' };
    expect((await callPost()).status).toBe(422);
  });

  it('200 devolve transcrição + audioFilePath', async () => {
    const res = await callPost();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcricao).toBe('texto transcrito');
    expect(body.audioFilePath).toContain('/voice/');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run test/callOutcomeRoute.test.ts`
Expected: FAIL (módulo da rota não existe).

- [ ] **Step 3: Implementar**

Create `app/api/deals/[dealId]/call-outcome/route.ts`:

```ts
/**
 * POST /api/deals/[dealId]/call-outcome
 *
 * Recebe o áudio da call (multipart `audio`), sobe pro bucket `deal-files`,
 * transcreve no Gemini e devolve { transcricao, audioFilePath }. NÃO grava
 * desfecho (isso é o /apply). Guard: org sem chave Google → 422.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import { transcribeAudio } from '@/lib/ai/call-outcome/transcribe';
import { uploadDealAudioServer } from '@/lib/supabase/dealFilesServer';

export const maxDuration = 60;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await request.formData();
  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'audio file is required' }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from('profiles').select('organization_id').eq('id', user.id).maybeSingle();
  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const aiConfig = await getOrgAIConfig(supabase, profile.organization_id);
  if (!aiConfig || !aiConfig.structuredApiKey) {
    return NextResponse.json({ error: 'Google AI key not configured' }, { status: 422 });
  }

  const buffer = Buffer.from(await audio.arrayBuffer());
  const mimeType = audio.type || 'audio/webm';

  const { filePath, error: uploadErr } = await uploadDealAudioServer({
    dealId,
    buffer,
    mimeType,
    createdBy: user.id,
  });
  if (uploadErr || !filePath) {
    console.error('[call-outcome] upload failed:', uploadErr?.message);
    return NextResponse.json({ error: 'Failed to store audio' }, { status: 500 });
  }

  try {
    const transcricao = await transcribeAudio({
      apiKey: aiConfig.structuredApiKey,
      model: aiConfig.structuredModel,
      audioBase64: buffer.toString('base64'),
      mimeType,
    });
    return NextResponse.json({ transcricao, audioFilePath: filePath }, { status: 200 });
  } catch (err) {
    console.error('[call-outcome] transcription failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Transcription failed' }, { status: 502 });
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run test/callOutcomeRoute.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add app/api/deals/[dealId]/call-outcome/route.ts test/callOutcomeRoute.test.ts
git commit -m "feat: add call-outcome transcription route"
```

### Task F1.5: Hook `useCallOutcome` (mutation de transcrição)

**Files:**
- Create: `lib/query/hooks/useCallOutcome.ts`
- Modify: `lib/query/hooks/index.ts`

> Sem teste unitário (thin fetch wrapper; exercitado pela UI). O `apply` é adicionado a este hook na F2.

- [ ] **Step 1: Implementar**

Create `lib/query/hooks/useCallOutcome.ts`:

```ts
/**
 * Mutations do fluxo áudio→CRM.
 * - useTranscribeCallOutcome: sobe o áudio + devolve a transcrição (F1).
 * - useApplyCallOutcome: aplica o desfecho confirmado (F2+).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEALS_VIEW_KEY, queryKeys } from '../index';

export interface TranscribeResult {
  transcricao: string;
  audioFilePath: string;
  desfecho?: unknown; // preenchido a partir da F2
}

export function useTranscribeCallOutcome() {
  return useMutation<TranscribeResult, Error, { dealId: string; audio: Blob }>({
    mutationFn: async ({ dealId, audio }) => {
      const form = new FormData();
      form.set('audio', audio, 'call.webm');
      const res = await fetch(`/api/deals/${dealId}/call-outcome`, { method: 'POST', body: form });
      if (!res.ok) {
        let message = 'Falha ao transcrever o áudio';
        try { const e = (await res.json()) as { error?: string }; if (e?.error) message = e.error; } catch { /* noop */ }
        throw new Error(message);
      }
      return (await res.json()) as TranscribeResult;
    },
  });
}

export interface ApplyCallOutcomeInput {
  dealId: string;
  audioFilePath: string;
  transcricao: string;
  desfecho: Record<string, unknown>;
  conversationId?: string;
  contactId?: string;
}

export function useApplyCallOutcome() {
  const queryClient = useQueryClient();
  return useMutation<{ dealId: string; applied: boolean }, Error, ApplyCallOutcomeInput>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/deals/${input.dealId}/call-outcome/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        let message = 'Falha ao aplicar o desfecho';
        try { const e = (await res.json()) as { error?: string }; if (e?.error) message = e.error; } catch { /* noop */ }
        throw new Error(message);
      }
      return (await res.json()) as { dealId: string; applied: boolean };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    },
  });
}
```

- [ ] **Step 2: Exportar no barrel** — em `lib/query/hooks/index.ts`, adicionar perto do export de `useMarkNoShow` (L84):

```ts
// Áudio → CRM (transcrição + aplicação do desfecho da call)
export { useTranscribeCallOutcome, useApplyCallOutcome } from './useCallOutcome';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/query/hooks/useCallOutcome.ts lib/query/hooks/index.ts
git commit -m "feat: add useCallOutcome mutation hooks"
```

### Task F1.6: `VoiceOutcomeCapture` — gravação + transcrição in-place

**Files:**
- Create: `features/deals/components/VoiceOutcomeCapture.tsx`
- Test: `features/deals/components/VoiceOutcomeCapture.test.tsx`

> Escopo F1: microfone em destaque; ao parar, chama `useTranscribeCallOutcome`; mostra a transcrição (read-only) + `AudioPlayer` do preview local + botão "Descartar". Os campos editáveis e "Confirmar" entram na F2. O MediaRecorder é extraído do padrão de `MessageInput.tsx` (L245–341), simplificado (sem conversão mp3 — o `deal-files` aceita webm/ogg).

- [ ] **Step 1: Escrever o teste que falha** (testa o estado "com transcrição" injetando via prop de teste, já que `getUserMedia` não roda em happy-dom)

Create `features/deals/components/VoiceOutcomeCapture.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VoiceOutcomeCapture } from './VoiceOutcomeCapture';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('VoiceOutcomeCapture', () => {
  it('mostra o botão de gravar quando ocioso', () => {
    wrap(<VoiceOutcomeCapture dealId="c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6" />);
    expect(screen.getByRole('button', { name: /gravar desfecho/i })).toBeInTheDocument();
  });

  it('renderiza a transcrição injetada (estado de revisão)', () => {
    wrap(
      <VoiceOutcomeCapture
        dealId="c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6"
        __testInitialReview={{ transcricao: 'fechei com a Valéria', audioFilePath: 'x/voice/a.webm' }}
      />,
    );
    expect(screen.getByText(/fechei com a Valéria/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run features/deals/components/VoiceOutcomeCapture.test.tsx`
Expected: FAIL (componente não existe).

- [ ] **Step 3: Implementar**

Create `features/deals/components/VoiceOutcomeCapture.tsx`:

```tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, Loader2 } from 'lucide-react';
import AudioPlayer from '@/components/ui/AudioPlayer';
import { useTranscribeCallOutcome, type TranscribeResult } from '@/lib/query/hooks/useCallOutcome';

interface VoiceOutcomeCaptureProps {
  dealId: string;
  /** Apenas para testes: entra direto no estado de revisão. */
  __testInitialReview?: TranscribeResult;
}

const PREFERRED_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];

export function VoiceOutcomeCapture({ dealId, __testInitialReview }: VoiceOutcomeCaptureProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [review, setReview] = useState<TranscribeResult | null>(__testInitialReview ?? null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const transcribe = useTranscribeCallOutcome();

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const r = mediaRecorderRef.current;
    if (r && r.state !== 'inactive') r.stream?.getTracks().forEach((t) => t.stop());
    if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
  }, [localAudioUrl]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(100);
      setIsRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch { /* mic negado — falha silenciosa */ }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    recorder.onstop = async () => {
      recorder.stream?.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
      const type = recorder.mimeType.split(';')[0] || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      setLocalAudioUrl(URL.createObjectURL(blob));
      try {
        const result = await transcribe.mutateAsync({ dealId, audio: blob });
        setReview(result);
      } catch { /* erro exposto via transcribe.isError */ }
    };
    recorder.stop();
  }, [dealId, transcribe]);

  const discard = useCallback(() => {
    setReview(null);
    if (localAudioUrl) { URL.revokeObjectURL(localAudioUrl); setLocalAudioUrl(null); }
    setDuration(0);
  }, [localAudioUrl]);

  // Estado de revisão (F1: só transcrição + player; campos editáveis na F2)
  if (review) {
    return (
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm space-y-3">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Desfecho da call (revisão)</h4>
        {localAudioUrl && <AudioPlayer src={localAudioUrl} variant="preview" />}
        <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">{review.transcricao}</p>
        <div className="flex justify-end">
          <button
            onClick={discard}
            className="text-xs font-bold text-slate-500 hover:text-red-500 flex items-center gap-1.5"
          >
            <Trash2 size={14} /> Descartar
          </button>
        </div>
      </div>
    );
  }

  // Estado ocioso / gravando / transcrevendo
  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm">
      {transcribe.isPending ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Transcrevendo o áudio…
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            aria-label={isRecording ? 'Parar gravação' : 'Gravar desfecho da call'}
            className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 ${
              isRecording
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-primary-600 hover:bg-primary-500 text-white'
            }`}
          >
            {isRecording ? <Square size={18} fill="currentColor" /> : <Mic size={18} />}
          </button>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {isRecording ? `Gravando… ${duration}s` : 'Gravar o desfecho da call'}
            </p>
            <p className="text-xs text-slate-400">
              {isRecording ? 'Toque pra parar e transcrever' : 'Fale o resultado: fechou, próximos passos, valores'}
            </p>
          </div>
        </div>
      )}
      {transcribe.isError && (
        <p className="mt-2 text-xs text-red-500">{transcribe.error.message}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run features/deals/components/VoiceOutcomeCapture.test.tsx`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add features/deals/components/VoiceOutcomeCapture.tsx features/deals/components/VoiceOutcomeCapture.test.tsx
git commit -m "feat: add VoiceOutcomeCapture recorder + transcript review (F1)"
```

### Task F1.7: Ligar o microfone no composer de nota do DealDetailModal

**Files:**
- Modify: `features/boards/components/Modals/DealDetailModal.tsx`

> Microfone em DESTAQUE (pedido da Thalita): renderizar `<VoiceOutcomeCapture>` ACIMA do composer de nota; digitar nota vira secundário. Sem quebrar o `handleAddNote` existente.

- [ ] **Step 1: Importar o componente** — junto dos imports de `@/features/deals/components/*` (perto de L60):

```ts
import { VoiceOutcomeCapture } from '@/features/deals/components/VoiceOutcomeCapture';
```

- [ ] **Step 2: Renderizar acima do composer** — no bloco do Timeline (logo após `{activeTab === 'timeline' && (` e o `<div className="space-y-6">` em ~L892), ANTES do `<div … >` que contém o `<textarea ref={noteTextareaRef}>`:

```tsx
                    <VoiceOutcomeCapture dealId={deal.id} />
```

Resultado: o card de voz aparece primeiro; o composer de nota (textarea "Escreva uma nota…") continua logo abaixo como ação secundária.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Verificação visual (preview)**

Rodar o dev server (`preview_start` com a config de `.claude/launch.json`), abrir um card no board, aba Timeline, e confirmar: o cartão "Gravar o desfecho da call" aparece acima do composer de nota. (Sem microfone real no headless, basta confirmar a renderização e ausência de erro no console.)

- [ ] **Step 5: Commit**

```bash
git add features/boards/components/Modals/DealDetailModal.tsx
git commit -m "feat: surface voice outcome capture in deal timeline (F1)"
```

### Task F1.8: Fechar a F1 (suíte + typecheck)

- [ ] **Step 1:** `pnpm typecheck` → PASS.
- [ ] **Step 2:** `pnpm vitest run test/callOutcome.transcribe.test.ts test/callOutcomeRoute.test.ts features/deals/components/VoiceOutcomeCapture.test.tsx` → todos PASS.
- [ ] **Step 3:** `pnpm lint` → PASS (0 warnings).
- [ ] **Step 4 (smoke manual, opcional agora):** gravar 30s no card de teste da Thalita (`+5511910312432`) e ver a transcrição aparecer. (Pode ficar pro fim da F2, quando há o "Confirmar".)

---

# FASE F2 — Taxonomia + extração estruturada + aplicar (nota/tarefas/dados/objeções)

**Entregável:** módulo `MotivoTag`, `DesfechoSchema` + service de extração, card de revisão EDITÁVEL, rota `/apply` que grava nota-resumo + tarefas (todas na agenda) + dados do negócio + objeções/motivo de perda + `enviado_em` + `voice_calls`. **Ainda sem mover board (F3) nem marcar realizada (F4).** A `objecoes` da Ana passa a `MotivoTag[]`.

### Task F2.1: `lib/ai/taxonomy/motivos.ts` (enum unificado + rótulos)

**Files:**
- Create: `lib/ai/taxonomy/motivos.ts`
- Test: `lib/ai/taxonomy/motivos.test.ts`

- [ ] **Step 1: Teste que falha**

Create `lib/ai/taxonomy/motivos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MotivoTagSchema, MOTIVO_LABELS, MOTIVO_TAGS } from './motivos';

describe('MotivoTag taxonomy', () => {
  it('aceita todas as tags válidas', () => {
    for (const tag of MOTIVO_TAGS) expect(MotivoTagSchema.safeParse(tag).success).toBe(true);
  });
  it('rejeita "preco" (mapeado para sem_oportunidade)', () => {
    expect(MotivoTagSchema.safeParse('preco').success).toBe(false);
  });
  it('tem rótulo pt-BR para cada tag', () => {
    for (const tag of MOTIVO_TAGS) expect(MOTIVO_LABELS[tag]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run lib/ai/taxonomy/motivos.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Create `lib/ai/taxonomy/motivos.ts`:

```ts
/**
 * Taxonomia unificada de objeções e motivos de perda — usada pela Ana (qualificação)
 * E pelo consultor (desfecho da call), pra o relatório agregar o funil inteiro.
 * Decisão da Thalita: "preço" NÃO é tag — vira `sem_oportunidade`.
 */
import { z } from 'zod';

export const MOTIVO_TAGS = [
  'sem_oportunidade', // lead sem fit/budget real (inclui "achou caro")
  'ficou_na_atual',   // inércia/medo de trocar
  'carencia',
  'rede',             // hospital/médico fora
  'concorrente',
  'fora_icp',         // sem CNPJ/inelegível
  'sem_resposta',     // sumiu
  'timing',           // adiou
  'reembolso',
  'confianca',
  'decisor',          // precisa consultar sócio/cônjuge
  'burocracia',
  'outro',
] as const;

export type MotivoTag = (typeof MOTIVO_TAGS)[number];

export const MotivoTagSchema = z.enum(MOTIVO_TAGS);

export const MOTIVO_LABELS: Record<MotivoTag, string> = {
  sem_oportunidade: 'Sem oportunidade (fit/budget)',
  ficou_na_atual: 'Ficou no plano atual',
  carencia: 'Carência',
  rede: 'Rede (hospital/médico)',
  concorrente: 'Foi pro concorrente',
  fora_icp: 'Fora do ICP',
  sem_resposta: 'Sem resposta / sumiu',
  timing: 'Timing (adiou)',
  reembolso: 'Reembolso',
  confianca: 'Confiança',
  decisor: 'Falta o decisor',
  burocracia: 'Burocracia',
  outro: 'Outro',
};
```

- [ ] **Step 4: Rodar e ver passar** → `pnpm vitest run lib/ai/taxonomy/motivos.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/taxonomy/motivos.ts lib/ai/taxonomy/motivos.test.ts
git commit -m "feat: add unified MotivoTag taxonomy (objections + loss reasons)"
```

### Task F2.2: `lib/ai/call-outcome/schemas.ts` (`DesfechoSchema`)

**Files:**
- Create: `lib/ai/call-outcome/schemas.ts`
- Test: `test/callOutcome.schema.test.ts`

- [ ] **Step 1: Teste que falha**

Create `test/callOutcome.schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DesfechoSchema } from '@/lib/ai/call-outcome/schemas';

const base = {
  desfecho: 'fechou',
  nota_resumo: 'Fechou com a Valéria, 3 vidas, Amil.',
  tarefas: [{ descricao: 'Enviar contrato', data: '2026-07-14T13:00:00.000Z' }],
  dados_negocio: { operadora: 'Amil', vidas: 3, valor: 2100 },
  objecoes: [],
  motivo_perda: null,
  motivo_perda_detalhe: null,
  reabordar_em: null,
  confidence: 0.9,
};

describe('DesfechoSchema', () => {
  it('valida um desfecho completo', () => {
    expect(DesfechoSchema.safeParse(base).success).toBe(true);
  });
  it('rejeita desfecho fora do enum', () => {
    expect(DesfechoSchema.safeParse({ ...base, desfecho: 'talvez' }).success).toBe(false);
  });
  it('aceita tarefa com data null', () => {
    const r = DesfechoSchema.safeParse({ ...base, tarefas: [{ descricao: 'Ligar depois', data: null }] });
    expect(r.success).toBe(true);
  });
  it('aceita motivo_perda como MotivoTag no perdeu', () => {
    const r = DesfechoSchema.safeParse({ ...base, desfecho: 'perdeu', motivo_perda: 'concorrente', reabordar_em: '2027-01-01T12:00:00.000Z' });
    expect(r.success).toBe(true);
  });
  it('rejeita objecao inválida', () => {
    expect(DesfechoSchema.safeParse({ ...base, objecoes: ['preco'] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar**

Create `lib/ai/call-outcome/schemas.ts`:

```ts
/**
 * Schema estruturado do desfecho da call (Zod v4). Cada .describe() É o prompt
 * do campo. Structured output roda SEMPRE no Gemini (Anthropic rejeita min/max/int).
 */
import { z } from 'zod';
import { MotivoTagSchema } from '@/lib/ai/taxonomy/motivos';

export const DesfechoSchema = z.object({
  desfecho: z
    .enum(['fechou', 'vai_pensar', 'perdeu', 'remarcar', 'nao_atendeu'])
    .describe('Resultado da ligação: fechou (vendeu), vai_pensar (segue em negociação), perdeu (não vai fechar), remarcar (vai ligar de novo), nao_atendeu (não atendeu/caixa postal)'),
  nota_resumo: z.string().describe('Resumo objetivo do que aconteceu na call, em 1-3 frases, para o histórico do card'),
  tarefas: z
    .array(z.object({
      descricao: z.string().describe('O que precisa ser feito (ex.: "enviar contrato", "mandar documentos", "ligar terça")'),
      data: z.string().nullable().describe('Data/hora ISO 8601 da tarefa se o consultor disse quando. null se não houver data'),
    }))
    .describe('TODAS as tarefas/próximos passos ditos no áudio. Cada uma vira uma atividade na agenda. Array vazio se nenhuma'),
  dados_negocio: z.object({
    operadora: z.string().nullable().describe('Operadora escolhida/negociada (ex.: Amil, Bradesco). null se não citada'),
    vidas: z.number().nullable().describe('Número de vidas do plano fechado/negociado. null se não citado'),
    valor: z.number().nullable().describe('Valor mensal do plano em reais (só número). null se não citado'),
  }).describe('Dados comerciais do negócio mencionados na call'),
  objecoes: z.array(MotivoTagSchema).describe('Objeções ouvidas na call, cada uma como categoria da taxonomia. Array vazio se nenhuma'),
  motivo_perda: MotivoTagSchema.nullable().describe('Categoria do motivo da perda. Preencher SOMENTE quando desfecho=perdeu; senão null'),
  motivo_perda_detalhe: z.string().nullable().describe('Detalhe livre do motivo da perda (frase do consultor). null se não perdeu'),
  reabordar_em: z.string().nullable().describe('Data ISO sugerida para reabordar o lead (só quando perdeu). Priorize o sinal REAL da conversa (vencimento do contrato/apólice, "me chama em março") sobre qualquer padrão. null se não perdeu'),
  confidence: z.number().describe('Confiança geral da extração, de 0 a 1'),
});

export type Desfecho = z.infer<typeof DesfechoSchema>;
```

- [ ] **Step 4: Rodar e ver passar** → PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/call-outcome/schemas.ts test/callOutcome.schema.test.ts
git commit -m "feat: add DesfechoSchema for structured call outcome"
```

### Task F2.3: `lib/ai/call-outcome/call-outcome.service.ts` (extração)

**Files:**
- Create: `lib/ai/call-outcome/call-outcome.service.ts`

> Espelha `extraction.service.ts` L108–124: `getModel('google', structuredApiKey ?? apiKey, structuredModel ?? model)` + `generateText({ model, output: Output.object({ schema }), system, prompt, maxRetries: 2 })`. Sem teste unitário direto (é chamada de LLM; validada pelos testes de schema + rota com mock). Loga tokens best-effort.

- [ ] **Step 1: Implementar**

Create `lib/ai/call-outcome/call-outcome.service.ts`:

```ts
/**
 * Extração estruturada do desfecho da call a partir da transcrição.
 * Structured output SEMPRE no Gemini (getModel('google', …)).
 */
import { generateText, Output } from 'ai';
import { getModel } from '@/lib/ai/config';
import type { OrgAIConfig } from '@/lib/ai/agent/agent.service';
import { DesfechoSchema, type Desfecho } from './schemas';

const SYSTEM_PROMPT = `Você estrutura o desfecho de uma ligação de vendas de plano de saúde a partir da transcrição da nota de voz do consultor.
Regras:
- Extraia TODAS as tarefas/próximos passos ditos (cada uma com data ISO se houver).
- Só marque desfecho=perdeu se ficou claro que não vai fechar; use motivo_perda da taxonomia.
- Para reabordar_em, priorize o sinal real da conversa (vencimento de contrato/apólice, "me chama em X").
- Não invente valores. Campo sem informação = null.`;

export async function extractCallOutcome(opts: {
  aiConfig: OrgAIConfig;
  transcricao: string;
}): Promise<{ desfecho: Desfecho; tokens: number }> {
  const model = getModel(
    'google',
    opts.aiConfig.structuredApiKey || opts.aiConfig.apiKey,
    opts.aiConfig.structuredModel || opts.aiConfig.model,
  );

  const result = await generateText({
    model,
    output: Output.object({
      schema: DesfechoSchema,
      name: 'DesfechoCall',
      description: 'Desfecho estruturado da ligação do consultor',
    }),
    system: SYSTEM_PROMPT,
    prompt: `Transcrição da nota de voz do consultor:\n\n${opts.transcricao}`,
    maxRetries: 2,
  });

  return { desfecho: result.output as Desfecho, tokens: result.usage?.totalTokens ?? 0 };
}
```

> ⚠️ Confirme o nome exportado do type de config: o explorer viu `OrgAIConfig` exportado em `lib/ai/agent/agent.service.ts`. Se o `export` for só do valor e não do type, importe de onde estiver declarado (grep `export interface OrgAIConfig`).

- [ ] **Step 2: Typecheck** → `pnpm typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/call-outcome/call-outcome.service.ts
git commit -m "feat: add call outcome extraction service (Gemini structured)"
```

### Task F2.4: Rota `call-outcome` também extrai o desfecho

**Files:**
- Modify: `app/api/deals/[dealId]/call-outcome/route.ts`
- Modify: `test/callOutcomeRoute.test.ts`

- [ ] **Step 1: Estender o teste** — adicionar mock de extração e asserção de `desfecho` no 200. Em `test/callOutcomeRoute.test.ts`, adicionar mock:

```ts
vi.mock('@/lib/ai/call-outcome/call-outcome.service', () => ({
  extractCallOutcome: vi.fn(async () => ({ desfecho: { desfecho: 'fechou', nota_resumo: 'ok', tarefas: [], dados_negocio: { operadora: null, vidas: null, valor: null }, objecoes: [], motivo_perda: null, motivo_perda_detalhe: null, reabordar_em: null, confidence: 0.8 }, tokens: 10 })),
}));
```

e no teste "200 devolve transcrição…" acrescentar:

```ts
    expect(body.desfecho.desfecho).toBe('fechou');
```

- [ ] **Step 2: Rodar e ver falhar** → o 200 falha em `body.desfecho`.

- [ ] **Step 3: Implementar** — em `route.ts`, importar e chamar a extração dentro do try, devolvendo `desfecho`:

```ts
import { extractCallOutcome } from '@/lib/ai/call-outcome/call-outcome.service';
```

E no bloco try (substituir o `return` de sucesso):

```ts
    const transcricao = await transcribeAudio({
      apiKey: aiConfig.structuredApiKey,
      model: aiConfig.structuredModel,
      audioBase64: buffer.toString('base64'),
      mimeType,
    });
    const { desfecho } = await extractCallOutcome({ aiConfig, transcricao });
    return NextResponse.json({ transcricao, desfecho, audioFilePath: filePath }, { status: 200 });
```

- [ ] **Step 4: Rodar e ver passar** → `pnpm vitest run test/callOutcomeRoute.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/deals/[dealId]/call-outcome/route.ts test/callOutcomeRoute.test.ts
git commit -m "feat: extract structured outcome in call-outcome route"
```

### Task F2.5: Rota `apply` — gravação atômica (nota + tarefas + dados + objeções + voice_calls)

**Files:**
- Create: `app/api/deals/[dealId]/call-outcome/apply/route.ts`
- Test: `test/callOutcomeApplyRoute.test.ts`

> F2 grava: (1) NOTE resumo `completed`, `date=enviado_em`; (2) 1 TASK por tarefa (`date=tarefa.data ?? enviado_em`, `completed:false`, `owner_id=deal.owner_id`); (3) merge conservador de `custom_fields.qualificacao.{operadora,vidas,valor_pago_exato}` + `deals.value=valor` só se `>0` e `fechou`; (4) `custom_fields.objecoes` (estruturado) + no `perdeu`, `custom_fields.motivo_perda` + `deals.loss_reason`; (5) `voice_calls`. O move de board (F3) e o realizada (F4) entram depois. Idempotência via `custom_fields.call_outcome_applied_at`. Trata 23505 → 409.
>
> ⚠️ **Ordem shipada = DEAL-FIRST** (divergência intencional do rascunho abaixo): lê o deal → idempotência → monta `nextCf`/`dealUpdate` → **UPDATE do deal (23505→409, carimba `call_outcome_applied_at`)** → só ENTÃO escreve activities/voice_calls (best-effort). Motivo: em F3 o UPDATE move de board e pode disparar `check_deal_duplicate` (23505); com deal-first, um conflito retorna 409 ANTES de inserir activities → sem activities órfãs. Espelha o no-show (move primeiro, side-effects depois). As instruções de F3.3/F4.5 já assumem essa ordem. **O arquivo committado é a fonte de verdade.**

- [ ] **Step 1: Teste que falha**

Create `test/callOutcomeApplyRoute.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

let dealRow: Record<string, unknown>;
let dealUpdateSpy: ReturnType<typeof vi.fn>;
let activityInsertSpy: ReturnType<typeof vi.fn>;
let voiceInsertSpy: ReturnType<typeof vi.fn>;
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));

import { POST } from '@/app/api/deals/[dealId]/call-outcome/apply/route';

function auth(userId: string | null = USER_ID) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) } };
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    audioFilePath: `${DEAL_ID}/voice/a.webm`,
    transcricao: 'fechei com a Valéria',
    desfecho: {
      desfecho: 'fechou', nota_resumo: 'Fechou 3 vidas Amil',
      tarefas: [{ descricao: 'Enviar contrato', data: null }],
      dados_negocio: { operadora: 'Amil', vidas: 3, valor: 2100 },
      objecoes: [], motivo_perda: null, motivo_perda_detalhe: null, reabordar_em: null, confidence: 0.9,
    },
    ...overrides,
  };
}

async function callPost(body: unknown, dealId = DEAL_ID): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/call-outcome/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('POST /api/deals/[dealId]/call-outcome/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dealRow = { id: DEAL_ID, organization_id: ORG_ID, owner_id: USER_ID, board_id: 'efbaa84e-cf4b-4465-8b50-41afd612088e', stage_id: 's1', value: 0, custom_fields: { tier: { valor: 'prata' }, qualificacao: { vidas: 2 } } };
    dealUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
    activityInsertSpy = vi.fn(async () => ({ error: null }));
    voiceInsertSpy = vi.fn(async () => ({ error: null }));
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => {
        if (t === 'deals') return {
          select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
          single: vi.fn(async () => ({ data: dealRow, error: null })),
          update: dealUpdateSpy,
        };
        throw new Error('unexpected ' + t);
      }),
    };
    adminMock = {
      from: vi.fn((t: string) => {
        if (t === 'activities') return { insert: activityInsertSpy };
        if (t === 'voice_calls') return { insert: voiceInsertSpy };
        throw new Error('unexpected admin ' + t);
      }),
    };
  });

  it('401 sem usuário', async () => {
    supabaseClientMock = { ...auth(null), from: vi.fn() };
    expect((await callPost(baseBody())).status).toBe(401);
  });

  it('grava nota + tarefa + voice_calls e responde 200', async () => {
    const res = await callPost(baseBody());
    expect(res.status).toBe(200);
    // 1 NOTE + 1 TASK
    expect(activityInsertSpy).toHaveBeenCalledTimes(2);
    const types = activityInsertSpy.mock.calls.map((c) => (c[0] as { type: string }).type).sort();
    expect(types).toEqual(['NOTE', 'TASK']);
    expect(voiceInsertSpy).toHaveBeenCalledOnce();
  });

  it('NÃO apaga custom_fields existentes (spread) e faz merge de qualificacao', async () => {
    await callPost(baseBody());
    const updateArg = dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown>; value?: number };
    expect(updateArg.custom_fields).toHaveProperty('tier');
    const qual = updateArg.custom_fields.qualificacao as Record<string, unknown>;
    expect(qual.operadora).toBe('Amil');
    expect(qual.vidas).toBe(3);
    expect(updateArg.value).toBe(2100); // fechou → value do negócio
  });

  it('idempotente: já aplicado → 200 sem regravar', async () => {
    dealRow = { ...dealRow, custom_fields: { ...(dealRow.custom_fields as object), call_outcome_applied_at: '2026-07-12T00:00:00Z' } };
    const res = await callPost(baseBody());
    expect(res.status).toBe(200);
    expect(activityInsertSpy).not.toHaveBeenCalled();
  });

  it('23505 no update → 409', async () => {
    dealUpdateSpy.mockReturnValue({ eq: vi.fn(async () => ({ error: { code: '23505' } })) });
    expect((await callPost(baseBody())).status).toBe(409);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL (rota inexistente).

- [ ] **Step 3: Implementar**

Create `app/api/deals/[dealId]/call-outcome/apply/route.ts`:

```ts
/**
 * POST /api/deals/[dealId]/call-outcome/apply
 *
 * Aplica o desfecho CONFIRMADO da call, atômico. F2: nota-resumo + tarefas
 * (todas na agenda) + dados do negócio + objeções/motivo_perda + voice_calls.
 * Carimba `enviado_em` (now) em tudo. custom_fields é REPLACE → spread seguro.
 * (Move de board = F3; marcar realizada = F4.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { DesfechoSchema } from '@/lib/ai/call-outcome/schemas';

export const maxDuration = 60;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    audioFilePath?: string; transcricao?: string; desfecho?: unknown;
  };
  const parsed = DesfechoSchema.safeParse(body.desfecho);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid desfecho payload' }, { status: 400 });
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // RLS é o gate de autorização.
  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id, organization_id, owner_id, board_id, stage_id, value, custom_fields')
    .eq('id', dealId)
    .single();
  if (dealErr || !deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });

  const existingCf = (deal.custom_fields as Record<string, unknown> | null) ?? {};
  if (existingCf.call_outcome_applied_at) {
    return NextResponse.json({ dealId, applied: true, already_applied: true }, { status: 200 });
  }

  const enviadoEm = new Date().toISOString();
  const admin = createStaticAdminClient();
  const orgId = deal.organization_id as string;
  const ownerId = (deal.owner_id as string | null) ?? user.id;

  // 1. Nota-resumo → activity NOTE completed.
  await admin.from('activities').insert({
    organization_id: orgId, deal_id: dealId, owner_id: ownerId,
    type: 'NOTE', title: 'Desfecho da call', description: d.nota_resumo,
    date: enviadoEm, completed: true,
  });

  // 2. Tarefas → 1 TASK por item (nunca CALL — evita o índice único de CALL).
  for (const t of d.tarefas) {
    await admin.from('activities').insert({
      organization_id: orgId, deal_id: dealId, owner_id: ownerId,
      type: 'TASK', title: t.descricao, description: t.descricao,
      date: t.data ?? enviadoEm, completed: false,
    });
  }

  // 3/4. custom_fields (spread) + dados do negócio + objeções + motivo_perda.
  const qual = { ...((existingCf.qualificacao as Record<string, unknown> | undefined) ?? {}) };
  if (d.dados_negocio.operadora) qual.operadora = d.dados_negocio.operadora;
  if (typeof d.dados_negocio.vidas === 'number') qual.vidas = d.dados_negocio.vidas;
  if (typeof d.dados_negocio.valor === 'number' && d.dados_negocio.valor > 0) qual.valor_pago_exato = d.dados_negocio.valor;

  const prevObjecoes = Array.isArray(existingCf.objecoes) ? (existingCf.objecoes as unknown[]) : [];
  const newObjecoes = d.objecoes.map((categoria) => ({ categoria, detalhe: null, origem: 'consultor' as const }));

  const nextCf: Record<string, unknown> = {
    ...existingCf,
    qualificacao: qual,
    objecoes: [...prevObjecoes, ...newObjecoes],
    call_outcome_applied_at: enviadoEm,
  };
  if (d.desfecho === 'perdeu' && d.motivo_perda) {
    nextCf.motivo_perda = { categoria: d.motivo_perda, detalhe: d.motivo_perda_detalhe ?? null };
  }

  const dealUpdate: Record<string, unknown> = { custom_fields: nextCf, updated_at: enviadoEm };
  if (d.desfecho === 'fechou' && typeof d.dados_negocio.valor === 'number' && d.dados_negocio.valor > 0) {
    dealUpdate.value = d.dados_negocio.valor;
  }
  if (d.desfecho === 'perdeu' && d.motivo_perda_detalhe) {
    dealUpdate.loss_reason = d.motivo_perda_detalhe;
  }

  const { error: updErr } = await supabase.from('deals').update(dealUpdate).eq('id', dealId);
  if (updErr) {
    if ((updErr as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Deal duplicado na etapa de destino.' }, { status: 409 });
    }
    console.error('[call-outcome/apply] deal update failed:', updErr.message);
    return NextResponse.json({ error: 'Failed to apply outcome' }, { status: 500 });
  }

  // 5. Persistir a call em voice_calls (FORCE RLS → admin/service role).
  await admin.from('voice_calls').insert({
    organization_id: orgId, deal_id: dealId, mode: 'human_call', status: 'completed',
    initiated_by: user.id, channel: 'phone', direction: 'outbound',
    started_at: enviadoEm, ended_at: enviadoEm,
    transcript: { text: body.transcricao ?? '' },
    analysis: d,
    metadata: { audio_path: body.audioFilePath ?? null },
  });

  return NextResponse.json({ dealId, applied: true }, { status: 200 });
}
```

- [ ] **Step 4: Rodar e ver passar** → `pnpm vitest run test/callOutcomeApplyRoute.test.ts` → PASS (5 testes).

> ⚠️ Nota de fidelidade: o teste mocka `.update(...).eq(...)` como `dealUpdateSpy` retornando `{ eq }`. Garanta que a implementação chama exatamente `.update(dealUpdate).eq('id', dealId)` (uma cadeia), como no código acima.

- [ ] **Step 5: Commit**

```bash
git add app/api/deals/[dealId]/call-outcome/apply/route.ts test/callOutcomeApplyRoute.test.ts
git commit -m "feat: add atomic call-outcome apply route (note+tasks+deal data+voice_calls)"
```

### Task F2.6: Card de revisão EDITÁVEL + confirmar (VoiceOutcomeCapture)

**Files:**
- Modify: `features/deals/components/VoiceOutcomeCapture.tsx`
- Modify: `features/deals/components/VoiceOutcomeCapture.test.tsx`

> Ao receber `{ transcricao, desfecho, audioFilePath }`, mostrar campos editáveis: select de `desfecho`, textarea `nota_resumo`, lista de tarefas (descrição + data), inputs de `dados_negocio`. Botão "Confirmar" chama `useApplyCallOutcome`. Espelha o `Row`/layout do `QualificacaoSDRPanel`.

- [ ] **Step 1: Estender o teste** — cobrir o estado editável e o clique em confirmar (mockando `useApplyCallOutcome`). Adicionar ao arquivo de teste um caso que injeta `__testInitialReview` com `desfecho` e verifica que existe um `combobox`/select de desfecho e o botão "Confirmar":

```tsx
  it('mostra campos editáveis e botão confirmar quando há desfecho', () => {
    wrap(
      <VoiceOutcomeCapture
        dealId="c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6"
        __testInitialReview={{
          transcricao: 'fechei', audioFilePath: 'x/voice/a.webm',
          desfecho: { desfecho: 'fechou', nota_resumo: 'ok', tarefas: [], dados_negocio: { operadora: 'Amil', vidas: 3, valor: 2100 }, objecoes: [], motivo_perda: null, motivo_perda_detalhe: null, reabordar_em: null, confidence: 0.9 },
        } as never}
      />,
    );
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Amil')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar** — evoluir `VoiceOutcomeCapture` para: (a) `TranscribeResult` ganha `desfecho?: Desfecho`; (b) estado local `edited: Desfecho | null` inicializado do `review.desfecho`; (c) render dos campos editáveis com `Row`-like layout; (d) `useApplyCallOutcome().mutateAsync({ dealId, audioFilePath, transcricao, desfecho: edited })` no "Confirmar", com `onSuccess` → `discard()` (limpa) + toast. Código completo:

```tsx
// (adicionar imports)
import { useApplyCallOutcome } from '@/lib/query/hooks/useCallOutcome';
import type { Desfecho } from '@/lib/ai/call-outcome/schemas';
import { Check } from 'lucide-react';
```

Substituir o bloco `if (review) { … }` por:

```tsx
  if (review && edited) {
    const set = (patch: Partial<Desfecho>) => setEdited({ ...edited, ...patch });
    const setDados = (patch: Partial<Desfecho['dados_negocio']>) =>
      setEdited({ ...edited, dados_negocio: { ...edited.dados_negocio, ...patch } });
    return (
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm space-y-3">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Desfecho da call (revisão)</h4>
        {localAudioUrl && <AudioPlayer src={localAudioUrl} variant="preview" />}
        <p className="text-[11px] text-slate-400 whitespace-pre-wrap border-l-2 border-slate-200 dark:border-white/10 pl-2">{review.transcricao}</p>

        <label className="block text-xs">
          <span className="text-slate-400">Desfecho</span>
          <select
            value={edited.desfecho}
            onChange={(e) => set({ desfecho: e.target.value as Desfecho['desfecho'] })}
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="fechou">Fechou</option>
            <option value="vai_pensar">Vai pensar</option>
            <option value="perdeu">Perdeu</option>
            <option value="remarcar">Remarcar</option>
            <option value="nao_atendeu">Não atendeu</option>
          </select>
        </label>

        <label className="block text-xs">
          <span className="text-slate-400">Resumo</span>
          <textarea
            value={edited.nota_resumo}
            onChange={(e) => set({ nota_resumo: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm min-h-[60px]"
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="block text-xs">
            <span className="text-slate-400">Operadora</span>
            <input
              value={edited.dados_negocio.operadora ?? ''}
              onChange={(e) => setDados({ operadora: e.target.value || null })}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-slate-400">Vidas</span>
            <input
              type="number" value={edited.dados_negocio.vidas ?? ''}
              onChange={(e) => setDados({ vidas: e.target.value ? Number(e.target.value) : null })}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-slate-400">Valor</span>
            <input
              type="number" value={edited.dados_negocio.valor ?? ''}
              onChange={(e) => setDados({ valor: e.target.value ? Number(e.target.value) : null })}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        {edited.tarefas.length > 0 && (
          <div className="text-xs">
            <span className="text-slate-400">Tarefas ({edited.tarefas.length})</span>
            <ul className="mt-1 space-y-1">
              {edited.tarefas.map((t, i) => (
                <li key={i} className="text-slate-900 dark:text-white">• {t.descricao}{t.data ? ` — ${new Date(t.data).toLocaleString('pt-BR')}` : ''}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-between items-center pt-1">
          <button onClick={discard} className="text-xs font-bold text-slate-500 hover:text-red-500 flex items-center gap-1.5">
            <Trash2 size={14} /> Descartar
          </button>
          <button
            onClick={() => apply.mutate(
              { dealId, audioFilePath: review.audioFilePath, transcricao: review.transcricao, desfecho: edited as unknown as Record<string, unknown> },
              { onSuccess: discard },
            )}
            disabled={apply.isPending}
            className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2"
          >
            <Check size={14} /> {apply.isPending ? 'Salvando…' : 'Confirmar'}
          </button>
        </div>
        {apply.isError && <p className="text-xs text-red-500">{apply.error.message}</p>}
      </div>
    );
  }
```

E no topo do componente adicionar o estado e o hook:

```tsx
  const [edited, setEdited] = useState<Desfecho | null>(
    (__testInitialReview?.desfecho as Desfecho | undefined) ?? null,
  );
  const apply = useApplyCallOutcome();
```

Ao setar `review` no `stopRecording` (após transcrever), também setar `edited`:

```tsx
        const result = await transcribe.mutateAsync({ dealId, audio: blob });
        setReview(result);
        if (result.desfecho) setEdited(result.desfecho as Desfecho);
```

(E atualizar `TranscribeResult` em `useCallOutcome.ts` para `desfecho?: Desfecho` — importe o type.)

- [ ] **Step 4: Rodar e ver passar** → `pnpm vitest run features/deals/components/VoiceOutcomeCapture.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add features/deals/components/VoiceOutcomeCapture.tsx features/deals/components/VoiceOutcomeCapture.test.tsx lib/query/hooks/useCallOutcome.ts
git commit -m "feat: editable outcome review card + confirm (F2)"
```

### Task F2.7: `objecoes` da Ana → `MotivoTag[]`

**Files:**
- Modify: `lib/ai/extraction/domain/niva-health.ts`

> Muda `objecoes: z.array(z.string())` para `z.array(MotivoTagSchema)` e o `apply()` para acumular no formato estruturado `{ categoria, detalhe, origem:'ana' }` (mantendo dedupe conservador). NÃO quebrar o `sdrPanelHasData`/painel (que hoje lê `objecoes` como lista simples — o painel usa `.join`/chips; ajustar pra ler `.categoria` se necessário, mas isso é do F5/UI — aqui só o extractor).

- [ ] **Step 1: Importar a taxonomia** no topo de `niva-health.ts`:

```ts
import { MotivoTagSchema, type MotivoTag } from '@/lib/ai/taxonomy/motivos';
```

- [ ] **Step 2: Trocar o campo** (L43–45):

```ts
  objecoes: z
    .array(MotivoTagSchema)
    .describe('Objeções levantadas pelo lead, cada uma como categoria da taxonomia (sem_oportunidade, ficou_na_atual, carencia, rede, concorrente, fora_icp, sem_resposta, timing, reembolso, confianca, decisor, burocracia, outro). Array vazio se nenhuma'),
```

- [ ] **Step 3: Ajustar o `apply()`** (L188–192) para o formato estruturado com origem, dedupe por categoria:

```ts
  // 2. Objeções (acumula estruturado + dedupe por categoria)
  if (Array.isArray(ext.objecoes) && ext.objecoes.length) {
    const prev = Array.isArray(customFields.objecoes) ? (customFields.objecoes as Array<{ categoria?: string }>) : [];
    const prevCats = new Set(prev.map((o) => o?.categoria).filter(Boolean));
    const additions = (ext.objecoes as MotivoTag[])
      .filter((c) => !prevCats.has(c))
      .map((categoria) => ({ categoria, detalhe: null, origem: 'ana' as const }));
    customFields.objecoes = [...prev, ...additions];
  }
```

- [ ] **Step 4: Typecheck + suíte da Ana** — `pnpm typecheck` e rodar os testes existentes que tocam niva-health/extração para garantir que não quebraram:

Run: `pnpm vitest run test/messagingAiProcess.test.ts` (e qualquer `*extraction*`/`*nivaHealth*` que exista)
Expected: PASS (ou só falhas pré-existentes de ambiente).

> ⚠️ Se algum teste asserta `objecoes` como `string[]`, atualize-o para o novo shape `{categoria,…}` — é mudança intencional do contrato.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/extraction/domain/niva-health.ts
git commit -m "feat: structure Ana objecoes as MotivoTag[] (unified taxonomy)"
```

---

# FASE F3 — Roteamento por desfecho (move board/stage + lembrete de reabordagem)

**Entregável:** no `apply`, mover o deal por `desfecho` (mapa §6) via UPDATE inline (espelhando o no-show): `fechou`→Implantação+is_won+closed_at; `perdeu`→Nutrição+is_lost+loss_reason+**lembrete de reabordagem** (TASK em `reabordar_em`); `vai_pensar`→Negociação; `remarcar`/`nao_atendeu` não movem. `is_won`/`is_lost` são setados NO DESFECHO.

### Task F3.1: Confirmar o UUID da etapa Negociação

**Files:**
- Modify: `lib/config/boards.ts`

- [ ] **Step 1: Consultar o banco** (Supabase MCP `execute_sql` ou psql):

```sql
SELECT id, name FROM board_stages
WHERE board_id = 'efbaa84e-cf4b-4465-8b50-41afd612088e' ORDER BY position;
```

- [ ] **Step 2:** Substituir o placeholder `NEGOCIACAO_STAGE_ID` em `lib/config/boards.ts` pelo UUID real da etapa "Negociação" (prefixo `86179ae9`). Remover o comentário `TODO(F3)`.

- [ ] **Step 3: Commit**

```bash
git add lib/config/boards.ts
git commit -m "feat: confirm Negociação stage id"
```

### Task F3.2: `lib/ai/call-outcome/routing.ts` (funções puras)

**Files:**
- Create: `lib/ai/call-outcome/routing.ts`
- Test: `test/callOutcome.routing.test.ts`

- [ ] **Step 1: Teste que falha**

Create `test/callOutcome.routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { routeForDesfecho, reabordarEmFallback } from '@/lib/ai/call-outcome/routing';
import {
  IMPLANTACAO_ADM_BOARD_ID, IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID,
  NUTRICAO_REATIVACAO_BOARD_ID, NUTRICAO_RECONTATO_STAGE_ID, NEGOCIACAO_STAGE_ID,
} from '@/lib/config/boards';

describe('routeForDesfecho', () => {
  it('fechou → Implantação + won', () => {
    const r = routeForDesfecho('fechou');
    expect(r).toMatchObject({ boardId: IMPLANTACAO_ADM_BOARD_ID, stageId: IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID, mark: 'won', reabordagem: false });
  });
  it('perdeu → Nutrição + lost + reabordagem', () => {
    const r = routeForDesfecho('perdeu');
    expect(r).toMatchObject({ boardId: NUTRICAO_REATIVACAO_BOARD_ID, stageId: NUTRICAO_RECONTATO_STAGE_ID, mark: 'lost', reabordagem: true });
  });
  it('vai_pensar → Negociação (mesmo board), sem mark', () => {
    const r = routeForDesfecho('vai_pensar');
    expect(r).toMatchObject({ stageId: NEGOCIACAO_STAGE_ID, mark: null });
    expect(r.boardId).toBeUndefined();
  });
  it('remarcar / nao_atendeu não movem', () => {
    expect(routeForDesfecho('remarcar').stageId).toBeUndefined();
    expect(routeForDesfecho('nao_atendeu').stageId).toBeUndefined();
  });
});

describe('reabordarEmFallback', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  it('concorrente → +12 meses', () => {
    expect(reabordarEmFallback('concorrente', now)).toBe(new Date('2027-07-12T12:00:00.000Z').toISOString());
  });
  it('decisor → +2 semanas', () => {
    expect(reabordarEmFallback('decisor', now)).toBe(new Date('2026-07-26T12:00:00.000Z').toISOString());
  });
  it('desconhecido → +3 meses (outro)', () => {
    expect(reabordarEmFallback('outro', now)).toBe(new Date('2026-10-12T12:00:00.000Z').toISOString());
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar**

Create `lib/ai/call-outcome/routing.ts`:

```ts
/**
 * Roteamento puro do desfecho → board/stage/flag + fallback de reabordagem (§6/§6.1).
 */
import type { Desfecho } from './schemas';
import type { MotivoTag } from '@/lib/ai/taxonomy/motivos';
import {
  IMPLANTACAO_ADM_BOARD_ID, IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID,
  NUTRICAO_REATIVACAO_BOARD_ID, NUTRICAO_RECONTATO_STAGE_ID, NEGOCIACAO_STAGE_ID,
} from '@/lib/config/boards';

export interface Route {
  boardId?: string;      // undefined = mesmo board
  stageId?: string;      // undefined = não move
  mark: 'won' | 'lost' | null;
  reabordagem: boolean;  // true = criar lembrete de reabordagem
}

export function routeForDesfecho(desfecho: Desfecho['desfecho']): Route {
  switch (desfecho) {
    case 'fechou':
      return { boardId: IMPLANTACAO_ADM_BOARD_ID, stageId: IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID, mark: 'won', reabordagem: false };
    case 'perdeu':
      return { boardId: NUTRICAO_REATIVACAO_BOARD_ID, stageId: NUTRICAO_RECONTATO_STAGE_ID, mark: 'lost', reabordagem: true };
    case 'vai_pensar':
      return { stageId: NEGOCIACAO_STAGE_ID, mark: null, reabordagem: false };
    default: // remarcar, nao_atendeu
      return { mark: null, reabordagem: false };
  }
}

// Fallback de dias/meses por motivo (§6.1). A IA prioriza o sinal real (reabordar_em do schema).
const REABORDAR_MESES: Record<MotivoTag, number> = {
  sem_oportunidade: 6,
  ficou_na_atual: 11,
  carencia: 3,
  rede: 6,
  concorrente: 12,
  timing: 1,
  reembolso: 6,
  confianca: 2,
  burocracia: 1,
  sem_resposta: 1,
  fora_icp: 6,
  decisor: 0, // tratado como +2 semanas abaixo
  outro: 3,
};

export function reabordarEmFallback(motivo: MotivoTag, now: Date): string {
  const d = new Date(now.getTime());
  if (motivo === 'decisor') {
    d.setUTCDate(d.getUTCDate() + 14);
    return d.toISOString();
  }
  d.setUTCMonth(d.getUTCMonth() + REABORDAR_MESES[motivo]);
  return d.toISOString();
}
```

- [ ] **Step 4: Rodar e ver passar** → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/call-outcome/routing.ts test/callOutcome.routing.test.ts
git commit -m "feat: add pure desfecho routing + reabordagem fallback"
```

### Task F3.3: Ligar o roteamento no `apply`

**Files:**
- Modify: `app/api/deals/[dealId]/call-outcome/apply/route.ts`
- Modify: `test/callOutcomeApplyRoute.test.ts`

- [ ] **Step 1: Estender o teste** — cobrir move em `fechou`/`perdeu`/`vai_pensar` e não-move em `remarcar`. Ao `dealUpdate` do fechou, esperar `board_id`/`stage_id`/`is_won`/`closed_at`; no perdeu, `is_lost` + uma 3ª activity (TASK de reabordagem). Adicionar:

```ts
  it('fechou → move pra Implantação com is_won', async () => {
    await callPost(baseBody());
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.board_id).toBe('851c641a-ac99-404e-83d7-9712425b5fdf');
    expect(arg.is_won).toBe(true);
    expect(arg.closed_at).toBeTruthy();
  });

  it('perdeu → move pra Nutrição com is_lost + cria TASK de reabordagem', async () => {
    await callPost(baseBody({ desfecho: { desfecho: 'perdeu', nota_resumo: 'perdeu', tarefas: [], dados_negocio: { operadora: null, vidas: null, valor: null }, objecoes: ['concorrente'], motivo_perda: 'concorrente', motivo_perda_detalhe: 'foi pra Amil', reabordar_em: '2027-07-12T12:00:00.000Z', confidence: 0.8 } }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.board_id).toBe('4fb31290-2ab4-46ac-83b1-555fbd4908cc');
    expect(arg.is_lost).toBe(true);
    expect(arg.loss_reason).toBe('foi pra Amil');
    // NOTE + TASK reabordagem (sem outras tarefas) = 2 inserts, um deles com date da reabordagem
    const dates = activityInsertSpy.mock.calls.map((c) => (c[0] as { date: string }).date);
    expect(dates).toContain('2027-07-12T12:00:00.000Z');
  });

  it('remarcar → não move de board', async () => {
    await callPost(baseBody({ desfecho: { desfecho: 'remarcar', nota_resumo: 'ligar amanhã', tarefas: [], dados_negocio: { operadora: null, vidas: null, valor: null }, objecoes: [], motivo_perda: null, motivo_perda_detalhe: null, reabordar_em: null, confidence: 0.7 } }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.board_id).toBeUndefined();
    expect(arg.stage_id).toBeUndefined();
  });
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar** — em `apply/route.ts`, importar routing e aplicar ao `dealUpdate` ANTES do `.update`, e criar a TASK de reabordagem:

```ts
import { routeForDesfecho, reabordarEmFallback } from '@/lib/ai/call-outcome/routing';
```

Após montar `dealUpdate` (antes do `.update`):

```ts
  const route = routeForDesfecho(d.desfecho);
  if (route.stageId) {
    dealUpdate.stage_id = route.stageId;
    dealUpdate.last_stage_change_date = enviadoEm;
    if (route.boardId) dealUpdate.board_id = route.boardId;
  }
  if (route.mark === 'won') { dealUpdate.is_won = true; dealUpdate.is_lost = false; dealUpdate.closed_at = enviadoEm; }
  if (route.mark === 'lost') { dealUpdate.is_lost = true; dealUpdate.is_won = false; dealUpdate.closed_at = enviadoEm; }
```

E depois do `.update` bem-sucedido, criar o lembrete de reabordagem:

```ts
  if (route.reabordagem) {
    const reabordarEm = d.reabordar_em ?? reabordarEmFallback(d.motivo_perda ?? 'outro', new Date(enviadoEm));
    await admin.from('activities').insert({
      organization_id: orgId, deal_id: dealId, owner_id: ownerId,
      type: 'TASK', title: 'Reabordar lead (reativação)',
      description: d.motivo_perda_detalhe ?? 'Reabordagem por motivo de perda',
      date: reabordarEm, completed: false,
    });
  }
```

- [ ] **Step 4: Rodar e ver passar** → `pnpm vitest run test/callOutcomeApplyRoute.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/deals/[dealId]/call-outcome/apply/route.ts test/callOutcomeApplyRoute.test.ts
git commit -m "feat: route deal by desfecho on apply + reabordagem reminder (F3)"
```

---

# FASE F4 — Botão "Reunião realizada" (par do No-show) + auto no apply

**Entregável:** rota `meeting-held` + hook + botão verde no card do Kanban (gating Consultor) e no header do card aberto; o `apply` também marca realizada (exceto `remarcar`/`nao_atendeu`).

### Task F4.1: Rota `POST /api/deals/[dealId]/meeting-held`

**Files:**
- Create: `app/api/deals/[dealId]/meeting-held/route.ts`
- Test: `test/meetingHeldRoute.test.ts`

> Molde do no-show, mas: sem mensagem, sem move de board. Idempotência via `custom_fields.reuniao_realizada`. Marca a CALL agendada (`custom_fields.reuniao_agendada.activity_id`) como `completed:true` via admin; se `activity_id` nulo → cria `activity` `MEETING` `completed:true` (não colide com o índice de CALL).

- [ ] **Step 1: Teste que falha**

Create `test/meetingHeldRoute.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const ACT_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';

let dealRow: Record<string, unknown>;
let dealUpdateSpy: ReturnType<typeof vi.fn>;
let actUpdateSpy: ReturnType<typeof vi.fn>;
let actInsertSpy: ReturnType<typeof vi.fn>;
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));

import { POST } from '@/app/api/deals/[dealId]/meeting-held/route';

function auth(userId: string | null = USER_ID) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) } };
}
async function callPost(dealId = DEAL_ID): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/meeting-held`, { method: 'POST', body: '{}' });
  return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('POST /api/deals/[dealId]/meeting-held', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dealRow = { id: DEAL_ID, organization_id: ORG_ID, owner_id: USER_ID, custom_fields: { reuniao_agendada: { activity_id: ACT_ID } } };
    dealUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
    actUpdateSpy = vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
    actInsertSpy = vi.fn(async () => ({ error: null }));
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => {
        if (t === 'deals') return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn(async () => ({ data: dealRow, error: null })), update: dealUpdateSpy };
        throw new Error('unexpected ' + t);
      }),
    };
    adminMock = { from: vi.fn((t: string) => { if (t === 'activities') return { update: actUpdateSpy, insert: actInsertSpy }; throw new Error('admin ' + t); }) };
  });

  it('401 sem usuário', async () => {
    supabaseClientMock = { ...auth(null), from: vi.fn() };
    expect((await callPost()).status).toBe(401);
  });

  it('marca a CALL agendada como completed e grava reuniao_realizada', async () => {
    const res = await callPost();
    expect(res.status).toBe(200);
    expect(actUpdateSpy).toHaveBeenCalled(); // completou a activity existente
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    expect((cf.reuniao_realizada as { realizada: boolean }).realizada).toBe(true);
  });

  it('sem activity_id → cria MEETING completed', async () => {
    dealRow = { ...dealRow, custom_fields: {} };
    const res = await callPost();
    expect(res.status).toBe(200);
    expect(actInsertSpy).toHaveBeenCalledOnce();
    expect((actInsertSpy.mock.calls[0][0] as { type: string }).type).toBe('MEETING');
  });

  it('idempotente: já realizada → 200 sem regravar', async () => {
    dealRow = { ...dealRow, custom_fields: { reuniao_realizada: { realizada: true } } };
    const res = await callPost();
    expect(res.status).toBe(200);
    expect(dealUpdateSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar**

Create `app/api/deals/[dealId]/meeting-held/route.ts`:

```ts
/**
 * POST /api/deals/[dealId]/meeting-held — par positivo do No-show.
 * Marca a CALL agendada como completed (métrica de reuniões realizadas) e grava
 * custom_fields.reuniao_realizada. NÃO move de board. Idempotente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

export const maxDuration = 30;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id, organization_id, owner_id, custom_fields')
    .eq('id', dealId)
    .single();
  if (dealErr || !deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });

  const existingCf = (deal.custom_fields as Record<string, unknown> | null) ?? {};
  const already = existingCf.reuniao_realizada as { realizada?: boolean } | undefined;
  if (already?.realizada) return NextResponse.json({ dealId, already_marked: true }, { status: 200 });

  const nowIso = new Date().toISOString();
  const admin = createStaticAdminClient();
  const orgId = deal.organization_id as string;
  const ownerId = (deal.owner_id as string | null) ?? user.id;
  const agendada = existingCf.reuniao_agendada as { activity_id?: string } | undefined;

  if (agendada?.activity_id) {
    await admin.from('activities').update({ completed: true }).eq('id', agendada.activity_id);
  } else {
    // Lead sem agendamento da Ana (indicação/orgânico) → MEETING completed (não colide com índice de CALL).
    await admin.from('activities').insert({
      organization_id: orgId, deal_id: dealId, owner_id: ownerId,
      type: 'MEETING', title: 'Reunião realizada', description: 'Marcada manualmente pelo consultor',
      date: nowIso, completed: true,
    });
  }

  const { error: updErr } = await supabase
    .from('deals')
    .update({
      custom_fields: { ...existingCf, reuniao_realizada: { realizada: true, at: nowIso, by: user.id } },
      updated_at: nowIso,
    })
    .eq('id', dealId);
  if (updErr) {
    if ((updErr as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Conflito ao marcar reunião.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to mark meeting held' }, { status: 500 });
  }

  return NextResponse.json({ dealId, marked: true }, { status: 200 });
}
```

- [ ] **Step 4: Rodar e ver passar** → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/deals/[dealId]/meeting-held/route.ts test/meetingHeldRoute.test.ts
git commit -m "feat: add meeting-held route (par do no-show)"
```

### Task F4.2: Hook `useMarkMeetingHeld`

**Files:**
- Create: `lib/query/hooks/useMarkMeetingHeld.ts`
- Modify: `lib/query/hooks/index.ts`

- [ ] **Step 1: Implementar** — clone de `useMarkNoShow.ts`, invalidando `DEALS_VIEW_KEY` + `queryKeys.activities.all`:

Create `lib/query/hooks/useMarkMeetingHeld.ts`:

```ts
/**
 * Mutation: marca "Reunião realizada" num deal (par positivo do No-show).
 * POST /api/deals/[dealId]/meeting-held → completa a CALL agendada + grava
 * custom_fields.reuniao_realizada. NÃO move de board.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEALS_VIEW_KEY, queryKeys } from '../index';

interface MarkMeetingHeldInput { dealId: string; }
interface MarkMeetingHeldResult { dealId: string; marked?: boolean; already_marked?: boolean; }

export function useMarkMeetingHeld() {
  const queryClient = useQueryClient();
  return useMutation<MarkMeetingHeldResult, Error, MarkMeetingHeldInput>({
    mutationFn: async ({ dealId }) => {
      const res = await fetch(`/api/deals/${dealId}/meeting-held`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!res.ok) {
        let message = 'Falha ao marcar reunião realizada';
        try { const e = (await res.json()) as { error?: string }; if (e?.error) message = e.error; } catch { /* noop */ }
        throw new Error(message);
      }
      return (await res.json()) as MarkMeetingHeldResult;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    },
  });
}
```

- [ ] **Step 2: Exportar no barrel** — em `lib/query/hooks/index.ts`, ao lado do `useMarkNoShow`:

```ts
export { useMarkMeetingHeld } from './useMarkMeetingHeld';
```

- [ ] **Step 3: Typecheck** → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/query/hooks/useMarkMeetingHeld.ts lib/query/hooks/index.ts
git commit -m "feat: add useMarkMeetingHeld hook"
```

### Task F4.3: Botão no DealCard + fiação no KanbanBoard

**Files:**
- Modify: `features/boards/components/Kanban/DealCard.tsx`
- Modify: `features/boards/components/Kanban/KanbanBoard.tsx`

- [ ] **Step 1: DealCard — prop + handler + botão.** Em `DealCardProps` (após `onMarkNoShow?`), adicionar:

```tsx
  /** Marca reunião realizada (par do no-show). Só no board do Consultor. */
  onMarkMeetingHeld?: (deal: DealView) => void;
```

Importar `CalendarCheck` de `lucide-react` (junto de `PhoneMissed`). Adicionar estado + handler perto do `handleMarkNoShow` (L142–161):

```tsx
  const [isMarkingHeld, setIsMarkingHeld] = useState(false);
  const handleMarkMeetingHeld = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onMarkMeetingHeld || isMarkingHeld) return;
    const ok = window.confirm('Marcar reunião como realizada?');
    if (!ok) return;
    setIsMarkingHeld(true);
    onMarkMeetingHeld(deal);
    setTimeout(() => setIsMarkingHeld(false), 10000);
  };
```

Adicionar o botão ao lado do de no-show (após o bloco `{onMarkNoShow && (…)}`, ~L450):

```tsx
          {onMarkMeetingHeld && (
            <button
              type="button"
              onClick={handleMarkMeetingHeld}
              onMouseDown={e => e.stopPropagation()}
              disabled={isMarkingHeld}
              title="Marcar reunião realizada"
              aria-label={`Marcar reunião realizada de ${deal.title}`}
              className="p-1 rounded-full text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CalendarCheck size={14} aria-hidden="true" />
            </button>
          )}
```

- [ ] **Step 2: KanbanBoard — hook + handler + gating.** Importar o hook (L9):

```tsx
import { useMarkMeetingHeld } from '@/lib/query/hooks/useMarkMeetingHeld';
```

Chamar o hook perto de `markNoShowMutate` (L126):

```tsx
  const { mutate: markMeetingHeldMutate } = useMarkMeetingHeld();
```

Handler perto de `handleMarkNoShow` (L209):

```tsx
  const handleMarkMeetingHeld = useCallback(
    (deal: DealView) => {
      markMeetingHeldMutate(
        { dealId: deal.id },
        { onError: (err) => window.alert(err instanceof Error ? err.message : 'Não foi possível marcar a reunião.') },
      );
    },
    [markMeetingHeldMutate],
  );
```

Fiação no card (ao lado de `onMarkNoShow`, ~L356):

```tsx
                    onMarkMeetingHeld={boardId === CONSULTOR_BOARD_ID ? handleMarkMeetingHeld : undefined}
```

- [ ] **Step 3: Typecheck + lint** → PASS.

- [ ] **Step 4: Verificação (preview)** — abrir o board do Consultor e confirmar os DOIS botões (âmbar no-show + verde reunião) nos cards. Clicar no verde num card de teste → toast/sucesso, card mantém board (não move) e a barra "Realizadas" (F5) incrementa.

- [ ] **Step 5: Commit**

```bash
git add features/boards/components/Kanban/DealCard.tsx features/boards/components/Kanban/KanbanBoard.tsx
git commit -m "feat: add Reunião realizada button on kanban card (F4)"
```

### Task F4.4: Botão no header do card aberto (DealDetailModal)

**Files:**
- Modify: `features/boards/components/Modals/DealDetailModal.tsx`

- [ ] **Step 1: Importar o hook + ícone** — perto dos imports de hooks e `CheckCircle2`/`Calendar` já presentes:

```ts
import { useMarkMeetingHeld } from '@/lib/query/hooks/useMarkMeetingHeld';
import { CalendarCheck } from 'lucide-react';
```

- [ ] **Step 2: Instanciar o hook** perto dos outros hooks de mutation no componente:

```ts
  const markMeetingHeld = useMarkMeetingHeld();
```

- [ ] **Step 3: Botão no cluster do header** — antes do botão "Preparar" (~L584), gated ao board do Consultor:

```tsx
                {deal.boardId === CONSULTOR_BOARD_ID && (
                  <button
                    onClick={() => {
                      if (window.confirm('Marcar reunião como realizada?')) markMeetingHeld.mutate({ dealId: deal.id });
                    }}
                    disabled={markMeetingHeld.isPending}
                    className="ml-2 px-3 py-1.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    title="Marcar reunião realizada"
                  >
                    <CalendarCheck size={14} aria-hidden="true" />
                    <span className="hidden sm:inline">Reunião realizada</span>
                  </button>
                )}
```

Importar `CONSULTOR_BOARD_ID` de `@/lib/config/boards` se ainda não estiver importado no arquivo.

- [ ] **Step 4: Typecheck + lint** → PASS.

- [ ] **Step 5: Commit**

```bash
git add features/boards/components/Modals/DealDetailModal.tsx
git commit -m "feat: add Reunião realizada button in deal modal header (F4)"
```

### Task F4.5: Auto-marcar realizada no `apply`

**Files:**
- Modify: `app/api/deals/[dealId]/call-outcome/apply/route.ts`
- Modify: `test/callOutcomeApplyRoute.test.ts`

- [ ] **Step 1: Estender o teste** — no `fechou`, esperar `custom_fields.reuniao_realizada.realizada===true`; num `remarcar`, esperar ausência de `reuniao_realizada`. Adicionar:

```ts
  it('fechou → marca reuniao_realizada no apply', async () => {
    await callPost(baseBody());
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    expect((cf.reuniao_realizada as { realizada: boolean }).realizada).toBe(true);
  });
  it('remarcar → NÃO marca reuniao_realizada', async () => {
    await callPost(baseBody({ desfecho: { desfecho: 'remarcar', nota_resumo: 'x', tarefas: [], dados_negocio: { operadora: null, vidas: null, valor: null }, objecoes: [], motivo_perda: null, motivo_perda_detalhe: null, reabordar_em: null, confidence: 0.7 } }));
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    expect(cf.reuniao_realizada).toBeUndefined();
  });
```

- [ ] **Step 2: Rodar e ver falhar** → FAIL.

- [ ] **Step 3: Implementar** — em `apply/route.ts`, ao montar `nextCf` (depois do `call_outcome_applied_at`), adicionar:

```ts
  const marcaRealizada = d.desfecho !== 'remarcar' && d.desfecho !== 'nao_atendeu';
  if (marcaRealizada) {
    nextCf.reuniao_realizada = { realizada: true, at: enviadoEm, by: user.id };
  }
```

E, se houver `reuniao_agendada.activity_id`, completar a CALL agendada via admin (após o `.update`):

```ts
  if (marcaRealizada) {
    const agendada = existingCf.reuniao_agendada as { activity_id?: string } | undefined;
    if (agendada?.activity_id) {
      await admin.from('activities').update({ completed: true }).eq('id', agendada.activity_id);
    }
  }
```

- [ ] **Step 4: Rodar e ver passar** → `pnpm vitest run test/callOutcomeApplyRoute.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/deals/[dealId]/call-outcome/apply/route.ts test/callOutcomeApplyRoute.test.ts
git commit -m "feat: auto-mark reuniao_realizada on apply (F4)"
```

---

# FASE F5 — Métrica de reuniões no dashboard

**Entregável:** seção "Reuniões" (Agendadas / Realizadas / No-show) no dashboard, client-side.

### Task F5.1: `ReunioesMetricsSection`

**Files:**
- Create: `features/dashboard/components/ReunioesMetricsSection.tsx`
- Modify: `features/dashboard/DashboardPage.tsx`

> Fonte: `activities type IN ('CALL','MEETING') AND completed=true AND deleted_at IS NULL` no período (Realizadas). Agendadas = activities `type='CALL'` no período. No-show = deals com `custom_fields.no_show` (via a mesma query de deals do dashboard). Client-side com `useActivities({ dateFrom, dateTo })` + `periodToDateRange`. Espelha o `MetricCard`/header de `MessagingMetricsSection`.

- [ ] **Step 1: Implementar**

Create `features/dashboard/components/ReunioesMetricsSection.tsx`:

```tsx
'use client';

import React, { useMemo } from 'react';
import { CalendarCheck, CalendarClock, PhoneMissed } from 'lucide-react';
import { useActivities } from '@/lib/query/hooks';
import { periodToDateRange } from '@/lib/utils/periodToDateRange';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';

function MetricCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4">
      <div className={`flex items-center gap-2 ${color}`}>{icon}<span className="text-xs font-bold uppercase tracking-wider">{label}</span></div>
      <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

export function ReunioesMetricsSection({ period }: { period: PeriodFilter }) {
  const { start, end } = useMemo(() => periodToDateRange(period), [period]);
  const { data: activities } = useActivities({ dateFrom: start, dateTo: end });

  const { agendadas, realizadas } = useMemo(() => {
    const list = activities ?? [];
    return {
      agendadas: list.filter((a) => a.type === 'CALL').length,
      realizadas: list.filter((a) => (a.type === 'CALL' || a.type === 'MEETING') && a.completed).length,
    };
  }, [activities]);

  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Reuniões</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard icon={<CalendarClock size={16} />} label="Agendadas" value={agendadas} color="text-blue-600" />
        <MetricCard icon={<CalendarCheck size={16} />} label="Realizadas" value={realizadas} color="text-emerald-600" />
        <MetricCard icon={<PhoneMissed size={16} />} label="No-show" value={Math.max(0, agendadas - realizadas)} color="text-amber-600" />
      </div>
    </section>
  );
}
```

> Nota: "No-show" aqui é derivado (agendadas − realizadas) como aproximação client-side; a contagem exata por `custom_fields.no_show` fica pro relatório F6 (RPC sobre deals). Se a Thalita quiser exato já em F5, trocar por uma contagem de deals com `no_show` da view de deals.

- [ ] **Step 2: Renderizar no DashboardPage** — em `features/dashboard/DashboardPage.tsx`, importar e inserir logo após `<MessagingMetricsSection period={period} />` (~L292):

```tsx
import { ReunioesMetricsSection } from '@/features/dashboard/components/ReunioesMetricsSection';
```
```tsx
        <ReunioesMetricsSection period={period} />
```

- [ ] **Step 3: Typecheck + lint** → PASS.

- [ ] **Step 4: Verificação (preview)** — abrir o dashboard e conferir a seção "Reuniões" com os 3 cards renderizando números coerentes com as activities do período.

- [ ] **Step 5: Commit**

```bash
git add features/dashboard/components/ReunioesMetricsSection.tsx features/dashboard/DashboardPage.tsx
git commit -m "feat: add Reuniões metrics section to dashboard (F5)"
```

---

# FASE F6 — Relatório do funil (RPC + tela + CSV)

**Entregável:** RPC `get_funnel_report` (grupos A–F em JSONB), hook, tela com filtro período/consultor e export CSV. **Depende só da captura já feita.**

### Task F6.1: Migração `get_funnel_report`

**Files:**
- Create: `supabase/migrations/<YYYYMMDDHHMMSS>_get_funnel_report.sql`

> Molde: `supabase/migrations/20260208100000_messaging_metrics_columns.sql` (RPC `get_messaging_metrics`, L74–224) — mesmo guard de org (`auth.uid()` na `profiles`), clamp de 365 dias, `SECURITY DEFINER`, retorno JSONB. Trocar as agregações de mensageria pelos grupos A–F sobre `deals` + `activities`.

- [ ] **Step 1: Escrever a migração** (usar timestamp real via `date +%Y%m%d%H%M%S`):

```sql
-- get_funnel_report: relatório do funil (grupos A-F) em JSONB.
-- Molde: get_messaging_metrics. Auth via profiles/auth.uid(); clamp 365d.
CREATE OR REPLACE FUNCTION get_funnel_report(
  p_org_id UUID,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ DEFAULT NOW(),
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ := GREATEST(p_start, NOW() - INTERVAL '365 days');
  v_agendadas INT;
  v_realizadas INT;
  v_vendas INT;
  v_receita NUMERIC;
  v_vidas INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COUNT(*) INTO v_agendadas FROM activities a
    WHERE a.organization_id = p_org_id AND a.type = 'CALL' AND a.deleted_at IS NULL
      AND a.date BETWEEN v_start AND p_end
      AND (p_user_id IS NULL OR a.owner_id = p_user_id);

  SELECT COUNT(*) INTO v_realizadas FROM activities a
    WHERE a.organization_id = p_org_id AND a.type IN ('CALL','MEETING') AND a.completed = true AND a.deleted_at IS NULL
      AND a.date BETWEEN v_start AND p_end
      AND (p_user_id IS NULL OR a.owner_id = p_user_id);

  SELECT COUNT(*), COALESCE(SUM(d.value), 0),
         COALESCE(SUM((d.custom_fields->'qualificacao'->>'vidas')::INT), 0)
    INTO v_vendas, v_receita, v_vidas
    FROM deals d
    WHERE d.organization_id = p_org_id AND d.is_won = true AND d.deleted_at IS NULL
      AND d.closed_at BETWEEN v_start AND p_end
      AND (p_user_id IS NULL OR d.owner_id = p_user_id);

  RETURN jsonb_build_object(
    'volume', jsonb_build_object('agendadas', v_agendadas, 'realizadas', v_realizadas, 'vendas', v_vendas),
    'conversao', jsonb_build_object(
      'show_rate', CASE WHEN v_agendadas > 0 THEN ROUND(v_realizadas::NUMERIC / v_agendadas, 3) ELSE 0 END,
      'close_rate', CASE WHEN v_realizadas > 0 THEN ROUND(v_vendas::NUMERIC / v_realizadas, 3) ELSE 0 END
    ),
    'receita', jsonb_build_object('total', v_receita, 'vidas', v_vidas),
    'diagnostico', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
        SELECT d.custom_fields->'motivo_perda'->>'categoria' AS motivo, COUNT(*) AS n
        FROM deals d
        WHERE d.organization_id = p_org_id AND d.is_lost = true AND d.deleted_at IS NULL
          AND d.closed_at BETWEEN v_start AND p_end
          AND d.custom_fields->'motivo_perda'->>'categoria' IS NOT NULL
          AND (p_user_id IS NULL OR d.owner_id = p_user_id)
        GROUP BY 1 ORDER BY 2 DESC
      ) t
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_funnel_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;
```

- [ ] **Step 2: Aplicar a migração** — via Supabase MCP `apply_migration` (nome `get_funnel_report`) OU `supabase db push`. Confirmar sem erro e testar:

```sql
SELECT get_funnel_report('<org_id>', NOW() - INTERVAL '30 days', NOW(), NULL);
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/*_get_funnel_report.sql
git commit -m "feat: add get_funnel_report RPC (funnel groups A-F)"
```

### Task F6.2: Hook + tela + CSV

**Files:**
- Create: `lib/query/hooks/useFunnelReportQuery.ts`
- Create: `features/dashboard/components/FunnelReportSection.tsx`
- Modify: `features/dashboard/DashboardPage.tsx`

- [ ] **Step 1: Hook** — molde `useMessagingMetricsQuery.ts`:

Create `lib/query/hooks/useFunnelReportQuery.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { periodToDateRange } from '@/lib/utils/periodToDateRange';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';

export interface FunnelReport {
  volume: { agendadas: number; realizadas: number; vendas: number };
  conversao: { show_rate: number; close_rate: number };
  receita: { total: number; vidas: number };
  diagnostico: Array<{ motivo: string; n: number }>;
}

export function useFunnelReportQuery(period: PeriodFilter, userId?: string) {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const { start, end } = periodToDateRange(period);
  return useQuery<FunnelReport>({
    queryKey: ['funnelReport', orgId, period, userId],
    enabled: !!orgId && !!supabase,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase!.rpc('get_funnel_report', {
        p_org_id: orgId, p_start: start, p_end: end, p_user_id: userId ?? null,
      });
      if (error) throw error;
      return data as FunnelReport;
    },
  });
}
```

- [ ] **Step 2: Tela + CSV** — usar `stringifyCsv` de `@/lib/utils/csv` (visto no teste `lib/utils/csv.test.ts`). Botão "Exportar CSV" gera linhas dos grupos e dispara download via Blob.

Create `features/dashboard/components/FunnelReportSection.tsx`:

```tsx
'use client';

import React from 'react';
import { Download } from 'lucide-react';
import { useFunnelReportQuery } from '@/lib/query/hooks/useFunnelReportQuery';
import { stringifyCsv } from '@/lib/utils/csv';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';

export function FunnelReportSection({ period }: { period: PeriodFilter }) {
  const { data, isLoading } = useFunnelReportQuery(period);
  if (isLoading || !data) return null;

  const exportCsv = () => {
    const rows: string[][] = [
      ['metrica', 'valor'],
      ['agendadas', String(data.volume.agendadas)],
      ['realizadas', String(data.volume.realizadas)],
      ['vendas', String(data.volume.vendas)],
      ['show_rate', String(data.conversao.show_rate)],
      ['close_rate', String(data.conversao.close_rate)],
      ['receita_total', String(data.receita.total)],
      ['vidas_fechadas', String(data.receita.vidas)],
      ...data.diagnostico.map((m) => [`perda_${m.motivo}`, String(m.n)]),
    ];
    const blob = new Blob([stringifyCsv(rows, ',')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `funil-${period}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Relatório do funil</h2>
        <button onClick={exportCsv} className="text-xs font-bold text-primary-600 flex items-center gap-1.5">
          <Download size={14} /> Exportar CSV
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Stat label="Show rate" value={`${Math.round(data.conversao.show_rate * 100)}%`} />
        <Stat label="Close rate" value={`${Math.round(data.conversao.close_rate * 100)}%`} />
        <Stat label="Receita fechada" value={`R$ ${data.receita.total.toLocaleString('pt-BR')}`} />
        <Stat label="Vidas fechadas" value={String(data.receita.vidas)} />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4">
      <p className="text-xs text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}
```

- [ ] **Step 3: Renderizar no DashboardPage** — após a seção Reuniões:

```tsx
import { FunnelReportSection } from '@/features/dashboard/components/FunnelReportSection';
```
```tsx
        <FunnelReportSection period={period} />
```

- [ ] **Step 4: Typecheck + lint + verificação (preview)** → conferir os cards e o download do CSV.

- [ ] **Step 5: Commit**

```bash
git add lib/query/hooks/useFunnelReportQuery.ts features/dashboard/components/FunnelReportSection.tsx features/dashboard/DashboardPage.tsx
git commit -m "feat: add funnel report section + CSV export (F6)"
```

---

## Fechamento (após F6)

- [ ] `pnpm precheck:fast` (lint + typecheck + test:run) → PASS (falhas pré-existentes de ambiente não contam; nenhum teste novo falhando).
- [ ] Smoke manual ponta-a-ponta no card de teste da Thalita (`+5511910312432`): gravar 30s → revisar → confirmar → ver nota + tarefas na timeline + card movido (fechou→Implantação) + "Reunião realizada" na métrica.
- [ ] Deploy só depois do go-live combinado (branch `feat/lead-intake-route`, NÃO `main`).

---

## Self-Review (checklist do autor)

**Cobertura do spec:**
- §2 fluxo ponta-a-ponta → F1 (gravar/transcrever) + F2 (revisar/aplicar) + F3 (rotear) + F4 (realizada). ✅
- §4.1 UI mic + card de revisão → F1.6/F1.7 + F2.6. ✅
- §4.2 upload → F1.3 (server-side, corrige o client-only do dealFiles). ✅
- §4.3 transcrição → F1.2. ✅
- §4.4 extração + schema → F2.2/F2.3. ✅
- §4.5 rota transcrição → F1.4 (+ F2.4 extração). ✅
- §4.6 rota apply atômica → F2.5 + F3.3 + F4.5. ✅
- §4.7 botão realizada → F4. ✅
- §4.8 métricas → F5 (agora) + F6 (relatório). ✅
- §4.9 taxonomia → F2.1 + F2.7 (Ana) + schema do consultor. ✅
- §5 deltas de dados → cobertos (custom_fields spread, activities, voice_calls). ✅
- §6/§6.1 mapa + reabordagem → F3.2/F3.3. ✅
- §7 gotchas → todos endereçados (REPLACE spread; Gemini structured; índice CALL→TASK/MEETING; webm sem conversão; @google/genai instalado; barrel; maxDuration 60; voice_calls FORCE RLS via admin; activity_id nulo→MEETING; modelo 2.5). ✅
- §9 testes → cada módulo testado (schema, routing, transcribe, rotas, taxonomia). ✅

**Placeholders:** nenhum "TODO/implement later" de plano — o único TODO é o UUID de Negociação, com passo explícito (F3.1) e query pra obtê-lo (proibido inventar UUID). ✅

**Consistência de tipos:** `Desfecho`/`DesfechoSchema`, `MotivoTag`/`MotivoTagSchema`, `TranscribeResult`, `Route`, `routeForDesfecho`/`reabordarEmFallback`, `uploadDealAudioServer`, `useTranscribeCallOutcome`/`useApplyCallOutcome`/`useMarkMeetingHeld` — nomes usados igualzinho entre as tasks. ✅

**Riscos a validar durante a execução (não bloqueiam o plano):**
1. `deal_files` ter (ou não) `organization_id` → passo de verificação em F1.3.
2. `OrgAIConfig` ser exportado como type → nota em F2.3.
3. Testes existentes que assertam `objecoes: string[]` → atualizar em F2.7.
4. Policies de Storage do bucket `deal-files` para o admin client (deve passar com service role).
