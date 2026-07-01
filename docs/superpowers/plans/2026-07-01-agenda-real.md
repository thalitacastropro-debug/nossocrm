# Agenda Real da Ana (SDR) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a SDR de IA (Ana) cravar um horário real de ligação do consultor — lendo a disponibilidade no calendário interno do CRM (`activities`), oferecendo slots reais e criando/remarcando a reunião ao confirmar.

**Architecture:** Passo determinístico (sem function-calling). Um motor de disponibilidade puro calcula os slots livres (janela − `activities` ocupadas); o `context-builder` injeta os slots no prompt; antes de responder (só em `respond`, só na board da Niva) um detector LLM lê o aceite e um `booker` determinístico cria/cancela/remarca a `activity`, com re-check e trava única no banco. Reusa o padrão gated-por-board do `domain-extraction`.

**Tech Stack:** TypeScript, Next.js (route handlers), Supabase JS, Vercel AI SDK (`ai` + `zod`), Vitest. Fuso `America/São_Paulo` via offset fixo `-03:00` (Brasil sem DST).

**Branch:** `feat/lead-intake-route` — **NÃO mergear na `main`** (go-live acoplado ao cutover). Spec: `docs/superpowers/specs/2026-07-01-agenda-real-design.md`.

---

## File Structure

| Arquivo | Responsabilidade | Novo/Editado |
|---|---|---|
| `lib/ai/scheduling/types.ts` | Tipos compartilhados (`Slot`, `BusyInterval`, `AvailabilityConfig`, `SchedulingStatus`, `DetectResult`) | Novo |
| `lib/ai/scheduling/config.ts` | Config da Niva: board id, janela, gate `getSchedulingConfig(boardId)` | Novo |
| `lib/ai/scheduling/availability.ts` | `getAvailableSlots()` — **função pura** | Novo |
| `lib/ai/scheduling/busy.ts` | `loadBusyIntervals()` — lê `activities` ocupadas do consultor | Novo |
| `lib/ai/scheduling/detect.ts` | `detectSchedulingIntent()` — extração LLM do aceite/remarcação | Novo |
| `lib/ai/scheduling/booker.ts` | `bookSlot()` / `cancelMeeting()` — cria/cancela/remarca `activity` | Novo |
| `lib/ai/scheduling/scheduling.service.ts` | Orquestra: busy → available → detect → book; devolve status | Novo |
| `lib/ai/agent/context-builder.ts` | Injeta `## Horários disponíveis` + `## Status da reunião` | Editado |
| `lib/ai/agent/types.ts` | `LeadContext.available_slots` + `LeadContext.scheduling_status` | Editado |
| `lib/ai/agent/agent.service.ts` | Chama `scheduling.service` pré-resposta (respond + Niva) | Editado |
| `supabase/migrations/2026070100_agenda_real.sql` | Coluna `consultant_user_id` + unique index parcial | Novo |
| `docs/niva-ana-agenda-persona.sql` | UPDATE de persona no `board_ai_config` (regras de horário) | Novo |
| `test/scheduling/availability.test.ts` | Testes puros do motor | Novo |
| `test/scheduling/booker.test.ts` | Testes do booker (Supabase mockado) | Novo |
| `test/scheduling/detect-validate.test.ts` | Testes da validação determinística do aceite | Novo |

Convenções do repo (confirmadas): Vitest (`import { describe, it, expect } from 'vitest'`), alias `@/`, gating por board via registry em código (`NIVA_SDR_BOARD_ID = 'c2e36157-1b63-43cc-be35-bb1cab7a287f'`).

---

## Task 1: Tipos compartilhados

**Files:**
- Create: `lib/ai/scheduling/types.ts`

- [ ] **Step 1: Escrever os tipos**

```ts
/**
 * @fileoverview Tipos compartilhados do agendamento (agenda real da Ana).
 * @module lib/ai/scheduling/types
 */

/** Um horário oferecível ao lead. Instantes em ISO UTC; label pt-BR pro prompt. */
export interface Slot {
  /** Início do slot em ISO UTC (ex.: '2026-07-03T13:00:00.000Z' = 10h SP). */
  startIso: string;
  /** Fim do slot (start + slotMinutes) em ISO UTC. */
  endIso: string;
  /** Rótulo humano pt-BR (ex.: 'quinta, 03/07, às 10h'). */
  label: string;
}

/** Intervalo ocupado do consultor, em epoch ms (comparação numérica simples). */
export interface BusyInterval {
  startMs: number;
  endMs: number;
}

/** Config do motor de disponibilidade. */
export interface AvailabilityConfig {
  /** Offset fixo do fuso (Brasil sem DST). */
  utcOffset: '-03:00';
  /** Horas de início candidatas por dia útil. */
  candidateStartHours: number[];
  /** Duração do slot em minutos. */
  slotMinutes: number;
  /** Antecedência mínima em minutos a partir de "agora". */
  minLeadMinutes: number;
  /** Quantos dias úteis varrer pra frente. */
  horizonBusinessDays: number;
  /** Teto de slots retornados. */
  maxSlots: number;
}

/** Intenção do lead detectada na conversa. */
export interface DetectResult {
  intent: 'accept' | 'reschedule' | 'cancel' | 'none';
  /** Horário aceito/desejado em ISO UTC, se houver — deve bater com um Slot oferecido. */
  slotIso: string | null;
}

/** Status da reunião pra injetar no contexto da Ana. */
export type SchedulingStatus =
  | { kind: 'none' }
  | { kind: 'confirmed'; label: string }
  | { kind: 'slot_taken'; alternatives: Slot[] }
  | { kind: 'cancelled' };
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Projetos/nossocrm && npx tsc --noEmit`
Expected: sem erros novos referentes a `lib/ai/scheduling/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/scheduling/types.ts
git commit -m "feat(scheduling): tipos compartilhados da agenda real"
```

---

## Task 2: Config e gating por board

**Files:**
- Create: `lib/ai/scheduling/config.ts`

- [ ] **Step 1: Escrever a config + gate**

