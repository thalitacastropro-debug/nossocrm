# Integridade do agendamento da Ana — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Ana parar de marcar horário errado e de marcar em feriado, e passar a oferecer 2 horários por vez.

**Architecture:** Quatro fixes independentes no módulo `lib/ai/scheduling` (+ 1 linha em `context-builder`). O grosso é lógica PURA (feriados, comparação de slot), testável sem I/O. O fix do guard tem uma armadilha: comparar slots sem antes re-injetar o horário marcado na lista do detector REABRE o bug 9h→10h — as duas partes andam juntas (Task 4).

**Tech Stack:** TypeScript, Next.js, Supabase, vitest. Repo é **pnpm** (a Vercel builda com pnpm — nunca `npm install`).

**Spec:** `docs/superpowers/specs/2026-07-17-integridade-agendamento-ana-design.md`
**Branch:** `feat/lead-intake-route` (push = `git push origin feat/lead-intake-route:main`)

---

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `lib/ai/scheduling/holidays.ts` (**criar**) | Feriados nacionais. Puro, sem I/O. Páscoa + fixos. | 1 |
| `lib/ai/scheduling/availability.ts` (**modificar** :56) | `isBusinessDay` passa a excluir feriado. | 2 |
| `lib/ai/scheduling/detect.ts` (**modificar** :23-29, :68-69) | Prompt: restrição ⇒ `none`. Exporta `mesmoSlot`. | 3, 4 |
| `lib/ai/scheduling/scheduling.service.ts` (**modificar** :60-106) | Re-injeta slot marcado p/ detecção; short-circuit compara slot; `previousActivityId` no accept-que-mudou. | 4 |
| `lib/ai/agent/context-builder.ts` (**modificar** :482) | "Ofereça exatamente 2 por vez". | 5 |
| `test/scheduling/holidays.test.ts` (**criar**) | Páscoa, fixos, móveis, regressão 07/09. | 1, 2 |
| `test/scheduling/detect-validate.test.ts` (**modificar**) | `mesmoSlot`. | 3 |
| `test/scheduling/scheduling-service.test.ts` (**criar**) | Reconfirmação vs remarcação (os 2 cenários do spec §3.1). | 4 |

---

### Task 1: Feriados nacionais (lógica pura)

**Files:**
- Create: `lib/ai/scheduling/holidays.ts`
- Test: `test/scheduling/holidays.test.ts`

- [ ] **Step 1: Write the failing test**

Criar `test/scheduling/holidays.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { easterSunday, isFeriado } from '@/lib/ai/scheduling/holidays';

describe('easterSunday', () => {
  it('calcula o Domingo de Páscoa (Meeus/Butcher)', () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 });
  });
});

describe('isFeriado', () => {
  it('pega os feriados FIXOS', () => {
    expect(isFeriado(2026, 9, 7)).toBe(true);   // Independência — o bug real
    expect(isFeriado(2026, 12, 25)).toBe(true); // Natal
    expect(isFeriado(2027, 1, 1)).toBe(true);   // Confraternização
    expect(isFeriado(2026, 11, 20)).toBe(true); // Consciência Negra (nacional desde 2024)
  });

  it('pega os feriados MÓVEIS derivados da Páscoa de 2026 (05/04)', () => {
    expect(isFeriado(2026, 2, 17)).toBe(true); // Carnaval (Páscoa -47)
    expect(isFeriado(2026, 4, 3)).toBe(true);  // Sexta-feira Santa (Páscoa -2)
    expect(isFeriado(2026, 6, 4)).toBe(true);  // Corpus Christi (Páscoa +60)
  });

  it('não marca dia comum como feriado', () => {
    expect(isFeriado(2026, 9, 8)).toBe(false);
    expect(isFeriado(2026, 7, 20)).toBe(false);
    expect(isFeriado(2026, 2, 18)).toBe(false); // quarta de cinzas não é feriado nacional
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/holidays.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai/scheduling/holidays"`

- [ ] **Step 3: Write minimal implementation**

Criar `lib/ai/scheduling/holidays.ts`:

