# Motor de follow-up da Ana (cadências 1 & 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reengajar automaticamente leads da Ana que pararam de responder — cadência FRIA (nunca respondeu, roteiro fixo) e QUENTE (engajou e sumiu, IA na voz da Ana) — dirigidas por um cron de 15 min (pg_cron+pg_net).

**Architecture:** Lógica de decisão em funções PURAS (`schedule.ts`) e copy em módulos próprios (`copy.ts`, `generate.ts`); um orquestrador com dependências INJETADAS (`run.ts`) testável com mocks + relógio fixo; um endpoint fino (`route.ts`) que só faz auth + gate de horário + injeta as deps reais; e uma migration que agenda o cron. Detecção reusa colunas/triggers existentes (`first_response_at`, `last_message_direction`).

**Tech Stack:** Next.js 16 (route handler `GET`), Supabase (`@supabase/supabase-js`, service-role admin client), Vercel AI SDK (`ai` — `generateText`), Vitest 4, pg_cron 1.6.4 + pg_net 0.20.0.

**Spec:** `docs/superpowers/specs/2026-07-13-followup-cadencias-ana-design.md`.

**Comandos:** testes = `npx vitest run test/followup/`; checagem = `npm run typecheck && npm run lint && npm run test:run`.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/ai/followup/schedule.ts` (criar) | PURO: tipos, schedules, classificação fria/quente, âncora, "toque devido", reset, avanço de estado. |
| `lib/ai/followup/copy.ts` (criar) | Copy fria fixa (bolhas), fallback quente, tag, render (`{nome}` + join `\n\n`). |
| `lib/ai/followup/generate.ts` (criar) | Toque quente por IA (irmão de `first-touch.ts`), retorna bolhas ou `null`. |
| `lib/ai/followup/run.ts` (criar) | Orquestrador com deps injetadas: busca elegíveis → decide → envia → persiste. |
| `app/api/cron/lead-followup/route.ts` (reescrever) | Fino: auth `CRON_SECRET` + gate de horário comercial + injeta deps reais. |
| `supabase/migrations/20260713140000_lead_followup_cron.sql` (criar) | Agenda o cron via pg_cron chamando o endpoint por pg_net. |
| `test/followup/schedule.test.ts` (criar) | Unit das funções puras. |
| `test/followup/copy.test.ts` (criar) | Unit da copy/render. |
| `test/followup/run.test.ts` (criar) | Orquestrador com supabase mockado + relógio fixo. |
| `test/followup/route.test.ts` (criar) | Auth 401 do endpoint. |

**Constantes canônicas (confirmadas no banco 2026-07-13):**
- `ANA_SDR_BOARD_ID = 'c2e36157-1b63-43cc-be35-bb1cab7a287f'`
- `STAGE_NOVO_LEAD = '1e8026b1-88ef-4daa-bc06-fb12b2dceff7'`
- `STAGE_EM_QUALIFICACAO = '3128e500-7182-406a-a095-f7f7c5e772ac'`

---

## Task 1: `schedule.ts` — lógica pura de cadência

**Files:**
- Create: `lib/ai/followup/schedule.ts`
- Test: `test/followup/schedule.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/followup/schedule.test.ts
import { describe, it, expect } from 'vitest';
import {
  classifyCadence, scheduleFor, computeAnchor, initState, nextDueTouch,
  advanceState, isReengaged, COLD_SCHEDULE_MS, WARM_SCHEDULE_MS,
  type FollowupState,
} from '@/lib/ai/followup/schedule';

const anchor = '2026-07-13T13:00:00.000Z';
const anchorMs = Date.parse(anchor);

describe('classifyCadence', () => {
  it('sem first_response_at => cold', () => expect(classifyCadence(null)).toBe('cold'));
  it('com first_response_at => warm', () => expect(classifyCadence('2026-07-13T12:00:00Z')).toBe('warm'));
});

describe('computeAnchor', () => {
  it('cold usa first_touch.sent_at quando existe', () => {
    expect(computeAnchor({ cadence: 'cold', firstTouchSentAt: anchor, lastMessageAt: '2026-07-13T18:00:00Z' })).toBe(anchor);
  });
  it('cold sem first_touch cai no last_message_at', () => {
    expect(computeAnchor({ cadence: 'cold', firstTouchSentAt: null, lastMessageAt: anchor })).toBe(anchor);
  });
  it('warm sempre usa last_message_at', () => {
    expect(computeAnchor({ cadence: 'warm', firstTouchSentAt: '2026-01-01T00:00:00Z', lastMessageAt: anchor })).toBe(anchor);
  });
});

describe('nextDueTouch', () => {
  const cold = (count: number): FollowupState => initState('cold', anchor) && { cadence: 'cold', anchor_at: anchor, count, stopped: false };
  it('não devido antes da janela', () => {
    const now = new Date(anchorMs + COLD_SCHEDULE_MS[0] - 1000);
    expect(nextDueTouch(cold(0), now)).toBeNull();
  });
  it('devido no toque 0 quando a janela passou', () => {
    const now = new Date(anchorMs + COLD_SCHEDULE_MS[0] + 1000);
    expect(nextDueTouch(cold(0), now)).toEqual({ touchIndex: 0, isLast: false });
  });
  it('último toque marca isLast', () => {
    const now = new Date(anchorMs + COLD_SCHEDULE_MS[3] + 1000);
    expect(nextDueTouch(cold(3), now)).toEqual({ touchIndex: 3, isLast: true });
  });
  it('count >= schedule.length => null', () => {
    const now = new Date(anchorMs + 999 * 3600_000);
    expect(nextDueTouch(cold(4), now)).toBeNull();
  });
  it('stopped => null', () => {
    const now = new Date(anchorMs + 999 * 3600_000);
    expect(nextDueTouch({ cadence: 'cold', anchor_at: anchor, count: 1, stopped: true }, now)).toBeNull();
  });
  it('warm toque 0 devido em +15min', () => {
    const now = new Date(anchorMs + WARM_SCHEDULE_MS[0] + 1000);
    expect(nextDueTouch({ cadence: 'warm', anchor_at: anchor, count: 0, stopped: false }, now)).toEqual({ touchIndex: 0, isLast: false });
  });
});