```ts
/**
 * @fileoverview Config do agendamento, gated por board (só a Niva por ora).
 * Mesmo padrão do domain-extraction/registry: quando o CRM virar multi-cliente,
 * trocar este lookup por leitura de board_ai_config.
 * @module lib/ai/scheduling/config
 */

import type { AvailabilityConfig } from './types';
import { NIVA_SDR_BOARD_ID } from '../extraction/domain/niva-health';

/** Config padrão da Niva (§2 da spec). */
export const NIVA_AVAILABILITY: AvailabilityConfig = {
  utcOffset: '-03:00',
  candidateStartHours: [9, 10, 11, 13, 14, 15, 16, 17], // 12h cai no almoço
  slotMinutes: 40,
  minLeadMinutes: 120,
  horizonBusinessDays: 5,
  maxSlots: 12,
};

export interface SchedulingConfig {
  availability: AvailabilityConfig;
}

/** Retorna config de agendamento aplicável ao board, ou null (zero impacto noutras boards). */
export function getSchedulingConfig(boardId: string | null | undefined): SchedulingConfig | null {
  if (boardId === NIVA_SDR_BOARD_ID) return { availability: NIVA_AVAILABILITY };
  return null;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Projetos/nossocrm && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/scheduling/config.ts
git commit -m "feat(scheduling): config e gate por board da Niva"
```

---

## Task 3: Motor de disponibilidade (função pura) — TDD

**Files:**
- Create: `lib/ai/scheduling/availability.ts`
- Test: `test/scheduling/availability.test.ts`

- [ ] **Step 1: Escrever os testes (falham primeiro)**

```ts
import { describe, it, expect } from 'vitest';
import { getAvailableSlots } from '@/lib/ai/scheduling/availability';
import { NIVA_AVAILABILITY } from '@/lib/ai/scheduling/config';
import type { BusyInterval } from '@/lib/ai/scheduling/types';

// Helper: instante UTC a partir de horário local SP (offset fixo -03:00).
const sp = (iso: string) => new Date(`${iso}-03:00`);
const spMs = (iso: string) => sp(iso).getTime();

// "Agora" fixo: quarta 01/07/2026, 08:00 SP (antes do expediente).
const NOW = sp('2026-07-01T08:00:00');

describe('getAvailableSlots', () => {
  it('gera 8 slots hora-cheia no primeiro dia útil, respeitando almoço (sem 12h)', () => {
    const slots = getAvailableSlots({ now: NOW, busy: [], config: NIVA_AVAILABILITY });
    const day1 = slots.filter((s) => s.startIso.startsWith('2026-07-01'));
    const horas = day1.map((s) => new Date(s.startIso).getUTCHours() - 3); // -3 => hora SP
    expect(horas).toEqual([9, 10, 11, 13, 14, 15, 16, 17]);
  });

  it('respeita antecedência mínima de 2h', () => {
    // Agora = quarta 10:30 SP → primeiro slot do dia deve ser >= 12:30 SP => 13h.
    const now = sp('2026-07-01T10:30:00');
    const slots = getAvailableSlots({ now, busy: [], config: NIVA_AVAILABILITY });
    const day1 = slots.filter((s) => s.startIso.startsWith('2026-07-01'));
    const horas = day1.map((s) => new Date(s.startIso).getUTCHours() - 3);
    expect(horas).toEqual([13, 14, 15, 16, 17]);
  });

  it('pula fim de semana (sexta → segunda)', () => {
    const now = sp('2026-07-03T17:30:00'); // sexta, tarde
    const slots = getAvailableSlots({ now, busy: [], config: NIVA_AVAILABILITY });
    const dias = Array.from(new Set(slots.map((s) => s.startIso.slice(0, 10))));
    expect(dias).not.toContain('2026-07-04'); // sábado
    expect(dias).not.toContain('2026-07-05'); // domingo
    expect(dias[0]).toBe('2026-07-06'); // segunda
  });

  it('remove slot que colide (parcial) com um busy', () => {
    // Ocupado 10:20–10:50 SP colide com o slot das 10h (10:00–10:40).
    const busy: BusyInterval[] = [
      { startMs: spMs('2026-07-01T10:20:00'), endMs: spMs('2026-07-01T10:50:00') },
    ];
    const slots = getAvailableSlots({ now: NOW, busy, config: NIVA_AVAILABILITY });
    const day1 = slots.filter((s) => s.startIso.startsWith('2026-07-01'));
    const horas = day1.map((s) => new Date(s.startIso).getUTCHours() - 3);
    expect(horas).not.toContain(10);
    expect(horas).toContain(9);
    expect(horas).toContain(11);
  });

  it('respeita o teto maxSlots', () => {
    const slots = getAvailableSlots({ now: NOW, busy: [], config: NIVA_AVAILABILITY });
    expect(slots.length).toBeLessThanOrEqual(NIVA_AVAILABILITY.maxSlots);
  });

  it('label pt-BR legível', () => {
    const slots = getAvailableSlots({ now: NOW, busy: [], config: NIVA_AVAILABILITY });
    // 01/07/2026 é quarta.
    expect(slots[0].label).toBe('quarta, 01/07, às 9h');
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/availability.test.ts`
Expected: FAIL — `getAvailableSlots` não existe.

- [ ] **Step 3: Implementar o motor**