```ts
/**
 * @fileoverview Feriados NACIONAIS do Brasil — funções PURAS, sem I/O.
 * Existe porque `availability.ts` só sabia distinguir dia útil por dia da semana
 * (dow 1-5), então a Ana ofertava ligação em 07/09 e o consultor não trabalhava.
 *
 * Escopo deliberado: só feriado NACIONAL. Bloqueio de data PESSOAL do consultor
 * NÃO mora aqui — já funciona hoje: ele cria uma activity no dia e o
 * `loadBusyIntervals` (busy.ts:26-33) trata como ocupado.
 * @module lib/ai/scheduling/holidays
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/** 'MM-DD' com zero à esquerda. */
function mmdd(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Feriados nacionais de data fixa. */
const FIXOS = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra (Lei 14.759/2023)
  '12-25', // Natal
]);

/** Domingo de Páscoa do ano (algoritmo de Meeus/Butcher, calendário gregoriano). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Feriados móveis do ano, derivados da Páscoa.
 * Carnaval (-47) e Corpus Christi (+60) são ponto facultativo na lei, mas na prática
 * ninguém atende — tratamos como feriado pra não marcar ligação.
 */
function moveisDoAno(year: number): Set<string> {
  const { month, day } = easterSunday(year);
  const easterMs = Date.UTC(year, month - 1, day);
  const out = new Set<string>();
  for (const offset of [-47, -2, 60]) {
    const d = new Date(easterMs + offset * DIA_MS);
    out.add(mmdd(d.getUTCMonth() + 1, d.getUTCDate()));
  }
  return out;
}

/** Feriado nacional? `month` é 1-12. Recebe a data já em componentes SP. */
export function isFeriado(year: number, month: number, day: number): boolean {
  const key = mmdd(month, day);
  if (FIXOS.has(key)) return true;
  return moveisDoAno(year).has(key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/holidays.test.ts`
Expected: PASS — 4 testes verdes.

- [ ] **Step 5: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/ai/scheduling/holidays.ts test/scheduling/holidays.test.ts
git commit -m "feat(scheduling): feriados nacionais (fixos + moveis via Pascoa), puro"
```

---

### Task 2: `getAvailableSlots` não oferta em feriado

**Files:**
- Modify: `lib/ai/scheduling/availability.ts:56`
- Test: `test/scheduling/holidays.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append em `test/scheduling/holidays.test.ts`:

```ts
import { getAvailableSlots } from '@/lib/ai/scheduling/availability';
import { NIVA_AVAILABILITY } from '@/lib/ai/scheduling/config';

describe('getAvailableSlots x feriado', () => {
  it('NÃO oferta 07/09/2026 (Independência, uma segunda-feira) — regressão do bug real', () => {
    // quinta 03/09/2026 14h SP. Sem este fix, a lista traz "segunda, 07/09, às 9h".
    const now = new Date('2026-09-03T17:00:00.000Z');
    const slots = getAvailableSlots({ now, busy: [], config: NIVA_AVAILABILITY });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => s.label.includes('07/09'))).toBe(false);
  });

  it('o horizonte PULA o feriado em vez de encurtar (08/09 continua ofertável)', () => {
    const now = new Date('2026-09-03T17:00:00.000Z');
    const slots = getAvailableSlots({ now, busy: [], config: NIVA_AVAILABILITY });
    expect(slots.some((s) => s.label.includes('08/09'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/holidays.test.ts -t "07/09"`
Expected: FAIL — `expected true to be false` (a lista contém "segunda, 07/09, às 9h").

- [ ] **Step 3: Write minimal implementation**

Em `lib/ai/scheduling/availability.ts`, adicionar o import no topo (junto dos outros):

```ts
import { isFeriado } from './holidays';
```

E trocar a linha 56:

```ts
    const isBusinessDay = dow >= 1 && dow <= 5;
```

por:

```ts
    // Feriado nacional não é dia útil. Como `businessDaysSeen++` só roda quando isBusinessDay,
    // o horizonte PULA o feriado em vez de encurtar.
    const isBusinessDay = dow >= 1 && dow <= 5 && !isFeriado(year, month, day);
```