describe('advanceState', () => {
  it('incrementa count e não para no meio', () => {
    const s = advanceState({ cadence: 'cold', anchor_at: anchor, count: 0, stopped: false }, new Date(anchorMs));
    expect(s.count).toBe(1);
    expect(s.stopped).toBe(false);
  });
  it('para (stopped=max_touches) no último toque', () => {
    const s = advanceState({ cadence: 'warm', anchor_at: anchor, count: 2, stopped: false }, new Date(anchorMs));
    expect(s.count).toBe(3);
    expect(s.stopped).toBe(true);
    expect(s.stopped_reason).toBe('max_touches');
  });
});

describe('isReengaged', () => {
  it('inbound depois da âncora => true', () => expect(isReengaged(anchor, '2026-07-13T13:00:01Z')).toBe(true));
  it('inbound antes da âncora => false', () => expect(isReengaged(anchor, '2026-07-13T12:59:59Z')).toBe(false));
  it('sem inbound => false', () => expect(isReengaged(anchor, null)).toBe(false));
});

describe('scheduleFor', () => {
  it('cold tem 4 toques, warm tem 3', () => {
    expect(scheduleFor('cold')).toHaveLength(4);
    expect(scheduleFor('warm')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/followup/schedule.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/followup/schedule'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/followup/schedule.ts
/**
 * Lógica PURA do motor de follow-up da Ana (cadências fria/quente).
 * Sem I/O — testável isoladamente. Ver spec 2026-07-13-followup-cadencias-ana-design.md.
 */

export type Cadence = 'cold' | 'warm';

export interface FollowupState {
  cadence: Cadence;
  anchor_at: string;            // ISO UTC, congelado na 1ª detecção
  count: number;                // toques já enviados (0 = nenhum)
  last_sent_at?: string | null;
  stopped?: boolean;
  stopped_reason?: string | null;
}

const H = 60 * 60 * 1000;
const MIN = 60 * 1000;

// Offsets a partir da âncora (ms). 4 toques frios / 3 quentes.
export const COLD_SCHEDULE_MS = [3 * H, 24 * H, 96 * H, 240 * H]; // +3h, +1d, +4d, +10d
export const WARM_SCHEDULE_MS = [15 * MIN, 24 * H, 120 * H];       // +15min, +1d, +5d

export function scheduleFor(cadence: Cadence): number[] {
  return cadence === 'cold' ? COLD_SCHEDULE_MS : WARM_SCHEDULE_MS;
}

export function classifyCadence(firstResponseAt: string | null | undefined): Cadence {
  return firstResponseAt ? 'warm' : 'cold';
}

export function computeAnchor(params: {
  cadence: Cadence;
  firstTouchSentAt?: string | null;
  lastMessageAt: string;
}): string {
  if (params.cadence === 'cold' && params.firstTouchSentAt) return params.firstTouchSentAt;
  return params.lastMessageAt;
}

export function initState(cadence: Cadence, anchorAt: string): FollowupState {
  return { cadence, anchor_at: anchorAt, count: 0, last_sent_at: null, stopped: false, stopped_reason: null };
}

export interface TouchDecision {
  touchIndex: number; // == state.count
  isLast: boolean;    // este envio atinge o máximo
}

export function nextDueTouch(state: FollowupState, now: Date): TouchDecision | null {
  if (state.stopped) return null;
  const schedule = scheduleFor(state.cadence);
  if (state.count >= schedule.length) return null;
  const dueMs = Date.parse(state.anchor_at) + schedule[state.count];
  if (Number.isNaN(dueMs) || now.getTime() < dueMs) return null;
  return { touchIndex: state.count, isLast: state.count + 1 >= schedule.length };
}

export function advanceState(state: FollowupState, sentAt: Date): FollowupState {
  const nextCount = state.count + 1;
  const isLast = nextCount >= scheduleFor(state.cadence).length;
  return {
    ...state,
    count: nextCount,
    last_sent_at: sentAt.toISOString(),
    stopped: isLast,
    stopped_reason: isLast ? 'max_touches' : (state.stopped_reason ?? null),
  };
}

export function isReengaged(anchorAt: string, latestInboundAt: string | null | undefined): boolean {
  if (!latestInboundAt) return false;
  return Date.parse(latestInboundAt) > Date.parse(anchorAt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/followup/schedule.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/followup/schedule.ts test/followup/schedule.test.ts
git commit -m "feat(followup): logica pura de cadencia (schedule)"
```

---

## Task 2: `copy.ts` — copy fria fixa + fallback quente + render

**Files:**
- Create: `lib/ai/followup/copy.ts`
- Test: `test/followup/copy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/followup/copy.test.ts
import { describe, it, expect } from 'vitest';
import { COLD_TOUCHES, WARM_FALLBACK, WARM_FIXED_LAST_INDEX, FOLLOWUP_TAG, renderBubbles, firstName } from '@/lib/ai/followup/copy';
import { COLD_SCHEDULE_MS, WARM_SCHEDULE_MS } from '@/lib/ai/followup/schedule';

describe('estrutura da copy', () => {
  it('tem 1 bloco de copy por toque de cada schedule', () => {
    expect(COLD_TOUCHES).toHaveLength(COLD_SCHEDULE_MS.length);
    expect(WARM_FALLBACK).toHaveLength(WARM_SCHEDULE_MS.length);
  });
  it('o último toque quente é o índice fixo', () => {
    expect(WARM_FIXED_LAST_INDEX).toBe(WARM_SCHEDULE_MS.length - 1);
  });
  it('sem emoji e sem travessão na copy fria', () => {
    const all = COLD_TOUCHES.flat().join(' ') + WARM_FALLBACK.join(' ');
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
  it('a tag é sem-resposta', () => expect(FOLLOWUP_TAG).toBe('sem-resposta'));
});

describe('renderBubbles', () => {
  it('interpola {nome} e junta bolhas com linha em branco', () => {
    const out = renderBubbles(['Oi {nome}, tudo bem?', 'Segunda bolha.'], 'Maria Silva');
    expect(out).toBe('Oi Maria, tudo bem?\n\nSegunda bolha.');
  });
  it('sem nome, limpa a pontuação órfã', () => {
    const out = renderBubbles(['Oi {nome}, consegue falar?'], null);
    expect(out).toBe('Oi, consegue falar?');
  });
});

describe('firstName', () => {
  it('pega só o primeiro nome', () => expect(firstName('João Pedro Souza')).toBe('João'));
  it('trata vazio', () => expect(firstName(null)).toBe(''));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/followup/copy.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai/followup/copy'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/followup/copy.ts
/**
 * Copy dos toques de follow-up. FRIA = roteiro fixo (ângulos de valor). QUENTE = IA
 * (ver generate.ts), com estas linhas como fallback. Bolhas curtas, sem emoji, sem
 * travessão, "consultor" (nunca "vendedor"). Aprovado pela Thalita em 2026-07-13.
 */

export const FOLLOWUP_TAG = 'sem-resposta';

// Cada toque = array de bolhas. renderBubbles junta com '\n\n' para o splitIntoBubbles
// do sendAIResponse mandar cada uma como uma mensagem separada (estilo WhatsApp).
export const COLD_TOUCHES: string[][] = [
  // Toque 1 (+3h) — reabre a porta
  [
    'Oi {nome}, consegue falar por aqui?',
    'Já vou adiantando seu caso pro consultor pra ele chegar certeiro quando for te ligar.',
  ],
  // Toque 2 (+1 dia) — você nos procurou por um motivo
  [
    '{nome}, você chegou até a gente porque tem algo pra resolver no seu plano de saúde.',
    'É exatamente isso que a gente faz: entende o seu caso e acha a melhor saída pra você e sua família.',
    'Consigo te reservar 15 minutos com um consultor pra isso.',
  ],
  // Toque 3 (+4 dias) — reajuste composto
  [
    '{nome}, um detalhe que quase ninguém nota: todo ano no mesmo plano seu valor sobe, mesmo sem usar.',
    'Dá pra revisar isso antes do próximo reajuste, e normalmente sobra dinheiro no seu bolso.',
  ],
  // Toque 4 (+10 dias) — despedida
  [
    '{nome}, não vou insistir à toa.',
    'Paro por aqui, mas quando quiser resolver seu plano é só me chamar. Fico à disposição.',
  ],
];

// Fallback do toque quente (usado quando a IA falha) — uma bolha por toque.
export const WARM_FALLBACK: string[] = [
  '{nome}, ainda por aí? Podemos continuar de onde paramos.',
  '{nome}, consigo agilizar seu atendimento com o consultor. Quer que eu já organize?',
  '{nome}, vou pausar por aqui. Quando quiser retomar, é só responder.',
];

// O último toque quente (despedida) é SEMPRE fixo — não chama a IA.
export const WARM_FIXED_LAST_INDEX = WARM_FALLBACK.length - 1;

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Interpola {nome}, limpa pontuação órfã, e junta as bolhas com linha em branco. */
export function renderBubbles(bubbles: string[], name: string | null | undefined): string {
  const first = firstName(name);
  return bubbles
    .map((b) =>
      b.replaceAll('{nome}', first).replace(/\s{2,}/g, ' ').replace(/\s+([,!?.])/g, '$1').trim()
    )
    .filter(Boolean)
    .join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/followup/copy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/followup/copy.ts test/followup/copy.test.ts
git commit -m "feat(followup): copy fria fixa + fallback quente + render"
```

---

## Task 3: `generate.ts` — toque quente por IA

**Files:**
- Create: `lib/ai/followup/generate.ts`
- Test: `test/followup/generate.test.ts`

- [ ] **Step 1: Write the failing test** (cobre o caminho de fallback — sem config de IA → null)

```ts
// test/followup/generate.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ai/agent/agent.service', () => ({
  getOrgAIConfig: vi.fn(async () => null), // sem config => generate deve devolver null
}));
vi.mock('@/lib/ai/config', () => ({ getModel: vi.fn(() => ({})) }));

import { generateWarmFollowupBubbles } from '@/lib/ai/followup/generate';

function fakeSupabase() {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } as never;
}

describe('generateWarmFollowupBubbles', () => {
  it('sem config de IA => null (o chamador usa o fallback fixo)', async () => {
    const out = await generateWarmFollowupBubbles({
      supabase: fakeSupabase(), organizationId: 'org-1', boardId: 'b-1',
      conversationId: 'c-1', firstName: 'Ana', touchIndex: 0,
    });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/followup/generate.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write the implementation** (espelha `lib/ai/lead-intake/first-touch.ts`)

```ts
// lib/ai/followup/generate.ts
/**
 * Toque QUENTE por IA — irmão de lead-intake/first-touch.ts. Lê o histórico da conversa
 * + persona da Ana e escreve o próximo toque RETOMANDO de onde o lead parou. Best-effort:
 * qualquer falha/vazio => retorna null e o chamador usa o fallback fixo (copy.ts).
 */
import { generateText } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModel } from '@/lib/ai/config';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';

function warmTask(touchIndex: number): string {
  const foco =
    touchIndex === 0
      ? 'Toque 1 (logo após o silêncio): leve, reabre a porta e retoma a última pergunta pendente.'
      : 'Toque 2: reforce o VALOR ancorado no que o lead já disse (reajuste composto, carência ou reembolso).';
  return `## TAREFA: FOLLOW-UP (WhatsApp)
Um lead da Niva ENGAJOU na conversa e parou de responder. Escreva o próximo toque da Ana para reengajar.
Regras:
- NÃO re-cumprimente nem se re-apresente (já está no meio da conversa).
- Retome DE ONDE PAROU: use o que o lead já disse; refaça a última pergunta pendente.
- Objetivo é marcar 30 min com o consultor. Nunca "cotação".
- ${foco}
- Bolhas curtas: uma ideia por LINHA (1 a 3 linhas). Sem emojis, sem travessão, sem markdown, sem aspas.
- Devolva SÓ as bolhas, uma por linha.`;
}

export async function generateWarmFollowupBubbles(opts: {
  supabase: SupabaseClient;
  organizationId: string;
  boardId: string;
  conversationId: string;
  firstName: string | null;
  touchIndex: number;
}): Promise<string[] | null> {
  try {
    const aiConfig = await getOrgAIConfig(opts.supabase, opts.organizationId);
    if (!aiConfig) return null;

    let persona = '';
    try {
      const { data: cfg } = await opts.supabase
        .from('board_ai_config')
        .select('persona_prompt')
        .eq('board_id', opts.boardId)
        .maybeSingle();
      persona = (cfg?.persona_prompt as string | null) || '';
    } catch {
      /* segue sem persona */
    }

    const { data: msgs } = await opts.supabase
      .from('messaging_messages')
      .select('direction, content, created_at')
      .eq('conversation_id', opts.conversationId)
      .order('created_at', { ascending: false })
      .limit(12);

    const history = (msgs ?? [])
      .slice()
      .reverse()
      .map((m) => {
        const who = (m.direction as string) === 'inbound' ? 'Lead' : 'Ana';
        const text = ((m.content as { text?: string } | null)?.text ?? '').toString().trim();
        return text ? `${who}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');

    const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
    const result = await generateText({
      model,
      system: [persona, warmTask(opts.touchIndex)].filter(Boolean).join('\n\n'),
      prompt:
        `Primeiro nome do lead: ${opts.firstName || '(não informado)'}\n\n` +
        `Conversa até agora (mais antiga -> mais recente):\n${history || '(sem histórico legível)'}\n\n` +
        `Escreva o próximo toque agora, uma bolha por linha.`,
      maxRetries: 2,
    });

    const bubbles = result.text.split('\n').map((s) => s.trim()).filter(Boolean);
    return bubbles.length >= 1 ? bubbles : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/followup/generate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/followup/generate.ts test/followup/generate.test.ts
git commit -m "feat(followup): toque quente por IA (generate) + fallback"
```

---

## Task 4: `run.ts` — orquestrador (deps injetadas)

**Files:**
- Create: `lib/ai/followup/run.ts`
- Test: `test/followup/run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/followup/run.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runLeadFollowup, type FollowupDeps } from '@/lib/ai/followup/run';
import { COLD_SCHEDULE_MS } from '@/lib/ai/followup/schedule';

const NOW = new Date('2026-07-13T20:00:00.000Z');
const OLD = new Date(NOW.getTime() - COLD_SCHEDULE_MS[0] - 60_000).toISOString(); // > +3h atrás

/**
 * Supabase fake: builder "thenable" que resolve com config[table] no await, qualquer
 * que seja o encadeamento de filtros. deals.update(...).eq(...) registra em dealUpdates.
 */
function makeSupabase(cfg: {
  deals: any[]; conversations: any[]; contacts: any[]; inbound?: any[];
}) {
  const dealUpdates: Array<{ id: string; patch: any }> = [];
  function thenable(rows: any[]) {
    const b: any = {};
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit']) b[m] = () => b;
    b.then = (res: (v: any) => void) => res({ data: rows, error: null });
    return b;
  }
  const client: any = {
    from(table: string) {
      if (table === 'deals') {
        return {
          ...thenable(cfg.deals),
          update: (patch: any) => ({ eq: async (_c: string, id: string) => { dealUpdates.push({ id, patch }); return { error: null }; } }),
        };
      }
      if (table === 'messaging_conversations') return thenable(cfg.conversations);
      if (table === 'contacts') return thenable(cfg.contacts);
      if (table === 'messaging_messages') return thenable(cfg.inbound ?? []);
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client, dealUpdates };
}

function baseDeps(over: Partial<FollowupDeps>, supa: any): FollowupDeps {
  return {
    supabase: supa,
    now: NOW,
    sendResponse: vi.fn(async () => ({ success: true })),
    generateWarm: vi.fn(async () => null),
    ...over,
  };
}

describe('runLeadFollowup', () => {
  it('lead frio com âncora vencida => envia toque 0 e persiste count=1', async () => {
    const { client, dealUpdates } = makeSupabase({
      deals: [{ id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'novo', custom_fields: { lead_form: { first_touch: { sent_at: OLD } } }, tags: [] }],
      conversations: [{ id: 'cv1', contact_id: 'c1', first_response_at: null, last_message_at: OLD, last_message_direction: 'outbound', metadata: {} }],
      contacts: [{ id: 'c1', name: 'Maria Silva', ai_paused: false }],
    });
    const send = vi.fn(async () => ({ success: true }));
    const r = await runLeadFollowup(baseDeps({ sendResponse: send }, client));
    expect(r.processed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [, msg] = send.mock.calls[0];
    expect(msg).toContain('Oi Maria, consegue falar por aqui?');
    expect(dealUpdates[0].patch.custom_fields.followup.count).toBe(1);
  });

  it('pula contato com ai_paused', async () => {
    const { client } = makeSupabase({
      deals: [{ id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'novo', custom_fields: {}, tags: [] }],
      conversations: [{ id: 'cv1', contact_id: 'c1', first_response_at: null, last_message_at: OLD, last_message_direction: 'outbound', metadata: {} }],
      contacts: [{ id: 'c1', name: 'Maria', ai_paused: true }],
    });
    const send = vi.fn(async () => ({ success: true }));
    const r = await runLeadFollowup(baseDeps({ sendResponse: send }, client));
    expect(send).not.toHaveBeenCalled();
    expect(r.skipped).toBeGreaterThanOrEqual(1);
  });

  it('não devido (âncora recente) => não envia', async () => {
    const recent = new Date(NOW.getTime() - 60_000).toISOString();
    const { client } = makeSupabase({
      deals: [{ id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'novo', custom_fields: { lead_form: { first_touch: { sent_at: recent } } }, tags: [] }],
      conversations: [{ id: 'cv1', contact_id: 'c1', first_response_at: null, last_message_at: recent, last_message_direction: 'outbound', metadata: {} }],
      contacts: [{ id: 'c1', name: 'Maria', ai_paused: false }],
    });
    const send = vi.fn(async () => ({ success: true }));
    await runLeadFollowup(baseDeps({ sendResponse: send }, client));
    expect(send).not.toHaveBeenCalled();
  });

  it('reengajado (inbound novo) => reseta o followup e não reenvia o toque velho', async () => {
    const { client, dealUpdates } = makeSupabase({
      deals: [{ id: 'd1', organization_id: 'org', contact_id: 'c1', stage_id: 'em-qual', custom_fields: { followup: { cadence: 'cold', anchor_at: OLD, count: 2, stopped: false } }, tags: [] }],
      conversations: [{ id: 'cv1', contact_id: 'c1', first_response_at: '2026-07-13T10:00:00Z', last_message_at: new Date(NOW.getTime() - 5 * 60_000).toISOString(), last_message_direction: 'outbound', metadata: {} }],
      contacts: [{ id: 'c1', name: 'Maria', ai_paused: false }],
      inbound: [{ conversation_id: 'cv1', created_at: new Date(NOW.getTime() - 6 * 60_000).toISOString() }], // depois da âncora OLD
    });
    const send = vi.fn(async () => ({ success: true }));
    const r = await runLeadFollowup(baseDeps({ sendResponse: send }, client));
    expect(send).not.toHaveBeenCalled();       // toque quente 0 só vence em +15min
    expect(r.reset).toBe(1);
    expect(dealUpdates[0].patch.custom_fields.followup.count).toBe(0); // estado resetado persistido
    expect(dealUpdates[0].patch.custom_fields.followup.cadence).toBe('warm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/followup/run.test.ts`
Expected: FAIL — módulo `run` não existe.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ai/followup/run.ts
/**
 * Orquestrador do follow-up (deps INJETADAS p/ testabilidade). Busca deals elegíveis na
 * board da Ana, decide o toque devido por cadência, envia e persiste o estado em
 * custom_fields.followup. O route.ts injeta as deps reais (admin client, sendAIResponse,
 * geração quente, relógio). Ver spec 2026-07-13-followup-cadencias-ana-design.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyCadence, computeAnchor, initState, nextDueTouch, advanceState, isReengaged,
  type FollowupState,
} from './schedule';
import { COLD_TOUCHES, WARM_FALLBACK, WARM_FIXED_LAST_INDEX, FOLLOWUP_TAG, renderBubbles } from './copy';

export const ANA_SDR_BOARD_ID = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';
export const STAGE_NOVO_LEAD = '1e8026b1-88ef-4daa-bc06-fb12b2dceff7';
export const STAGE_EM_QUALIFICACAO = '3128e500-7182-406a-a095-f7f7c5e772ac';
const BATCH_SIZE = 40;

export interface FollowupDeps {
  supabase: SupabaseClient;
  now: Date;
  sendResponse: (conversationId: string, message: string) => Promise<{ success: boolean }>;
  generateWarm: (args: {
    organizationId: string; boardId: string; conversationId: string; firstName: string | null; touchIndex: number;
  }) => Promise<string[] | null>;
}

export interface FollowupResult { processed: number; failed: number; skipped: number; reset: number; }

type CF = Record<string, unknown>;

export async function runLeadFollowup(deps: FollowupDeps): Promise<FollowupResult> {
  const { supabase, now } = deps;
  const res: FollowupResult = { processed: 0, failed: 0, skipped: 0, reset: 0 };

  // 1. Deals candidatos na board da Ana (abertos, em novo-lead/em-qualificacao).
  const { data: deals } = await supabase
    .from('deals')
    .select('id, organization_id, contact_id, stage_id, custom_fields, tags')
    .eq('board_id', ANA_SDR_BOARD_ID)
    .in('stage_id', [STAGE_NOVO_LEAD, STAGE_EM_QUALIFICACAO])
    .eq('is_won', false)
    .eq('is_lost', false)
    .is('deleted_at', null)
    .not('contact_id', 'is', null)
    .limit(BATCH_SIZE * 4);

  const candidates = (deals ?? []).filter((d) => {
    const fu = ((d.custom_fields as CF | null)?.followup ?? {}) as FollowupState;
    return fu.stopped !== true;
  });
  if (candidates.length === 0) return res;

  const contactIds = [...new Set(candidates.map((d) => d.contact_id as string))];

  // 2. Conversa mais recente por contato (última fala nossa).
  const { data: convs } = await supabase
    .from('messaging_conversations')
    .select('id, contact_id, first_response_at, last_message_at, last_message_direction, metadata')
    .in('contact_id', contactIds)
    .eq('last_message_direction', 'outbound')
    .order('last_message_at', { ascending: false });

  const convByContact = new Map<string, any>();
  for (const c of convs ?? []) {
    const cid = c.contact_id as string | null;
    if (!cid || convByContact.has(cid)) continue; // ordenado desc => 1º = mais recente
    if (((c.metadata as CF | null) ?? {}).ai_paused === true) continue;
    convByContact.set(cid, c);
  }
  if (convByContact.size === 0) return res;

  // 3. Contatos (nome + ai_paused).
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, ai_paused')
    .in('id', [...convByContact.keys()]);
  const contactById = new Map((contacts ?? []).map((c) => [c.id as string, c]));

  // 4. Último inbound por conversa (reset de reengajamento).
  const convIds = [...convByContact.values()].map((c) => c.id as string);
  const { data: inbound } = await supabase
    .from('messaging_messages')
    .select('conversation_id, created_at')
    .in('conversation_id', convIds)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false });
  const latestInboundByConv = new Map<string, string>();
  for (const m of inbound ?? []) {
    const k = m.conversation_id as string;
    if (!latestInboundByConv.has(k)) latestInboundByConv.set(k, m.created_at as string);
  }

  for (const deal of candidates) {
    const contactId = deal.contact_id as string;
    const conv = convByContact.get(contactId);
    const contact = contactById.get(contactId);
    if (!conv || !contact || contact.ai_paused) { res.skipped++; continue; }

    const cf = (deal.custom_fields as CF | null) ?? {};
    const existing = cf.followup as FollowupState | undefined;
    const cadence = classifyCadence(conv.first_response_at as string | null);

    // Reset de reengajamento: inbound mais novo que a âncora atual.
    let state: FollowupState;
    let wasReset = false;
    if (existing && isReengaged(existing.anchor_at, latestInboundByConv.get(conv.id))) {
      state = initState(cadence, computeAnchor({ cadence, firstTouchSentAt: null, lastMessageAt: conv.last_message_at as string }));
      wasReset = true;
    } else if (existing) {
      state = existing;
    } else {
      const firstTouchSentAt = (((cf.lead_form as CF | null)?.first_touch as CF | null)?.sent_at as string | null) ?? null;
      state = initState(cadence, computeAnchor({ cadence, firstTouchSentAt, lastMessageAt: conv.last_message_at as string }));
    }

    const decision = nextDueTouch(state, now);
    if (!decision) {
      if (wasReset) { await persistFollowup(supabase, deal.id as string, cf, state, false); res.reset++; }
      else res.skipped++;
      continue;
    }

    // Renderiza a mensagem do toque.
    const name = (contact.name as string | null) ?? null;
    let message: string;
    if (state.cadence === 'cold') {
      message = renderBubbles(COLD_TOUCHES[decision.touchIndex], name);
    } else if (decision.touchIndex === WARM_FIXED_LAST_INDEX) {
      message = renderBubbles([WARM_FALLBACK[decision.touchIndex]], name);
    } else {
      const ai = await deps.generateWarm({
        organizationId: deal.organization_id as string, boardId: ANA_SDR_BOARD_ID,
        conversationId: conv.id as string, firstName: name, touchIndex: decision.touchIndex,
      });
      message = ai && ai.length ? ai.join('\n\n') : renderBubbles([WARM_FALLBACK[decision.touchIndex]], name);
    }

    const sent = await deps.sendResponse(conv.id as string, message);
    if (!sent.success) { res.failed++; continue; } // não avança o estado; tenta de novo no próximo run

    const advanced = advanceState(state, now);
    await persistFollowup(supabase, deal.id as string, cf, advanced, advanced.stopped === true, (deal.tags as string[] | null) ?? []);
    res.processed++;
    if (wasReset) res.reset++;
  }

  return res;
}

async function persistFollowup(
  supabase: SupabaseClient, dealId: string, existingCf: CF, state: FollowupState, addTag: boolean, tags: string[] = []
): Promise<void> {
  const patch: CF = { custom_fields: { ...existingCf, followup: state }, updated_at: new Date().toISOString() };
  if (addTag) patch.tags = [...new Set([...tags, FOLLOWUP_TAG])];
  const { error } = await supabase.from('deals').update(patch).eq('id', dealId);
  if (error) console.error('[followup] persist falhou p/ deal', dealId, error);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/followup/run.test.ts`
Expected: PASS (4 casos).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/followup/run.ts test/followup/run.test.ts
git commit -m "feat(followup): orquestrador com deps injetadas (run)"
```

---

## Task 5: reescrever o endpoint `route.ts` (fino)

**Files:**
- Modify (rewrite): `app/api/cron/lead-followup/route.ts`
- Test: `test/followup/route.test.ts`

- [ ] **Step 1: Write the failing test** (auth 401 — o núcleo já é testado em run.test.ts)

```ts
// test/followup/route.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock dos imports "server-only"/pesados p/ o route.ts carregar sob o Vitest.
// O caminho de 401 retorna ANTES de usar qualquer um deles.
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => ({}) }));
vi.mock('@/lib/ai/agent/agent.service', () => ({ sendAIResponse: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/ai/followup/generate', () => ({ generateWarmFollowupBubbles: vi.fn(async () => null) }));

import { GET } from '@/app/api/cron/lead-followup/route';

beforeAll(() => { process.env.CRON_SECRET = 'segredo-teste'; });

describe('GET /api/cron/lead-followup (auth)', () => {
  it('401 sem Bearer correto', async () => {
    const req = new Request('https://x/api/cron/lead-followup', { headers: { Authorization: 'Bearer errado' } });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/followup/route.test.ts`
Expected: FAIL — o route atual ainda é o rascunho antigo (assinatura diferente / lógica 4h). Pode passar por acaso no 401; confirme reescrevendo no passo 3 e rodando de novo.

- [ ] **Step 3: Write the implementation** (substitui TODO o conteúdo do arquivo)

```ts
// app/api/cron/lead-followup/route.ts
/**
 * GET /api/cron/lead-followup
 *
 * Reengaja leads da Ana que pararam de responder (cadência fria e quente). Protegido por
 * CRON_SECRET (Bearer). Chamado a cada 15 min pelo pg_cron (migration
 * 20260713140000_lead_followup_cron.sql). Este endpoint é a AUTORIDADE do horário comercial.
 *
 * Núcleo em lib/ai/followup/run.ts (testado isoladamente). Aqui: auth + gate de horário +
 * injeção das deps reais (admin client, sendAIResponse, geração quente, relógio).
 */
import { createStaticAdminClient } from '@/lib/supabase/server';
import { sendAIResponse } from '@/lib/ai/agent/agent.service';
import { runLeadFollowup } from '@/lib/ai/followup/run';
import { generateWarmFollowupBubbles } from '@/lib/ai/followup/generate';

export const maxDuration = 60;

const BUSINESS_HOURS = { start: '08:00', end: '17:30', daysOfWeek: [1, 2, 3, 4, 5] };
const TZ_OFFSET_HOURS = -3; // America/Sao_Paulo, offset fixo (igual à lib/ai/scheduling)

function isWithinBusinessHours(now: Date): boolean {
  const local = new Date(now.getTime() + TZ_OFFSET_HOURS * 60 * 60 * 1000);
  const day = local.getUTCDay();
  if (!BUSINESS_HOURS.daysOfWeek.includes(day)) return false;
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const [sH, sM] = BUSINESS_HOURS.start.split(':').map(Number);
  const [eH, eM] = BUSINESS_HOURS.end.split(':').map(Number);
  return minutes >= sH * 60 + sM && minutes <= eH * 60 + eM;
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export async function GET(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) return json({ error: 'Unauthorized' }, 401);

  const now = new Date();
  if (!isWithinBusinessHours(now)) return json({ skipped: true, reason: 'Fora do horário comercial' });

  const supabase = createStaticAdminClient();
  const result = await runLeadFollowup({
    supabase,
    now,
    sendResponse: (conversationId, message) =>
      sendAIResponse({ supabase, conversationId, response: message }).then((r) => ({ success: r.success })),
    generateWarm: (args) => generateWarmFollowupBubbles({ supabase, ...args }),
  });

  console.log('[Cron:lead-followup]', JSON.stringify(result));
  return json(result);
}
```

- [ ] **Step 4: Run test + full checagem**

Run: `npx vitest run test/followup/ && npm run typecheck && npm run lint`
Expected: PASS; tsc e lint limpos. (Confirme que `createStaticAdminClient` é exportado por `@/lib/supabase/server` — é o mesmo import do intake `app/api/public/v1/leads/route.ts`.)

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/lead-followup/route.ts test/followup/route.test.ts
git commit -m "feat(followup): endpoint fino (auth + gate horario + injeta deps)"
```

---

## Task 6: migration pg_cron + pg_net

**Files:**
- Create: `supabase/migrations/20260713140000_lead_followup_cron.sql`

- [ ] **Step 1: Write the migration** (idempotente; graceful se pg_cron estiver off)

```sql
-- 20260713140000_lead_followup_cron.sql
-- Agenda o cron de follow-up (a cada 15 min) chamando o endpoint via pg_net.
-- PRÉ-REQUISITOS DE RUNBOOK (fora desta migration):
--   1) Habilitar pg_cron no dashboard: Database > Extensions (pg_net já está instalado).
--   2) Criar os secrets no Vault:
--        select vault.create_secret('https://nossocrm-wheat.vercel.app/api/cron/lead-followup', 'lead_followup_url');
--        select vault.create_secret('<CRON_SECRET de producao>', 'cron_secret');
-- Aplicar esta migration é seguro mesmo antes dos secrets: eles são lidos quando o job DISPARA.

-- Idempotência: remove um agendamento anterior, se houver.
DO $$
BEGIN
  PERFORM cron.unschedule('lead-followup');
EXCEPTION WHEN OTHERS THEN
  NULL; -- não existia (ou pg_cron off): segue
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'lead-followup',
    '*/15 * * * *', -- a cada 15 min; o endpoint filtra o horário comercial
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
  RAISE NOTICE 'pg_cron indisponivel — habilite a extensao no dashboard e reaplique esta migration';
END $$;
```

- [ ] **Step 2: Sanidade local**

Run: `git add supabase/migrations/20260713140000_lead_followup_cron.sql`
(Não aplicar ainda — a aplicação é passo de rollout, Task 7, contra o banco de produção via MCP/CLI.)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(followup): migration pg_cron+pg_net (a cada 15 min)"
```

---

## Task 7: rollout / smoke (runbook — sem código novo)

**Files:** nenhum (operação). Marque cada item ao concluir.

- [ ] **Step 1: Checagem completa local**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: verdes (as 13 falhas pré-existentes da suíte geral — se aparecerem — não são deste trabalho; confira que `test/followup/*` está 100%).

- [ ] **Step 2: Habilitar pg_cron (1×)** no projeto `nossocrmv2` (`htmgjcelsnldxjbygfcw`): Supabase Dashboard → Database → Extensions → habilitar `pg_cron`. (pg_net já está.)

- [ ] **Step 3: Criar os secrets no Vault** (SQL, via MCP `execute_sql` ou dashboard):

```sql
select vault.create_secret('https://nossocrm-wheat.vercel.app/api/cron/lead-followup', 'lead_followup_url');
select vault.create_secret('<valor real do CRON_SECRET em producao>', 'cron_secret');
```
(Confirmar que `CRON_SECRET` está setado nas envs de produção da Vercel — o mesmo valor.)

- [ ] **Step 4: Deploy do código** (push da branch pra main):

```bash
git push origin feat/lead-intake-route:main
```
Aguardar o deploy READY na Vercel.

- [ ] **Step 5: Aplicar a migration** contra produção (MCP `apply_migration` com o conteúdo do arquivo, ou Supabase CLI).

- [ ] **Step 6: Smoke manual** — verificar o cron e um toque real:

```sql
-- job agendado?
select jobid, jobname, schedule, active from cron.job where jobname = 'lead-followup';
-- execuções recentes (após alguns minutos, em horário comercial):
select status, return_message, start_time from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname='lead-followup')
  order by start_time desc limit 5;
```
Em um deal de teste na board da Ana com `last_message_direction='outbound'` e âncora vencida (nº da Thalita +5511910312432): conferir a mensagem no WhatsApp + `custom_fields.followup.count` incrementado. Se o lead responder, a conversa vira `inbound` e o próximo run não toca mais.

- [ ] **Step 7: Atualizar docs** — marcar B1 como ✅ em `niva-workspace/crm-roadmap.md` e anotar no HANDOFF + memória `estrategia-follow-up-cadencias-ana` (cadências 1 e 2 no ar; cadência 3 anti-no-show é o próximo fast-follow no mesmo motor).

---

## Self-Review

**Cobertura do spec:**
- §5 detecção (board/stages/first_response_at/last_message_direction) → Task 4 (`run.ts` queries) ✓
- §6 estado `custom_fields.followup` → Task 1 (tipos) + Task 4 (`persistFollowup`, spread) ✓
- §7 âncoras + schedules → Task 1 (`computeAnchor`, `COLD/WARM_SCHEDULE_MS`, `nextDueTouch`) ✓
- §8 copy híbrida → Task 2 (fria fixa + fallback) + Task 3 (quente IA) ✓
- §9 envio (`\n\n` → bolhas) → Task 4 (`join('\n\n')` / `renderBubbles`) ✓
- §10 paradas + reset → Task 1 (`advanceState`, `isReengaged`) + Task 4 (reset + tag) ✓
- §11 admin client + auth + gate → Task 5 (`createStaticAdminClient`, Bearer, `isWithinBusinessHours`) ✓
- §12 pg_cron+pg_net + Vault → Task 6 + Task 7 ✓
- §13 testes → Tasks 1–5 ✓
- §14 rollout → Task 7 ✓

**Placeholders:** apenas `<CRON_SECRET de producao>` no runbook (intencional — segredo real, nunca commitado). Nenhum TODO/TBD em código.

**Consistência de tipos:** `FollowupState` (Task 1) usado igual em `run.ts` (Task 4); `renderBubbles`/`COLD_TOUCHES: string[][]` (Task 2) casam com o uso em `run.ts`; `FollowupDeps.generateWarm` (Task 4) casa com a assinatura de `generateWarmFollowupBubbles` (Task 3, via closure no route Task 5); `sendResponse` retorna `{success}` e o route adapta `sendAIResponse` pra isso.

**Gotcha coberto:** `splitIntoBubbles` quebra em LINHA EM BRANCO (`\n\n`) e colapsa se algum segmento > 350 chars — por isso a copy junta bolhas com `\n\n` e mantém linhas curtas.