```ts
/**
 * @fileoverview Motor de disponibilidade — função PURA.
 * Calcula slots livres = janela (dias úteis, horas candidatas) − busy − antecedência.
 * Fuso via offset fixo -03:00 (Brasil sem DST). Sem I/O, sem deps externas.
 * @module lib/ai/scheduling/availability
 */

import type { AvailabilityConfig, BusyInterval, Slot } from './types';

const WEEKDAYS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export interface GetAvailableSlotsParams {
  now: Date;
  busy: BusyInterval[];
  config: AvailabilityConfig;
}

/** ISO UTC de um horário local SP (offset fixo). ex.: buildUtc(2026,7,1,9) */
function buildUtcMs(year: number, month: number, day: number, hour: number, offset: string): number {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  return new Date(`${year}-${mm}-${dd}T${hh}:00:00${offset}`).getTime();
}

/** Dia da semana (0=dom..6=sáb) do dia SP, avaliado ao meio-dia pra evitar borda de meia-noite. */
function weekdaySp(year: number, month: number, day: number, offset: string): number {
  const noonUtc = new Date(buildUtcMs(year, month, day, 12, offset));
  return noonUtc.getUTCDay();
}

/** Componentes {year,month,day} de um instante, no fuso SP. */
function spParts(ms: number): { year: number; month: number; day: number } {
  // SP = UTC-3 → subtrai 3h e lê em UTC.
  const d = new Date(ms - 3 * 60 * 60 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function overlaps(startMs: number, endMs: number, busy: BusyInterval[]): boolean {
  return busy.some((b) => startMs < b.endMs && endMs > b.startMs);
}

export function getAvailableSlots(params: GetAvailableSlotsParams): Slot[] {
  const { now, busy, config } = params;
  const nowMs = now.getTime();
  const minStartMs = nowMs + config.minLeadMinutes * 60 * 1000;
  const slotMs = config.slotMinutes * 60 * 1000;

  const slots: Slot[] = [];
  const startParts = spParts(nowMs);
  let cursor = new Date(buildUtcMs(startParts.year, startParts.month, startParts.day, 12, config.utcOffset));
  let businessDaysSeen = 0;

  while (businessDaysSeen < config.horizonBusinessDays && slots.length < config.maxSlots) {
    const { year, month, day } = spParts(cursor.getTime());
    const dow = weekdaySp(year, month, day, config.utcOffset);
    const isBusinessDay = dow >= 1 && dow <= 5;

    if (isBusinessDay) {
      businessDaysSeen++;
      for (const hour of config.candidateStartHours) {
        if (slots.length >= config.maxSlots) break;
        const startMs = buildUtcMs(year, month, day, hour, config.utcOffset);
        const endMs = startMs + slotMs;
        if (startMs < minStartMs) continue;
        if (overlaps(startMs, endMs, busy)) continue;
        slots.push({
          startIso: new Date(startMs).toISOString(),
          endIso: new Date(endMs).toISOString(),
          label: `${WEEKDAYS_PT[dow]}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}, às ${hour}h`,
        });
      }
    }
    // Avança 1 dia (SP) — soma 24h ao cursor (meio-dia → meio-dia, seguro).
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return slots;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/availability.test.ts`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/scheduling/availability.ts test/scheduling/availability.test.ts
git commit -m "feat(scheduling): motor de disponibilidade puro + testes"
```

---

## Task 4: Migration — coluna do consultor + trava de corrida

**Files:**
- Create: `supabase/migrations/2026070100_agenda_real.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- Agenda real da Ana: consultor responsável por board + trava de corrida no calendário.

-- 1. Quem é o consultor que recebe a ligação (owner_id das activities criadas pela Ana).
ALTER TABLE public.board_ai_config
  ADD COLUMN IF NOT EXISTS consultant_user_id UUID REFERENCES public.profiles(id);

COMMENT ON COLUMN public.board_ai_config.consultant_user_id IS
  'Consultor que recebe a ligação agendada pela SDR. NULL => Ana cai no interino (só preferência).';

-- 2. Trava de corrida: impede dois leads no mesmo horário do mesmo consultor.
--    Só ligações (CALL) ativas. Colisão => o booker trata como slot_taken e re-oferece.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_consultant_call_slot
  ON public.activities (owner_id, date)
  WHERE type = 'CALL' AND deleted_at IS NULL;
```

- [ ] **Step 2: Aplicar no banco vivo (branch de dev)**

Aplicar via MCP Supabase `apply_migration` (projeto `nossocrmv2` / `htmgjcelsnldxjbygfcw`), name `agenda_real_consultant_and_slot_lock`, com o SQL acima.
Expected: sucesso; `board_ai_config.consultant_user_id` existe e `uniq_consultant_call_slot` aparece em `list_migrations`/índices.

> ⚠️ Pré-condição da trava: se já existirem 2+ activities `CALL` ativas com o MESMO `owner_id` e `date`, o índice falha. Rodar antes: `SELECT owner_id, date, count(*) FROM activities WHERE type='CALL' AND deleted_at IS NULL GROUP BY 1,2 HAVING count(*)>1;` e resolver duplicatas. (Base da Niva é nova → esperado 0.)

- [ ] **Step 3: Setar o consultor (Denilson) na board da Niva**

Descobrir o `profile_id` do Denilson e gravar:
```sql
UPDATE public.board_ai_config
SET consultant_user_id = (
  SELECT id FROM public.profiles
  WHERE organization_id = 'd9bf55f7-c66d-439b-97b2-1fceff0fa9b2'
    AND role = 'vendedor'
  ORDER BY created_at ASC LIMIT 1
)
WHERE board_id = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';
```
Expected: 1 linha atualizada; conferir que o id é o do Denilson (`SELECT consultant_user_id FROM board_ai_config WHERE board_id='c2e36157-...';` e cruzar com `profiles`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026070100_agenda_real.sql
git commit -m "feat(scheduling): migration consultant_user_id + unique slot lock"
```

---

## Task 5: Booker (cria/cancela/remarca) — TDD com Supabase mockado

**Files:**
- Create: `lib/ai/scheduling/booker.ts`
- Test: `test/scheduling/booker.test.ts`

Interface:
```ts
export interface BookSlotParams {
  supabase: SupabaseClient;
  dealId: string;
  contactId: string | null;
  organizationId: string;
  consultantUserId: string;
  leadName: string;
  summary: string;            // ex.: "Tier ouro · 3 vidas · paga R$6.000"
  slot: Slot;                 // horário validado (∈ grid) a marcar
  previousActivityId?: string | null; // se remarcação: cancela esta antes
}
export interface BookSlotResult {
  ok: boolean;
  activityId?: string;
  reason?: 'taken' | 'db_error';
}
```

Regras: (a) se `previousActivityId`, marca `deleted_at` nela primeiro (remarcação); (b) INSERT `activities` (`type='CALL'`); (c) violação da unique (`code === '23505'`) → `{ ok:false, reason:'taken' }`; (d) outro erro → `{ ok:false, reason:'db_error' }`; (e) sucesso → grava `deals.custom_fields.reuniao_agendada` + tag `reuniao:agendada`. `cancelMeeting` marca `deleted_at` e seta `status:'cancelada'`.

- [ ] **Step 1: Escrever os testes (falham primeiro)**