(`year`, `month` e `day` já estão em escopo — vêm do `spParts(cursor.getTime())` na linha 54.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/holidays.test.ts test/scheduling/availability.test.ts`
Expected: PASS — os novos 2 + os de `availability.test.ts` sem regressão.

- [ ] **Step 5: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/ai/scheduling/availability.ts test/scheduling/holidays.test.ts
git commit -m "fix(scheduling): nao ofertar ligacao em feriado nacional (a Ana ofertava 07/09)"
```

---

### Task 3: `mesmoSlot` + prompt do detector trata restrição como `none`

**Files:**
- Modify: `lib/ai/scheduling/detect.ts`
- Test: `test/scheduling/detect-validate.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append em `test/scheduling/detect-validate.test.ts` (ajustar o import do topo para incluir `mesmoSlot`):

```ts
import { mesmoSlot } from '@/lib/ai/scheduling/detect';

describe('mesmoSlot', () => {
  it('true quando é o mesmo minuto (tolera segundos/millis)', () => {
    expect(mesmoSlot('2026-07-20T18:00:00.000Z', '2026-07-20T18:00:59.999Z')).toBe(true);
  });

  it('false quando é outro horário — o caso Nathalia (sex 17h marcado, seg 15h aceito)', () => {
    expect(mesmoSlot('2026-07-20T18:00:00.000Z', '2026-07-17T20:00:00.000Z')).toBe(false);
  });

  it('false com null/undefined/lixo (nunca reafirma o que não dá pra comparar)', () => {
    expect(mesmoSlot(null, '2026-07-20T18:00:00.000Z')).toBe(false);
    expect(mesmoSlot('2026-07-20T18:00:00.000Z', undefined)).toBe(false);
    expect(mesmoSlot('não-é-data', '2026-07-20T18:00:00.000Z')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/detect-validate.test.ts`
Expected: FAIL — `mesmoSlot is not a function` / erro de import.

- [ ] **Step 3: Write minimal implementation**

Em `lib/ai/scheduling/detect.ts`, adicionar logo abaixo de `validateDetectedSlot` (após a linha 29):

```ts
/**
 * Dois instantes são o MESMO horário? (compara no minuto, igual ao validateDetectedSlot).
 * Usado pelo scheduling.service pra distinguir "o lead está reconfirmando a reunião que já
 * está marcada" de "o lead aceitou um horário NOVO" — o detector rotula pela frase ("15"),
 * não pelo estado do deal, então a intenção sozinha não basta.
 */
export function mesmoSlot(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.floor(ta / 60000) === Math.floor(tb / 60000);
}
```

E trocar o `system` do `generateText` (linha 68-69) por:

```ts
    system:
      'Você lê uma conversa de WhatsApp entre atendente e lead e detecta a intenção de agendamento da ÚLTIMA mensagem do lead. Só marque accept/reschedule/cancel se o lead foi claro. slotIso DEVE ser exatamente um dos horários oferecidos (copie o ISO). Se o lead foi vago ("qualquer um", "pode ser"), use none. ' +
      'Se o lead expressa apenas uma RESTRIÇÃO ou PREFERÊNCIA de período ("só de tarde", "só depois das 15h", "de manhã", "pode ser na segunda?", "essa semana não") SEM escolher um horário concreto da lista, use none — MESMO QUE só um dos horários oferecidos caiba na restrição. Escolher por ele é erro: quem escolhe o horário é o lead. accept exige que o lead aponte um horário.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/detect-validate.test.ts`
Expected: PASS — 3 novos + os de `validateDetectedSlot` sem regressão.

- [ ] **Step 5: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/ai/scheduling/detect.ts test/scheduling/detect-validate.test.ts
git commit -m "fix(scheduling): restricao de periodo nao e aceite + helper mesmoSlot

'so vou poder atender no final da tarde' virava accept do slot das 17h. A
armadilha e a restricao que casa com exatamente UM slot da lista."
```

---

### Task 4: Guard compara o slot + re-injeta o horário marcado na detecção

> ⚠️ As duas mudanças são UMA task porque separadas quebram: comparar slot sem re-injetar
> reabre o deslize 9h→10h (o horário marcado sai da disponibilidade via `busy.ts`, e o
> detector é forçado a apontar outro).

**Files:**
- Modify: `lib/ai/scheduling/scheduling.service.ts:60-106`
- Test: `test/scheduling/scheduling-service.test.ts` (criar)

- [ ] **Step 1: Write the failing test**

Criar `test/scheduling/scheduling-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks dos colaboradores de I/O — o alvo do teste é a DECISÃO do runScheduling.
vi.mock('@/lib/ai/scheduling/busy', () => ({ loadBusyIntervals: vi.fn(async () => []) }));
vi.mock('@/lib/ai/scheduling/detect', async (orig) => {
  const real = await orig<typeof import('@/lib/ai/scheduling/detect')>();
  return { ...real, detectSchedulingIntent: vi.fn() };
});
vi.mock('@/lib/ai/scheduling/booker', () => ({
  bookSlot: vi.fn(async () => ({ ok: true, activityId: 'act-nova' })),
  cancelMeeting: vi.fn(async () => undefined),
}));

import { runScheduling } from '@/lib/ai/scheduling/scheduling.service';
import { detectSchedulingIntent } from '@/lib/ai/scheduling/detect';
import { bookSlot } from '@/lib/ai/scheduling/booker';
import { NIVA_SDR_BOARD_ID } from '@/lib/ai/extraction/domain/niva-health';

// sexta 17/07/2026 08h30 SP — mesma hora do incidente real da Nathalia.
const NOW = new Date('2026-07-17T11:30:00.000Z');

function baseParams(over: Record<string, unknown> = {}) {
  return {
    supabase: {} as never,
    boardId: NIVA_SDR_BOARD_ID,
    organizationId: 'org-1',
    conversationId: 'conv-1',
    dealId: 'deal-1',
    contactId: 'c-1',
    leadName: 'Nathalia',
    summary: 'Tier indefinido',
    reuniaoAgendada: null,
    aiConfig: { provider: 'google', apiKey: 'k', model: 'm', structuredApiKey: 'k', structuredModel: 'm' },
    dryRun: false,
    consultantUserId: 'u-den',
    now: NOW,
    offeredBefore: true,
    ...over,
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('runScheduling — reconfirmação vs remarcação', () => {
  it('RECONFIRMAÇÃO: lead reconfirma o MESMO horário → reafirma sem re-marcar (regressão 9h→10h)', async () => {
    const marcado = '2026-07-17T20:00:00.000Z'; // sexta 17h SP
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'accept', slotIso: marcado });

    const r = await runScheduling(baseParams({
      reuniaoAgendada: { status: 'confirmada', data_hora: marcado, activity_id: 'act-velha', label: 'sexta, 17/07, às 17h' },
    }));

    expect(bookSlot).not.toHaveBeenCalled();
    expect(r.status).toEqual({ kind: 'confirmed', label: 'sexta, 17/07, às 17h' });
  });

  it('o horário JÁ MARCADO vai na lista do detector (senão ele é forçado a apontar outro)', async () => {
    const marcado = '2026-07-17T20:00:00.000Z';
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'accept', slotIso: marcado });

    await runScheduling(baseParams({
      reuniaoAgendada: { status: 'confirmada', data_hora: marcado, activity_id: 'act-velha', label: 'sexta, 17/07, às 17h' },
    }));

    const offered = vi.mocked(detectSchedulingIntent).mock.calls[0][0].offered;
    expect(offered.some((s) => s.startIso === marcado)).toBe(true);
  });

  it('mas a Ana NÃO oferece de volta o horário já marcado (available fica sem ele)', async () => {
    const marcado = '2026-07-17T20:00:00.000Z';
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'none', slotIso: null });

    const r = await runScheduling(baseParams({
      reuniaoAgendada: { status: 'confirmada', data_hora: marcado, activity_id: 'act-velha', label: 'sexta, 17/07, às 17h' },
    }));

    expect(r.available.some((s) => s.startIso === marcado)).toBe(false);
  });

  it('CASO NATHALIA: aceita horário DIFERENTE do marcado → re-marca e cancela a activity antiga', async () => {
    const marcado = '2026-07-17T20:00:00.000Z';  // sexta 17h
    const novo = '2026-07-20T18:00:00.000Z';     // segunda 15h
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'accept', slotIso: novo });

    const r = await runScheduling(baseParams({
      reuniaoAgendada: { status: 'confirmada', data_hora: marcado, activity_id: 'act-velha', label: 'sexta, 17/07, às 17h' },
    }));

    expect(bookSlot).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(bookSlot).mock.calls[0][0];
    expect(arg.slot.startIso).toBe(novo);
    expect(arg.previousActivityId).toBe('act-velha'); // cancela a de sexta
    expect(r.status).toEqual({ kind: 'confirmed', label: 'segunda, 20/07, às 15h' });
  });

  it('sem reunião marcada, um accept normal marca sem previousActivityId', async () => {
    const novo = '2026-07-20T18:00:00.000Z';
    vi.mocked(detectSchedulingIntent).mockResolvedValue({ intent: 'accept', slotIso: novo });

    await runScheduling(baseParams({ reuniaoAgendada: null }));

    expect(vi.mocked(bookSlot).mock.calls[0][0].previousActivityId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/scheduling-service.test.ts`
Expected: FAIL — o teste "CASO NATHALIA" falha com `expect(bookSlot).toHaveBeenCalledTimes(1)` recebendo 0 (o guard atual curto-circuita todo `accept`), e o teste da lista do detector falha porque o slot marcado não é re-injetado.

- [ ] **Step 3: Write minimal implementation**

Em `lib/ai/scheduling/scheduling.service.ts`:

**(a)** Trocar o import da linha 13 para trazer o `mesmoSlot`:

```ts
import { detectSchedulingIntent, validateDetectedSlot, mesmoSlot } from './detect';
```

**(b)** Substituir o bloco das linhas 60-70 (do `const alreadyBooked` até o fim do `detectSchedulingIntent`) por:

```ts
  const alreadyBooked = params.reuniaoAgendada?.status === 'confirmada';

  // Só detecta/marca quando faz sentido: houve oferta na conversa.
  if (!params.offeredBefore) return { available, status: { kind: 'none' } };

  // O horário JÁ marcado NÃO está em `available`: busy.ts carrega a própria reunião do lead
  // como ocupada. Como o prompt manda "slotIso DEVE ser um dos oferecidos", sem re-injetar o
  // detector é FORÇADO a apontar outro horário quando o lead só reconfirma — era o deslize
  // 9h→10h. Re-injetamos só pra DETECÇÃO; `available` (o que a Ana oferece) continua sem ele,
  // senão ela ofereceria de volta um horário que já é do próprio lead.
  const slotMarcado: Slot | null =
    alreadyBooked && params.reuniaoAgendada?.data_hora
      ? {
          startIso: params.reuniaoAgendada.data_hora,
          endIso: new Date(
            new Date(params.reuniaoAgendada.data_hora).getTime() + cfg.availability.slotMinutes * 60_000,
          ).toISOString(),
          label:
            params.reuniaoAgendada.label ??
            slotLabelFromIso(params.reuniaoAgendada.data_hora, cfg.availability.utcOffset),
        }
      : null;

  const detect = await detectSchedulingIntent({
    supabase: params.supabase,
    conversationId: params.conversationId,
    offered: slotMarcado ? [...available, slotMarcado] : available,
    aiConfig: params.aiConfig,
  });
```

**(c)** Substituir o short-circuit (linhas 86-91) por:

```ts
    // Reafirma SÓ se o lead está reconfirmando O MESMO horário já marcado. Se ele apontou
    // OUTRO, é remarcação de fato — mesmo que o detector tenha rotulado 'accept' (ele rotula
    // pela frase do lead, "15", não pelo estado do deal). Sem comparar o slot, o lead que pede
    // outro dia e escolhe horário novo fica com o horário ANTIGO no banco enquanto a Ana
    // promete o novo: foi o bug da Nathalia (prometeu segunda 15h, banco ficou sexta 17h).
    if (alreadyBooked && detect.intent === 'accept' && mesmoSlot(detect.slotIso, params.reuniaoAgendada?.data_hora)) {
      const label =
        params.reuniaoAgendada?.label ??
        slotLabelFromIso(params.reuniaoAgendada?.data_hora, cfg.availability.utcOffset);
      return { available, status: { kind: 'confirmed', label }, detected: detect };
    }
```

**(d)** Trocar o `previousActivityId` (linha 105) por:

```ts
      // Remarcação: tanto o 'reschedule' explícito quanto o 'accept' de um horário DIFERENTE
      // do que já está marcado precisam cancelar a activity antiga — senão sobram 2 ligações
      // na agenda do consultor.
      previousActivityId: alreadyBooked ? (params.reuniaoAgendada?.activity_id ?? null) : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/`
Expected: PASS — os 5 novos + `booker.test.ts` + `availability.test.ts` + `detect-validate.test.ts` sem regressão.

- [ ] **Step 5: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/ai/scheduling/scheduling.service.ts test/scheduling/scheduling-service.test.ts
git commit -m "fix(scheduling): guard compara o SLOT, nao so a intencao (bug Nathalia)

Com reuniao confirmada, um accept posterior reafirmava o label antigo sem
re-marcar: a Ana prometia 'segunda 15h' e o banco ficava com sexta 17h.
Agora so reafirma se o lead reconfirmou O MESMO horario.

Junto (obrigatorio, senao reabre o 9h->10h): re-injeta o horario marcado na
lista que vai pro DETECTOR — ele saia da disponibilidade via busy.ts, e o
'slotIso DEVE ser um dos oferecidos' forcava o LLM a apontar outro slot quando
o lead so reconfirmava. `available` (o que a Ana oferece) segue sem ele."
```

---

### Task 5: Ana oferece exatamente 2 horários

**Files:**
- Modify: `lib/ai/agent/context-builder.ts:482`

- [ ] **Step 1: Fazer a mudança**

> Sem teste automatizado: é texto de prompt (o spec §6 registra isso). Validar ao vivo.

Trocar a linha 482:

```ts
    lines.push('Ofereça SOMENTE estes horários. NUNCA invente outro. Ofereça 2–3 por vez, não a lista toda.');
```

por:

```ts
    lines.push('Ofereça SOMENTE estes horários. NUNCA invente outro. Ofereça EXATAMENTE 2 por vez, nunca 3 ou mais, e nunca a lista toda.');
```

- [ ] **Step 2: Verificar que nada quebrou**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/ 2>&1 | tail -20`
Expected: mesma contagem de falhas de antes da task (as 13 falhas da suíte geral são **pré-existentes** — ver HANDOFF 07-13 §GOTCHA; nenhuma importa scheduling).

- [ ] **Step 3: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/ai/agent/context-builder.ts
git commit -m "fix(ana): oferecer exatamente 2 horarios por vez (estava 2-3, ofertava 3)"
```

---

### Task 6: Verificação final + deploy

- [ ] **Step 1: Typecheck e lint**

Run: `cd /c/Projetos/nossocrm && npx tsc --noEmit && npx next lint`
Expected: zero erros.

> Se faltar dependência, rodar `corepack pnpm install` (**nunca** `npm install` — o repo é pnpm e a Vercel builda com pnpm).

- [ ] **Step 2: Suíte de scheduling completa**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/scheduling/ test/followup/`
Expected: PASS.

- [ ] **Step 3: Deploy**

```bash
cd /c/Projetos/nossocrm
git push origin feat/lead-intake-route:main
```

- [ ] **Step 4: Validar ao vivo (reportar à Thalita, não marcar sozinho)**

No próximo lead de anúncio, conferir:
1. A Ana oferece **2** horários (não 3).
2. Lead que responde com restrição ("só de tarde", "pode ser na segunda?") **não** faz a Ana marcar — ela oferta os horários daquele período.
3. Lead que pede outro dia e escolhe horário novo ⇒ `deals.custom_fields.reuniao_agendada.data_hora` bate com o que a Ana falou, e sobra **uma** activity (a antiga com `deleted_at`).

SQL de conferência:
```sql
select d.title, d.custom_fields->'reuniao_agendada' as reuniao,
       a.date, a.deleted_at
from deals d
join activities a on a.deal_id = d.id and a.type='CALL'
where d.custom_fields ? 'reuniao_agendada'
order by a.created_at desc;
```

---

## Self-Review

**Cobertura do spec:**
- §2 Fix A (restrição ⇒ none) → Task 3 ✓
- §3 Fix B (re-injeção + comparar slot + previousActivityId) → Task 4 ✓ (os 3 cenários da §3.1 viraram teste)
- §4 Fix C (feriados) → Tasks 1 e 2 ✓ (o `ultimoDiaUtilAntes` é do plano 2 — encadeado, consome o `holidays.ts` desta Task 1)
- §5 Fix D (2 horários) → Task 5 ✓
- §6 Testes → cobertos nas tasks; Fix A/D sem teste automatizado **por decisão do spec** (é julgamento de LLM / texto de prompt), com validação ao vivo na Task 6 Step 4 ✓
- §8 (não entra) → nada implementado, correto ✓

**Consistência de tipos:** `mesmoSlot(a, b): boolean` definido na Task 3, usado na Task 4 com a mesma assinatura. `isFeriado(year, month, day)` definido na Task 1, usado na Task 2 com os 3 args que `spParts` já fornece. `Slot` (startIso/endIso/label) montado na Task 4 bate com `types.ts:7-14`. `previousActivityId` aceita `string | null` — bate com `booker.ts` (`params.previousActivityId` já é opcional/nulo).