```ts
import { describe, it, expect, vi } from 'vitest';
import { bookSlot } from '@/lib/ai/scheduling/booker';
import type { Slot } from '@/lib/ai/scheduling/types';

const slot: Slot = {
  startIso: '2026-07-03T13:00:00.000Z',
  endIso: '2026-07-03T13:40:00.000Z',
  label: 'quinta, 03/07, às 10h',
};

// Supabase fake: activities.insert configurável + deals select/update.
function makeSupabase(opts: { insertError?: { code: string } | null } = {}) {
  const state: any = { insertedActivity: null, dealUpdate: null, deletedIds: [] };
  const client: any = {
    from(table: string) {
      if (table === 'activities') {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: async () => {
                if (opts.insertError) return { data: null, error: opts.insertError };
                state.insertedActivity = { id: 'act-1', ...row };
                return { data: { id: 'act-1' }, error: null };
              },
            }),
          }),
          update: (patch: any) => ({
            eq: async (_c: string, id: string) => {
              state.deletedIds.push({ id, patch });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'deals') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { custom_fields: {}, tags: [] }, error: null }) }) }),
          update: (patch: any) => ({ eq: async () => { state.dealUpdate = patch; return { error: null }; } }),
        };
      }
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client, state };
}

const base = {
  dealId: 'deal-1', contactId: 'c-1', organizationId: 'org-1',
  consultantUserId: 'u-den', leadName: 'João', summary: 'Tier ouro', slot,
};

describe('bookSlot', () => {
  it('sucesso: cria activity CALL e grava reuniao_agendada + tag', async () => {
    const { client, state } = makeSupabase();
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(true);
    expect(r.activityId).toBe('act-1');
    expect(state.insertedActivity.type).toBe('CALL');
    expect(state.insertedActivity.owner_id).toBe('u-den');
    expect(state.insertedActivity.date).toBe(slot.startIso);
    expect(state.dealUpdate.custom_fields.reuniao_agendada.status).toBe('confirmada');
    expect(state.dealUpdate.tags).toContain('reuniao:agendada');
  });

  it('corrida: unique violation (23505) => taken, sem gravar deal', async () => {
    const { client, state } = makeSupabase({ insertError: { code: '23505' } });
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('taken');
    expect(state.dealUpdate).toBeNull();
  });

  it('erro de banco genérico => db_error', async () => {
    const { client } = makeSupabase({ insertError: { code: '08006' } });
    const r = await bookSlot({ supabase: client, ...base });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('db_error');
  });

  it('remarcação: cancela a activity anterior antes de criar a nova', async () => {
    const { client, state } = makeSupabase();
    const r = await bookSlot({ supabase: client, ...base, previousActivityId: 'act-old' });
    expect(r.ok).toBe(true);
    expect(state.deletedIds.some((d: any) => d.id === 'act-old' && d.patch.deleted_at)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/booker.test.ts`
Expected: FAIL — `bookSlot` não existe.

- [ ] **Step 3: Implementar o booker**

```ts
/**
 * @fileoverview Booker determinístico da agenda real: cria/cancela/remarca a
 * reunião como `activity` (type CALL) e grava o estado no deal. Sem LLM.
 * @module lib/ai/scheduling/booker
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Slot } from './types';

export interface BookSlotParams {
  supabase: SupabaseClient;
  dealId: string;
  contactId: string | null;
  organizationId: string;
  consultantUserId: string;
  leadName: string;
  summary: string;
  slot: Slot;
  previousActivityId?: string | null;
}

export interface BookSlotResult {
  ok: boolean;
  activityId?: string;
  reason?: 'taken' | 'db_error';
}

export async function bookSlot(params: BookSlotParams): Promise<BookSlotResult> {
  const { supabase, dealId, contactId, organizationId, consultantUserId, leadName, summary, slot } = params;

  // Remarcação: cancela a anterior antes de criar a nova.
  if (params.previousActivityId) {
    await supabase
      .from('activities')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', params.previousActivityId);
  }

  // Cria a ligação. A unique index (owner_id, date) WHERE type='CALL' é a trava de corrida.
  const { data: act, error: insErr } = await supabase
    .from('activities')
    .insert({
      title: `Ligação diagnóstica — ${leadName}`,
      description: summary,
      type: 'CALL',
      date: slot.startIso,
      completed: false,
      deal_id: dealId,
      contact_id: contactId,
      owner_id: consultantUserId,
      organization_id: organizationId,
      participant_contact_ids: contactId ? [contactId] : null,
    })
    .select('id')
    .single();

  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') return { ok: false, reason: 'taken' };
    console.error('[Booker] insert falhou:', insErr);
    return { ok: false, reason: 'db_error' };
  }

  // Grava o estado no deal (merge no custom_fields + tag).
  const { data: deal } = await supabase
    .from('deals')
    .select('custom_fields, tags')
    .eq('id', dealId)
    .single();

  const customFields = (deal?.custom_fields as Record<string, unknown>) || {};
  const prevTags = Array.isArray(deal?.tags) ? (deal!.tags as unknown[]).map(String) : [];
  const tags = Array.from(new Set([...prevTags, 'reuniao:agendada']));

  const { error: updErr } = await supabase
    .from('deals')
    .update({
      custom_fields: {
        ...customFields,
        reuniao_agendada: {
          data_hora: slot.startIso,
          activity_id: act!.id,
          status: 'confirmada',
          criada_em: new Date().toISOString(),
        },
      },
      tags,
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);

  if (updErr) {
    console.error('[Booker] update do deal falhou (activity criada):', updErr);
    // A activity existe; devolvemos ok — o estado no deal é reconciliável, mas não confirmamos falso.
  }

  return { ok: true, activityId: act!.id };
}

export interface CancelMeetingParams {
  supabase: SupabaseClient;
  dealId: string;
  activityId: string;
}

export async function cancelMeeting(params: CancelMeetingParams): Promise<void> {
  const { supabase, dealId, activityId } = params;
  await supabase.from('activities').update({ deleted_at: new Date().toISOString() }).eq('id', activityId);

  const { data: deal } = await supabase.from('deals').select('custom_fields, tags').eq('id', dealId).single();
  const customFields = (deal?.custom_fields as Record<string, unknown>) || {};
  const ra = (customFields.reuniao_agendada as Record<string, unknown>) || {};
  const prevTags = Array.isArray(deal?.tags) ? (deal!.tags as unknown[]).map(String) : [];

  await supabase
    .from('deals')
    .update({
      custom_fields: { ...customFields, reuniao_agendada: { ...ra, status: 'cancelada' } },
      tags: prevTags.filter((t) => t !== 'reuniao:agendada'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/booker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/scheduling/booker.ts test/scheduling/booker.test.ts
git commit -m "feat(scheduling): booker (cria/cancela/remarca) + testes"
```

---

## Task 6: Busy loader

**Files:**
- Create: `lib/ai/scheduling/busy.ts`

- [ ] **Step 1: Implementar (query simples, sem teste unitário dedicado — I/O fino)**

```ts
/**
 * @fileoverview Carrega os intervalos ocupados do consultor no horizonte,
 * a partir das `activities` (reuniões e bloqueios) ativas.
 * @module lib/ai/scheduling/busy
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityConfig, BusyInterval } from './types';

export interface LoadBusyParams {
  supabase: SupabaseClient;
  organizationId: string;
  consultantUserId: string;
  now: Date;
  config: AvailabilityConfig;
}

export async function loadBusyIntervals(params: LoadBusyParams): Promise<BusyInterval[]> {
  const { supabase, organizationId, consultantUserId, now, config } = params;

  // Janela de busca: de agora até ~ (horizonte + 3) dias (folga p/ fim de semana).
  const fromIso = now.toISOString();
  const toMs = now.getTime() + (config.horizonBusinessDays + 3) * 24 * 60 * 60 * 1000;
  const toIso = new Date(toMs).toISOString();

  const { data, error } = await supabase
    .from('activities')
    .select('date')
    .eq('organization_id', organizationId)
    .eq('owner_id', consultantUserId)
    .is('deleted_at', null)
    .gte('date', fromIso)
    .lt('date', toIso);

  if (error) {
    console.error('[Busy] erro ao carregar activities (tratando como livre):', error);
    return [];
  }

  const slotMs = config.slotMinutes * 60 * 1000;
  return (data || []).map((a) => {
    const startMs = new Date(a.date as string).getTime();
    return { startMs, endMs: startMs + slotMs };
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Projetos/nossocrm && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/scheduling/busy.ts
git commit -m "feat(scheduling): busy loader das activities do consultor"
```

---

## Task 7: Detector LLM + validação determinística — TDD (parte validável)

**Files:**
- Create: `lib/ai/scheduling/detect.ts`
- Test: `test/scheduling/detect-validate.test.ts`

O detector faz 2 coisas: (1) chama o LLM pra classificar a intenção; (2) **valida** o `slotIso` retornado contra os slots realmente oferecidos. O que testamos no CI é a validação determinística (a parte LLM é validada ao vivo — Task 11).

- [ ] **Step 1: Escrever o teste da validação (falha primeiro)**

```ts
import { describe, it, expect } from 'vitest';
import { validateDetectedSlot } from '@/lib/ai/scheduling/detect';
import type { Slot } from '@/lib/ai/scheduling/types';

const offered: Slot[] = [
  { startIso: '2026-07-03T13:00:00.000Z', endIso: '2026-07-03T13:40:00.000Z', label: 'quinta, 03/07, às 10h' },
  { startIso: '2026-07-03T17:00:00.000Z', endIso: '2026-07-03T17:40:00.000Z', label: 'quinta, 03/07, às 14h' },
];

describe('validateDetectedSlot', () => {
  it('aceita quando o slotIso bate exatamente com um oferecido', () => {
    expect(validateDetectedSlot('2026-07-03T13:00:00.000Z', offered)?.label).toBe('quinta, 03/07, às 10h');
  });
  it('rejeita horário não oferecido (anti-alucinação)', () => {
    expect(validateDetectedSlot('2026-07-03T20:00:00.000Z', offered)).toBeNull();
  });
  it('rejeita null', () => {
    expect(validateDetectedSlot(null, offered)).toBeNull();
  });
  it('tolera diferença de milissegundos/segundos no mesmo minuto', () => {
    expect(validateDetectedSlot('2026-07-03T13:00:30.000Z', offered)?.label).toBe('quinta, 03/07, às 10h');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/detect-validate.test.ts`
Expected: FAIL — `validateDetectedSlot` não existe.

- [ ] **Step 3: Implementar detect.ts (LLM + validação)**

```ts
/**
 * @fileoverview Detecção de intenção de agendamento na conversa (LLM) + validação
 * determinística do horário contra os slots oferecidos (anti-alucinação).
 * @module lib/ai/scheduling/detect
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModel, type AIProvider } from '../config';
import type { DetectResult, Slot } from './types';

const DetectSchema = z.object({
  intent: z.enum(['accept', 'reschedule', 'cancel', 'none']).describe(
    'accept: lead aceitou um horário oferecido. reschedule: já tinha marcado e quer mudar. cancel: quer desmarcar. none: nada de agendamento agora.',
  ),
  slotIso: z.string().nullable().describe(
    'Horário aceito/desejado em ISO UTC, EXATAMENTE igual a um dos "Horários oferecidos". null se não deu pra casar.',
  ),
});

/** Casa o horário detectado com um slot oferecido (tolera segundos; compara no minuto). */
export function validateDetectedSlot(slotIso: string | null, offered: Slot[]): Slot | null {
  if (!slotIso) return null;
  const t = new Date(slotIso).getTime();
  if (Number.isNaN(t)) return null;
  const minute = Math.floor(t / 60000);
  return offered.find((s) => Math.floor(new Date(s.startIso).getTime() / 60000) === minute) ?? null;
}

export interface DetectParams {
  supabase: SupabaseClient;
  conversationId: string;
  offered: Slot[];
  aiConfig: { provider: AIProvider; apiKey: string; model: string };
}

const MAX_MESSAGES = 12;

export async function detectSchedulingIntent(params: DetectParams): Promise<DetectResult> {
  const { supabase, conversationId, offered, aiConfig } = params;

  const { data: messages } = await supabase
    .from('messaging_messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES);

  if (!messages || messages.length === 0) return { intent: 'none', slotIso: null };

  const convo = [...messages]
    .reverse()
    .map((m) => {
      const role = m.direction === 'inbound' ? 'LEAD' : 'ATENDENTE';
      const c = m.content as Record<string, unknown>;
      const text = typeof c === 'string' ? c : (c?.text as string) || '[mensagem]';
      return `[${role}]: ${text}`;
    })
    .join('\n');

  const offeredList = offered.map((s) => `- ${s.label} => ${s.startIso}`).join('\n');

  const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
  const result = await generateText({
    model,
    output: Output.object({ schema: DetectSchema, name: 'SchedulingIntent', description: 'Intenção de agendamento' }),
    system:
      'Você lê uma conversa de WhatsApp entre atendente e lead e detecta a intenção de agendamento da ÚLTIMA mensagem do lead. Só marque accept/reschedule/cancel se o lead foi claro. slotIso DEVE ser exatamente um dos horários oferecidos (copie o ISO). Se o lead foi vago ("qualquer um", "pode ser"), use none.',
    prompt: `Horários oferecidos:\n${offeredList}\n\nConversa:\n${convo}`,
    maxRetries: 2,
  });

  const out = result.output;
  if (!out) return { intent: 'none', slotIso: null };
  return { intent: out.intent, slotIso: out.slotIso };
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/detect-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/scheduling/detect.ts test/scheduling/detect-validate.test.ts
git commit -m "feat(scheduling): detector LLM + validacao anti-alucinacao + testes"
```

---

## Task 8: Serviço orquestrador

**Files:**
- Create: `lib/ai/scheduling/scheduling.service.ts`

Orquestra: carrega config (gate) → busy → available. Em `respond`, roda detect → book/cancel e devolve `SchedulingStatus`. Em `observe`, calcula slots e roda detect (loga), mas **não** marca. Devolve sempre os `available` slots pro contexto.

- [ ] **Step 1: Implementar**

```ts
/**
 * @fileoverview Orquestrador da agenda real. Junta config→busy→available e,
 * quando aplicável, detect→book. Gated por board. NÃO marca em observe.
 * @module lib/ai/scheduling/scheduling.service
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIProvider } from '../config';
import type { Slot, SchedulingStatus } from './types';
import { getSchedulingConfig } from './config';
import { loadBusyIntervals } from './busy';
import { getAvailableSlots } from './availability';
import { detectSchedulingIntent, validateDetectedSlot } from './detect';
import { bookSlot, cancelMeeting } from './booker';

export interface RunSchedulingParams {
  supabase: SupabaseClient;
  boardId: string | null | undefined;
  organizationId: string;
  conversationId: string;
  dealId: string;
  contactId: string | null;
  leadName: string;
  summary: string;
  /** custom_fields.reuniao_agendada atual, se houver. */
  reuniaoAgendada: { activity_id?: string; status?: string } | null;
  aiConfig: { provider: AIProvider; apiKey: string; model: string };
  /** false => respond (pode marcar); true => observe (só calcula/loga). */
  dryRun: boolean;
  /** consultant_user_id da board (null => cai no interino, não marca). */
  consultantUserId: string | null;
  now: Date;
  /** Se true, já houve oferta de horário na conversa (a persona controla). */
  offeredBefore: boolean;
}

export interface RunSchedulingResult {
  available: Slot[];
  status: SchedulingStatus;
}

export async function runScheduling(params: RunSchedulingParams): Promise<RunSchedulingResult> {
  const cfg = getSchedulingConfig(params.boardId);
  if (!cfg || !params.consultantUserId) {
    return { available: [], status: { kind: 'none' } };
  }

  const busy = await loadBusyIntervals({
    supabase: params.supabase,
    organizationId: params.organizationId,
    consultantUserId: params.consultantUserId,
    now: params.now,
    config: cfg.availability,
  });
  const available = getAvailableSlots({ now: params.now, busy, config: cfg.availability });

  const alreadyBooked = params.reuniaoAgendada?.status === 'confirmada';

  // Só detecta/marca quando faz sentido: houve oferta e (não marcado OU pode ser remarcação).
  if (!params.offeredBefore) return { available, status: { kind: 'none' } };

  const detect = await detectSchedulingIntent({
    supabase: params.supabase,
    conversationId: params.conversationId,
    offered: available,
    aiConfig: params.aiConfig,
  });

  // Observe: não age; só devolve slots (o log de detecção sai no agent.service).
  if (params.dryRun) return { available, status: { kind: 'none' } };

  if (detect.intent === 'cancel' && alreadyBooked && params.reuniaoAgendada?.activity_id) {
    await cancelMeeting({ supabase: params.supabase, dealId: params.dealId, activityId: params.reuniaoAgendada.activity_id });
    return { available, status: { kind: 'cancelled' } };
  }

  if (detect.intent === 'accept' || detect.intent === 'reschedule') {
    const slot = validateDetectedSlot(detect.slotIso, available);
    if (!slot) return { available, status: { kind: 'none' } }; // horário inválido/tomado já saiu da lista
    const result = await bookSlot({
      supabase: params.supabase,
      dealId: params.dealId,
      contactId: params.contactId,
      organizationId: params.organizationId,
      consultantUserId: params.consultantUserId,
      leadName: params.leadName,
      summary: params.summary,
      slot,
      previousActivityId: detect.intent === 'reschedule' ? params.reuniaoAgendada?.activity_id : null,
    });
    if (result.ok) return { available, status: { kind: 'confirmed', label: slot.label } };
    if (result.reason === 'taken') {
      // Recalcula sem o slot que encheu.
      const fresh = getAvailableSlots({
        now: params.now,
        busy: [...busy, { startMs: new Date(slot.startIso).getTime(), endMs: new Date(slot.endIso).getTime() }],
        config: cfg.availability,
      });
      return { available: fresh, status: { kind: 'slot_taken', alternatives: fresh.slice(0, 3) } };
    }
  }

  return { available, status: { kind: 'none' } };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /c/Projetos/nossocrm && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/scheduling/scheduling.service.ts
git commit -m "feat(scheduling): servico orquestrador (gate/busy/available/detect/book)"
```

---

## Task 9: Injeção no contexto (types + context-builder)

**Files:**
- Modify: `lib/ai/agent/types.ts`
- Modify: `lib/ai/agent/context-builder.ts:229-248` (montagem do `LeadContext`) e `:303` (`formatContextForPrompt`)

- [ ] **Step 1: Estender o LeadContext**

Em `lib/ai/agent/types.ts`, adicionar ao interface `LeadContext` (perto de `qualificacao`):
```ts
  /** Horários livres pra oferecer (agenda real). Vazio quando não aplicável. */
  available_slots?: import('../scheduling/types').Slot[];
  /** Status da reunião pra orientar a resposta da Ana. */
  scheduling_status?: import('../scheduling/types').SchedulingStatus;
```

- [ ] **Step 2: Renderizar no prompt**

Em `lib/ai/agent/context-builder.ts`, dentro de `formatContextForPrompt`, ANTES do bloco `## Histórico da Conversa`, inserir:
```ts
  // Agenda real: horários disponíveis + status da reunião
  if (context.available_slots && context.available_slots.length > 0) {
    lines.push('## Horários disponíveis para a ligação do consultor');
    lines.push('Ofereça SOMENTE estes horários. NUNCA invente outro. Ofereça 2–3 por vez, não a lista toda.');
    lines.push('Se nenhum servir, diga que vai confirmar a melhor data com o consultor (não prometa fora da lista).');
    context.available_slots.forEach((s) => lines.push(`- ${s.label}`));
    lines.push('');
  }
  if (context.scheduling_status && context.scheduling_status.kind !== 'none') {
    lines.push('## Status da reunião');
    const st = context.scheduling_status;
    if (st.kind === 'confirmed') {
      lines.push(`REUNIÃO JÁ CONFIRMADA para ${st.label}. Confirme pro lead com naturalidade; o consultor liga nesse horário.`);
    } else if (st.kind === 'slot_taken') {
      const alts = st.alternatives.map((s) => s.label).join(' ou ');
      lines.push(`O horário que o lead pediu acabou de ser preenchido. Peça desculpa e ofereça: ${alts}.`);
    } else if (st.kind === 'cancelled') {
      lines.push('A reunião foi cancelada. NUNCA deixe solto: puxe um novo horário agora ou avise que o consultor reorganiza.');
    }
    lines.push('');
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd /c/Projetos/nossocrm && npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/agent/types.ts lib/ai/agent/context-builder.ts
git commit -m "feat(scheduling): injeta slots + status da reuniao no contexto da Ana"
```

---

## Task 10: Wiring no agent.service (pré-resposta, respond + Niva)

**Files:**
- Modify: `lib/ai/agent/agent.service.ts` (após `buildLeadContext`, ~linha 453-471; imports no topo ~linha 16-19)

Detalhe de fluxo: rodar `runScheduling` DEPOIS de `buildLeadContext` (precisa do deal/contact/board) e ANTES de gerar a resposta; anexar `available` + `status` no `context`. `offeredBefore` = já existe alguma mensagem do AI que continha "Horários disponíveis"/ofereceu horário — heurística: `context.messages.some(m => m.role==='agent')` **e** `context.stage.name` != 'Novo Lead' (a oferta mora na etapa em-qualificação). Simplicidade v1: `offeredBefore = context.available_slots` foi injetado em turno anterior — como não temos esse histórico barato, usar: houve ≥1 msg do agent E o lead já respondeu algo além do opener. Implementação abaixo usa `aiMessagesCount >= 1`.

- [ ] **Step 1: Import no topo**

Adicionar perto dos imports de scheduling/extração (após linha 19):
```ts
import { runScheduling } from '../scheduling/scheduling.service';
```

- [ ] **Step 2: Chamar após montar o contexto**

Logo após o bloco que valida `if (!context) { ... }` (após ~linha 471), inserir:
```ts
  // 5b. Agenda real (só board da Niva; marca só em respond). Anexa slots + status ao contexto.
  try {
    const dealForSched = context.deal;
    if (dealForSched) {
      const reuniaoAgendada =
        (context.qualificacao?.reuniao_agendada as { activity_id?: string; status?: string } | undefined) ??
        null;
      // consultant_user_id vem da board_ai_config já carregada (boardAIConfig).
      const consultantUserId =
        (boardAIConfig as { consultant_user_id?: string | null } | null)?.consultant_user_id ?? null;
      const offeredBefore = context.stats.ai_messages_count >= 1 && context.stage.name !== 'Novo Lead';

      const sched = await runScheduling({
        supabase,
        boardId: deal.board_id ?? config.board_id ?? null,
        organizationId,
        conversationId,
        dealId: dealForSched.id,
        contactId: context.contact?.id ?? null,
        leadName: context.contact?.name ?? 'lead',
        summary: buildSchedulingSummary(context),
        reuniaoAgendada,
        aiConfig: { provider: aiConfig.provider, apiKey: aiConfig.apiKey, model: aiConfig.model },
        dryRun: isDryRun,
        consultantUserId,
        now: new Date(),
        offeredBefore,
      });
      context.available_slots = sched.available;
      context.scheduling_status = sched.status;
      if (isDryRun) {
        console.log('[Scheduling][observe] status=%s slots=%d deal=%s', sched.status.kind, sched.available.length, dealForSched.id);
      }
    }
  } catch (err) {
    console.error('[Scheduling] falhou (seguindo sem agenda):', err);
  }
```

- [ ] **Step 3: Helper de resumo (no mesmo arquivo, perto dos helpers)**

```ts
/** Resumo curto pra descrição da activity (tier + campos-chave). */
function buildSchedulingSummary(context: LeadContext): string {
  const q = (context.qualificacao ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const tier = (q.tier as { value?: string } | undefined)?.value;
  if (tier) parts.push(`Tier ${tier}`);
  if (q.vidas) parts.push(`${q.vidas} vidas`);
  if (q.valor_pago_exato) parts.push(`paga R$${q.valor_pago_exato}`);
  if (q.operadora) parts.push(String(q.operadora));
  return parts.join(' · ') || 'Lead qualificado pela SDR';
}
```

> Nota de integração: confirmar o nome real do campo do board id no objeto do deal/config (`deal.board_id` vs `config.board_id`). Se `boardAIConfig` não expõe `consultant_user_id` no SELECT atual, adicionar a coluna ao SELECT onde `boardAIConfig` é carregado (buscar `board_ai_config` no arquivo e incluir `consultant_user_id`). Ajustar `context.qualificacao?.reuniao_agendada` conforme onde o custom_fields expõe (é `deals.custom_fields.reuniao_agendada`; o context-builder já expõe `qualificacao` = `custom_fields.qualificacao` — pode ser preciso também expor `custom_fields.reuniao_agendada`; se não estiver, ler do deal diretamente).

- [ ] **Step 4: Ajustar o SELECT de board_ai_config e a exposição de reuniao_agendada**

- No ponto onde `boardAIConfig` é carregado (`from('board_ai_config').select(...)`), incluir `consultant_user_id`.
- Em `context-builder.ts`, ao processar `custom_fields`, expor também `reuniao_agendada` no `qualificacao` OU num campo próprio. v1: adicionar em `qualificacao` a chave `reuniao_agendada` copiada de `customFields.reuniao_agendada` (o QUAL_LABELS já ignora chaves desconhecidas de render? não — adicionar label 'Reunião agendada' ou pular no render). Mais limpo: no context-builder, após montar `qualificacao`, fazer `if (customFields?.reuniao_agendada) qualificacao = { ...(qualificacao||{}), reuniao_agendada: customFields.reuniao_agendada };`.

- [ ] **Step 5: Typecheck + suite completa**

Run: `cd /c/Projetos/nossocrm && npx tsc --noEmit && npx vitest run test/scheduling`
Expected: sem erros de tipo; testes de scheduling PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/agent/agent.service.ts lib/ai/agent/context-builder.ts
git commit -m "feat(scheduling): wiring pre-resposta no agent.service (respond + Niva)"
```

---

## Task 11: Persona (regras de horário) + validação ao vivo em observe

**Files:**
- Create: `docs/niva-ana-agenda-persona.sql`

- [ ] **Step 1: Escrever o UPDATE de persona (regras de agendamento)**

Acrescentar ao `persona_prompt` da board `c2e36157` (via UPDATE que concatena a seção nova; versionar o texto no arquivo). Conteúdo da seção:
```
## Agendamento (horário real)
- Você agenda a ligação de 30 min do consultor em um horário REAL.
- Ofereça SOMENTE os horários da seção "Horários disponíveis". NUNCA invente horário.
- Ofereça 2 a 3 opções por vez, em bolhas curtas. Se recusar, ofereça as próximas da lista.
- Só ofereça horário DEPOIS de qualificar (não abra a conversa jogando horário).
- Quando a seção "Status da reunião" disser CONFIRMADA, confirme pro lead com naturalidade
  (dia e hora) e reforce que o consultor liga nesse horário.
- Se disser que o horário foi preenchido, peça desculpa rápida e ofereça as alternativas.
- Remarcação/cancelamento: se o lead quiser mudar ou não puder, NUNCA deixe solto no
  "vou precisar desmarcar" — puxe um novo horário na hora, ou diga que o consultor reorganiza.
- Se não houver horário na lista, diga que vai confirmar a melhor data com o consultor e retorna.
```

Aplicar via SQL (MCP Supabase `execute_sql` no `nossocrmv2`), versionando o texto completo no arquivo.

- [ ] **Step 2: Rodar a suíte inteira (nada quebrou no cérebro)**

Run: `cd /c/Projetos/nossocrm && npx vitest run`
Expected: PASS (inclui os 29 testes de tier + os novos de scheduling).

- [ ] **Step 3: Validação ao vivo em observe (LLM real)**

Escrever script no scratchpad da sessão (fora do repo) que monta o mesmo prompt do agent.service e roda `detectSchedulingIntent` com o `gemini-2.5-flash` real (chave lida de `.secrets/credenciais.env`, NUNCA no chat), sobre 4 conversas fixture:
1. lead aceita ("pode ser quinta às 10h") → `intent=accept`, slotIso = o das 10h.
2. lead vago ("qualquer um serve") → `intent=none`.
3. lead recusa a semana ("essa semana não dá") → `intent=none`.
4. lead já marcado pede pra mudar ("consigo remarcar pra sexta?") → `intent=reschedule`.
Conferir manualmente que a classificação bate. Ajustar o `system` de `detect.ts` se necessário.

- [ ] **Step 4: Rollout (manual, com a Thalita)**

- Manter `agent_mode='observe'`: confirmar nos logs que os slots são injetados e a detecção acerta, SEM criar activities.
- Só então (aprovado): `UPDATE board_ai_config SET agent_mode='respond'` (junto do go-live/cutover). A partir daí o booker cria as reuniões de verdade.
- **NÃO mergear na `main`** até o go-live combinado.

- [ ] **Step 5: Commit**

```bash
git add docs/niva-ana-agenda-persona.sql
git commit -m "feat(scheduling): persona de agendamento + roteiro de validacao em observe"
```

---

## Self-Review (cobertura da spec)

- §3 Motor de disponibilidade → Task 3 ✅
- §3 Fonte de verdade = activities / busy → Task 6 ✅
- §5 Oferta no contexto + persona → Tasks 9, 11 ✅
- §6 Detecção + reserva pré-resposta, só respond → Tasks 7, 8, 10 ✅
- §6 Idempotência / remarcação / cancelamento → Tasks 5, 8 ✅
- §6 Trava de corrida (unique index) → Task 4 ✅
- §7 Gravação (activity CALL + reuniao_agendada + tag + consultant_user_id) → Tasks 4, 5 ✅
- §8 Bordas (sem slot, fora da janela, corrida, falha, remarcação, consultant null) → Tasks 3, 5, 8, 11 ✅
- §9 Testes determinísticos + validação ao vivo + rollout → Tasks 3, 5, 7, 11 ✅

**Pontos de atenção pra execução** (resolver no Task 10, exigem leitura do arquivo real): (a) nome exato do campo do board id no objeto `deal`/`config`; (b) incluir `consultant_user_id` no SELECT de `board_ai_config`; (c) expor `custom_fields.reuniao_agendada` no context-builder. O plano marca esses três explicitamente.
```
