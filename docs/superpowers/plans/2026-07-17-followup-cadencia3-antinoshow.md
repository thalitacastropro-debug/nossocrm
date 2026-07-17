# Cadência 3 (lembrete anti-no-show) + Cancelar reunião — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Ana lembra o lead da reunião (véspera + 30min antes), e o consultor ganha um botão pra cancelar reunião — que hoje **não existe no CRM**.

**Architecture:** Módulo novo `lib/ai/followup/meeting-reminder.ts`, chamado pelo cron que já está no ar (`/api/cron/lead-followup`) — sem migration, sem job pg_cron novo, sem tocar no motor do B1. **Ancora em `activities`, não em `custom_fields.reuniao_agendada`**: o JSON é podre (status terminal, schema divergente, dessincronizado do calendário) e a `activities` tem tudo tipado. Copy fixa, zero IA.

**Tech Stack:** TypeScript, Next.js, Supabase, vitest. Repo é **pnpm**.

**Spec:** `docs/superpowers/specs/2026-07-17-followup-cadencia3-antinoshow-design.md`
**Depende de:** `docs/superpowers/plans/2026-07-17-integridade-agendamento-ana.md` — a Task 1 de lá cria o `lib/ai/scheduling/holidays.ts` que a Task 2 daqui consome. **Executar aquele plano primeiro** (a Ana precisa marcar o horário certo antes da gente anunciar o horário pro lead).
**Branch:** `feat/lead-intake-route` (push = `git push origin feat/lead-intake-route:main`)

---

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `lib/ai/followup/meeting-reminder-schedule.ts` (**criar**) | Lógica PURA: `ultimoDiaUtilAntes`, `dueVespera`, `dueAtivacao`, `deveEnviar`. Sem I/O. | 1, 2 |
| `lib/ai/followup/meeting-reminder.ts` (**criar**) | Orquestrador (deps injetadas) + copy fixa + `renderReminder`. | 3, 4 |
| `app/api/cron/lead-followup/route.ts` (**modificar**) | Chama a 2ª função e soma no log. | 5 |
| `app/api/deals/[dealId]/cancel-meeting/route.ts` (**criar**) | Rota de cancelamento (molde da rota de no-show). | 6 |
| `lib/query/hooks/useCancelMeeting.ts` (**criar**) | Hook do botão. | 7 |
| `features/boards/.../KanbanBoard.tsx` + `DealCard.tsx` + `DealDetailModal.tsx` (**modificar**) | Botão "Cancelar reunião", gated ao board do Consultor. | 7 |
| `test/followup/meeting-reminder.test.ts` (**criar**) | Tudo acima. | 1-4 |

> **Não tocar:** `run.ts`, `schedule.ts`, `copy.ts`, `generate.ts` (motor do B1, validado ao vivo), migration/pg_cron/Vault.

---

### Task 1: Janelas dos toques (lógica pura, sem feriado ainda)

**Files:**
- Create: `lib/ai/followup/meeting-reminder-schedule.ts`
- Test: `test/followup/meeting-reminder.test.ts`

- [ ] **Step 1: Write the failing test**

Criar `test/followup/meeting-reminder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ultimoDiaUtilAntes, dueVespera, dueAtivacao, deveEnviar, VESPERA_MIN_GAP_MS,
} from '@/lib/ai/followup/meeting-reminder-schedule';

// Referência: sexta 17/07/2026, segunda = 20/07/2026.
const SEG_15H = '2026-07-20T18:00:00.000Z'; // segunda 20/07 15h SP
const SEG_9H  = '2026-07-20T12:00:00.000Z'; // segunda 20/07 9h SP
const QUI_10H = '2026-07-23T13:00:00.000Z'; // quinta 23/07 10h SP

describe('ultimoDiaUtilAntes', () => {
  it('reunião na quinta → véspera na quarta 17h', () => {
    expect(ultimoDiaUtilAntes(QUI_10H)).toBe('2026-07-22T20:00:00.000Z'); // quarta 22/07 17h SP
  });

  it('reunião na SEGUNDA → véspera na SEXTA 17h (pula o fim de semana)', () => {
    expect(ultimoDiaUtilAntes(SEG_9H)).toBe('2026-07-17T20:00:00.000Z'); // sexta 17/07 17h SP
  });
});

describe('dueAtivacao', () => {
  it('é 30min antes da reunião', () => {
    expect(dueAtivacao(SEG_15H)).toBe('2026-07-20T17:30:00.000Z'); // segunda 14h30 SP
  });
});

describe('deveEnviar — véspera', () => {
  const marcadaEm = '2026-07-16T12:00:00.000Z'; // quinta 16/07 9h SP (bem antes da janela)

  it('envia dentro da janela [17h00, 17h30]', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T20:05:00.000Z'), enviadoEm: null,
    })).toBe(true);
  });

  it('NÃO envia antes da janela abrir', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T19:00:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });

  it('NÃO envia depois de expirar (cron parado) — queima', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T21:00:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });

  it('NÃO reenvia o que já foi enviado', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T20:05:00.000Z'), enviadoEm: '2026-07-17T20:00:00.000Z',
    })).toBe(false);
  });
});

describe('deveEnviar — gap mínimo da véspera (anti "confirmando o que combinamos há 6 minutos")', () => {
  const due = '2026-07-17T20:00:00.000Z'; // sexta 17h SP = véspera de segunda 9h
  const agora = new Date('2026-07-17T20:00:00.000Z');

  it('marcou 6 minutos antes da janela → QUEIMA (o caso real: lead marca 16h54, tick 17h00)', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: new Date(Date.parse(due) - 6 * 60_000).toISOString(),
      agora, enviadoEm: null,
    })).toBe(false);
  });

  it('marcou 2h59 antes → QUEIMA (borda de dentro)', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: new Date(Date.parse(due) - VESPERA_MIN_GAP_MS + 60_000).toISOString(),
      agora, enviadoEm: null,
    })).toBe(false);
  });

  it('marcou 3h01 antes → ENVIA (borda de fora)', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: new Date(Date.parse(due) - VESPERA_MIN_GAP_MS - 60_000).toISOString(),
      agora, enviadoEm: null,
    })).toBe(true);
  });

  it('marcou DEPOIS da janela abrir (17h20 p/ amanhã) → QUEIMA', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: '2026-07-17T20:20:00.000Z',
      agora: new Date('2026-07-17T20:25:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });
});

describe('deveEnviar — ativação', () => {
  it('envia na janela [T-30min, T-0]', () => {
    expect(deveEnviar({
      toque: 'ativacao', dataHora: SEG_15H, criadaEm: '2026-07-17T11:22:53.170Z',
      agora: new Date('2026-07-20T17:35:00.000Z'), enviadoEm: null,
    })).toBe(true);
  });

  it('NÃO envia depois de a reunião começar (cron parado 1h) — queima', () => {
    expect(deveEnviar({
      toque: 'ativacao', dataHora: SEG_15H, criadaEm: '2026-07-17T11:22:53.170Z',
      agora: new Date('2026-07-20T18:05:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });

  it('o GAP não se aplica à ativação: marcou 2h antes e ela sai mesmo assim', () => {
    // minLeadMinutes=120 permite marcar 10h p/ 12h. A ativação é o toque que importa.
    expect(deveEnviar({
      toque: 'ativacao', dataHora: SEG_15H,
      criadaEm: '2026-07-20T16:00:00.000Z', // 2h antes da reunião
      agora: new Date('2026-07-20T17:35:00.000Z'), enviadoEm: null,
    })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/meeting-reminder.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ai/followup/meeting-reminder-schedule"`

- [ ] **Step 3: Write minimal implementation**

Criar `lib/ai/followup/meeting-reminder-schedule.ts`:

```ts
/**
 * @fileoverview Lógica PURA da cadência 3 (lembrete anti-no-show). Sem I/O.
 * Ver spec 2026-07-17-followup-cadencia3-antinoshow-design.md §4.
 * @module lib/ai/followup/meeting-reminder-schedule
 */

const MIN_MS = 60 * 1000;
const H_MS = 60 * MIN_MS;
const DIA_MS = 24 * H_MS;
const SP_OFFSET_MS = -3 * H_MS; // Brasil sem DST (mesmo offset fixo do resto do módulo)

export type Toque = 'vespera' | 'ativacao';

/** Janela da ativação: abre 30min antes e expira quando a reunião começa. */
export const ATIVACAO_ANTES_MS = 30 * MIN_MS;
/** Janela da véspera: abre 17h00 e expira 17h30 (fim do gate de horário comercial do cron). */
export const VESPERA_HORA_SP = 17;
export const VESPERA_JANELA_MS = 30 * MIN_MS;

/**
 * Gap mínimo entre a marcação e a abertura da véspera.
 * Existe porque minLeadMinutes=120 + último slot às 17h ⇒ toda marcação feita depois das 15h
 * SP cai no próximo dia útil, e a véspera dela vence às 17h do MESMO dia. Sem gap, o lead que
 * marca 16h54 recebe "confirmando sua conversa de amanhã" às 17h00 — 6 minutos depois de
 * combinar isso no mesmo chat. Aproxima o invariante real: não lembrar de um horário que
 * acabou de ser combinado na mesma sessão de conversa.
 * Precedente no repo: schedule.ts:60-68 (gapDueMs anti-rajada do B1).
 */
export const VESPERA_MIN_GAP_MS = 3 * H_MS;

/** Componentes {year, month, day} de um instante, no fuso SP. */
function spParts(ms: number): { year: number; month: number; day: number } {
  const d = new Date(ms + SP_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Dia da semana SP (0=dom..6=sáb), avaliado ao meio-dia pra evitar borda de meia-noite. */
function weekdaySp(ms: number): number {
  const { year, month, day } = spParts(ms);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

/** epoch ms de uma hora local SP num dia SP. */
function spDateAtHour(ms: number, hour: number): number {
  const { year, month, day } = spParts(ms);
  return Date.UTC(year, month - 1, day, hour) - SP_OFFSET_MS;
}

/**
 * 17h00 SP do último dia útil ANTES da reunião. Reunião de segunda ⇒ sexta 17h.
 * Funciona porque a copy usa data ABSOLUTA ("segunda, 20/07, às 9h"), nunca "amanhã" — o
 * texto continua verdadeiro 3 dias antes.
 */
export function ultimoDiaUtilAntes(dataHoraIso: string): string {
  let cursor = Date.parse(dataHoraIso) - DIA_MS;
  // Recua enquanto cair em fim de semana.
  while (weekdaySp(cursor) === 0 || weekdaySp(cursor) === 6) cursor -= DIA_MS;
  return new Date(spDateAtHour(cursor, VESPERA_HORA_SP)).toISOString();
}

export function dueVespera(dataHoraIso: string): string {
  return ultimoDiaUtilAntes(dataHoraIso);
}

export function dueAtivacao(dataHoraIso: string): string {
  return new Date(Date.parse(dataHoraIso) - ATIVACAO_ANTES_MS).toISOString();
}

export interface DeveEnviarParams {
  toque: Toque;
  /** activities.date — a hora da reunião (fonte da verdade, não o JSON). */
  dataHora: string;
  /** activities.created_at — quando ESTA reunião foi marcada. */
  criadaEm: string;
  agora: Date;
  /** Timestamp do envio deste toque, se já saiu. */
  enviadoEm: string | null | undefined;
}

/**
 * As 3 condições do spec §4. "Queimado" NÃO é estado persistido — é o resultado destas
 * condições a cada tick.
 */
export function deveEnviar(p: DeveEnviarParams): boolean {
  if (p.enviadoEm) return false;

  const dataHoraMs = Date.parse(p.dataHora);
  const criadaEmMs = Date.parse(p.criadaEm);
  const agoraMs = p.agora.getTime();
  if (Number.isNaN(dataHoraMs) || Number.isNaN(criadaEmMs)) return false;

  const dueMs = Date.parse(p.toque === 'vespera' ? dueVespera(p.dataHora) : dueAtivacao(p.dataHora));
  const expiraMs = p.toque === 'vespera' ? dueMs + VESPERA_JANELA_MS : dataHoraMs;
  const gapMs = p.toque === 'vespera' ? VESPERA_MIN_GAP_MS : 0;

  if (agoraMs < dueMs || agoraMs > expiraMs) return false; // fora da janela (ou expirou = queimou)
  if (dueMs < criadaEmMs + gapMs) return false; // janela abriu antes/junto da marcação = queimou
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/meeting-reminder.test.ts`
Expected: PASS — 13 testes verdes.

- [ ] **Step 5: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/ai/followup/meeting-reminder-schedule.ts test/followup/meeting-reminder.test.ts
git commit -m "feat(followup): janelas dos toques da cadencia 3 (vespera + ativacao), puro"
```

---

### Task 2: `ultimoDiaUtilAntes` pula feriado

> Depende do `lib/ai/scheduling/holidays.ts` (Task 1 do plano de integridade). Se ele não
> existir ainda, **pare e execute aquele plano primeiro**.

**Files:**
- Modify: `lib/ai/followup/meeting-reminder-schedule.ts`
- Test: `test/followup/meeting-reminder.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append em `test/followup/meeting-reminder.test.ts`:

```ts
describe('ultimoDiaUtilAntes x feriado', () => {
  it('reunião terça 08/09 → véspera sexta 04/09 17h (pula o feriado de 07/09 E o fim de semana)', () => {
    const TER_08_09 = '2026-09-08T12:00:00.000Z'; // terça 08/09/2026 9h SP
    expect(ultimoDiaUtilAntes(TER_08_09)).toBe('2026-09-04T20:00:00.000Z'); // sexta 04/09 17h SP
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/meeting-reminder.test.ts -t "feriado"`
Expected: FAIL — recebe `2026-09-07T20:00:00.000Z` (segunda 07/09, Independência).

- [ ] **Step 3: Write minimal implementation**

Em `lib/ai/followup/meeting-reminder-schedule.ts`, adicionar o import:

```ts
import { isFeriado } from '../scheduling/holidays';
```

E trocar o corpo de `ultimoDiaUtilAntes`:

```ts
export function ultimoDiaUtilAntes(dataHoraIso: string): string {
  let cursor = Date.parse(dataHoraIso) - DIA_MS;
  // Recua enquanto cair em fim de semana OU feriado nacional — a véspera não pode cair num
  // dia em que ninguém lê nem o cron age.
  for (let i = 0; i < 10; i++) {
    const dow = weekdaySp(cursor);
    const { year, month, day } = spParts(cursor);
    if (dow !== 0 && dow !== 6 && !isFeriado(year, month, day)) break;
    cursor -= DIA_MS;
  }
  return new Date(spDateAtHour(cursor, VESPERA_HORA_SP)).toISOString();
}
```

> O teto de 10 iterações é fusível: nenhuma sequência de fim de semana + feriados nacionais
> encosta nisso, e sem ele um bug no `isFeriado` viraria loop infinito no cron.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/meeting-reminder.test.ts`
Expected: PASS — 14 testes (os 13 da Task 1 sem regressão + o do feriado).

- [ ] **Step 5: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/ai/followup/meeting-reminder-schedule.ts test/followup/meeting-reminder.test.ts
git commit -m "feat(followup): vespera pula feriado nacional (reusa scheduling/holidays)"
```

---

### Task 3: Copy fixa + `renderReminder`

**Files:**
- Create: `lib/ai/followup/meeting-reminder.ts`
- Test: `test/followup/meeting-reminder.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append em `test/followup/meeting-reminder.test.ts`:

```ts
import { renderReminder, TOQUES_COPY } from '@/lib/ai/followup/meeting-reminder';

describe('renderReminder', () => {
  it('interpola nome, label e consultor', () => {
    const out = renderReminder(TOQUES_COPY.ativacao, {
      nome: 'Nathalia', label: 'segunda, 20/07, às 15h', consultor: 'Denilson',
    });
    expect(out).toContain('Nathalia');
    expect(out).toContain('Denilson');
    expect(out).not.toContain('{');
  });

  it('NENHUM toque deixa placeholder por resolver (o {label} não existia no renderBubbles)', () => {
    for (const toque of Object.values(TOQUES_COPY)) {
      const out = renderReminder(toque, {
        nome: 'Maria', label: 'segunda, 20/07, às 15h', consultor: 'Denilson',
      });
      expect(out).not.toMatch(/\{|\}/);
    }
  });

  it('fallback: sem nome e sem consultor, não sobra chave nem pontuação órfã', () => {
    for (const toque of Object.values(TOQUES_COPY)) {
      const out = renderReminder(toque, { nome: '', label: 'segunda, 20/07, às 15h', consultor: 'o consultor' });
      expect(out).not.toMatch(/\{|\}/);
      expect(out).not.toMatch(/\s,|^,|\s\./m);
    }
  });

  it('guard-rail: toda chave usada na copy existe no objeto de vars', () => {
    const vars = new Set(['nome', 'label', 'consultor']);
    for (const toque of Object.values(TOQUES_COPY)) {
      for (const bolha of toque) {
        for (const m of bolha.matchAll(/\{(\w+)\}/g)) {
          expect(vars.has(m[1])).toBe(true);
        }
      }
    }
  });

  it('separa as bolhas com linha em branco (o splitIntoBubbles do sendAIResponse)', () => {
    const out = renderReminder(['Uma.', 'Duas.'], { nome: 'X', label: 'Y', consultor: 'Z' });
    expect(out).toBe('Uma.\n\nDuas.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/meeting-reminder.test.ts -t "renderReminder"`
Expected: FAIL — `Failed to resolve import "@/lib/ai/followup/meeting-reminder"`

- [ ] **Step 3: Write minimal implementation**

Criar `lib/ai/followup/meeting-reminder.ts` (só a parte de copy nesta task; o orquestrador entra na Task 4):

```ts
/**
 * @fileoverview Cadência 3 — lembrete anti-no-show da Ana. Copy FIXA (zero IA) + orquestrador.
 * Ancora em `activities`, NÃO em custom_fields.reuniao_agendada — ver spec §3.
 * @module lib/ai/followup/meeting-reminder
 */
import { firstName } from './copy';

/**
 * Copy fixa. Sem IA de propósito: o conteúdo é um horário que já vem pronto do
 * slotLabelFromIso, e em 07-15 a IA alucinou "[estado/cidade]" num toque quente
 * (ana-tuning-log #7). Bolhas curtas, sem emoji, sem travessão, "consultor" nunca "vendedor".
 */
export const TOQUES_COPY: Record<'vespera' | 'ativacao', string[]> = {
  // Véspera — 17h do último dia útil antes. Data ABSOLUTA (nunca "amanhã"): a véspera de uma
  // reunião de segunda sai na sexta, e o texto precisa continuar verdadeiro.
  vespera: [
    '{nome}, passando pra confirmar: sua conversa com {consultor} é {label}.',
    'É uma ligação rápida, de uns 30 minutos. Se precisar mudar o horário, é só me falar por aqui.',
  ],
  // Ativação — 30min antes. O toque que de fato combate o no-show.
  ativacao: [
    '{nome}, {consultor} já vai te ligar, daqui a pouco.',
    'Deixa o telefone à mão.',
  ],
};

export type ReminderVars = { nome: string; label: string; consultor: string };

/**
 * Interpola e junta as bolhas. NÃO usa o renderBubbles do copy.ts: ele só resolve {nome}
 * (copy.ts:50-58) e a assinatura nem recebe outras variáveis — seguir o design ao pé da letra
 * com ele entregaria "{label}" literal no WhatsApp, e isso COMPILA limpo (tsconfig strict:false,
 * no-unused-vars desligado). Não mexemos no renderBubbles pra não tocar no motor do B1.
 */
export function renderReminder(bolhas: string[], vars: ReminderVars): string {
  return bolhas
    .map((b) => {
      let out = b;
      for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
      return out.replace(/\s{2,}/g, ' ').replace(/\s+([,!?.])/g, '$1').replace(/^,\s*/, '').trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

export { firstName };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/meeting-reminder.test.ts`
Expected: PASS — 19 testes.

- [ ] **Step 5: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/ai/followup/meeting-reminder.ts test/followup/meeting-reminder.test.ts
git commit -m "feat(followup): copy fixa da cadencia 3 + renderReminder (renderBubbles so faz {nome})"
```

---

### Task 4: Orquestrador `runMeetingReminder`

**Files:**
- Modify: `lib/ai/followup/meeting-reminder.ts`
- Test: `test/followup/meeting-reminder.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append em `test/followup/meeting-reminder.test.ts`:

```ts
import { runMeetingReminder, type MeetingReminderDeps } from '@/lib/ai/followup/meeting-reminder';

/**
 * Supabase fake: thenable que resolve com as linhas no await, qualquer que seja o
 * encadeamento de filtros (mesmo padrão de test/followup/run.test.ts). O mock NÃO filtra —
 * passe já filtrado; os testes de filtro SQL ficam pra validação ao vivo.
 */
function makeSupabaseMR(cfg: {
  activities: unknown[]; deals: unknown[]; conversations: unknown[]; contacts: unknown[]; profiles?: unknown[];
}) {
  const dealUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  function thenable(rows: unknown[]) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit']) b[m] = () => b;
    b.then = (res: (v: { data: unknown[]; error: null }) => void) => res({ data: rows, error: null });
    return b;
  }
  const client = {
    from(table: string) {
      if (table === 'deals') {
        return {
          ...thenable(cfg.deals),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => { dealUpdates.push({ id, patch }); return { error: null }; },
          }),
        };
      }
      if (table === 'activities') return thenable(cfg.activities);
      if (table === 'messaging_conversations') return thenable(cfg.conversations);
      if (table === 'contacts') return thenable(cfg.contacts);
      if (table === 'profiles') return thenable(cfg.profiles ?? []);
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client: client as never, dealUpdates };
}

const AGORA = new Date('2026-07-20T17:35:00.000Z'); // segunda 14h35 SP = janela da ativação das 15h

function cenarioBase(over: { deal?: Record<string, unknown>; activity?: Record<string, unknown> } = {}) {
  const activity = {
    id: 'act-1', deal_id: 'deal-1', date: '2026-07-20T18:00:00.000Z',
    created_at: '2026-07-17T11:22:53.113Z', owner_id: 'u-den', ...over.activity,
  };
  const deal = { id: 'deal-1', organization_id: 'org-1', contact_id: 'c-1', custom_fields: {}, ...over.deal };
  return {
    activities: [activity], deals: [deal],
    conversations: [{ id: 'conv-1', contact_id: 'c-1', last_message_at: '2026-07-17T11:24:41.150Z', metadata: {} }],
    contacts: [{ id: 'c-1', name: 'Nathalia Quintero Ruiz', ai_paused: true }], // pausado DE PROPÓSITO
    profiles: [{ id: 'u-den', name: 'Denilson Silva' }],
  };
}

function deps(supa: unknown, over: Partial<MeetingReminderDeps> = {}): MeetingReminderDeps {
  return {
    supabase: supa as never,
    now: AGORA,
    sendResponse: vi.fn(async () => ({ success: true })),
    ...over,
  };
}

describe('runMeetingReminder', () => {
  it('envia a ativação com o nome do consultor e persiste ANTES de enviar', async () => {
    const { client, dealUpdates } = makeSupabaseMR(cenarioBase());
    const send = vi.fn(async () => ({ success: true }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));

    expect(r.processed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [convId, msg] = send.mock.calls[0];
    expect(convId).toBe('conv-1');
    expect(msg).toContain('Nathalia');
    expect(msg).toContain('Denilson');
    expect(msg).not.toMatch(/\{|\}/);
    // persistiu o estado
    expect(dealUpdates[0].patch.custom_fields).toMatchObject({
      meeting_reminder: expect.objectContaining({ activity_id: 'act-1', date: '2026-07-20T18:00:00.000Z' }),
    });
  });

  it('IGNORA ai_paused (decisão do spec §2.3): o contato do cenário base está pausado e recebe', async () => {
    const { client } = makeSupabaseMR(cenarioBase());
    const send = vi.fn(async () => ({ success: true }));
    await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('não reenvia o toque já enviado', async () => {
    const { client } = makeSupabaseMR(cenarioBase({
      deal: { custom_fields: { meeting_reminder: {
        activity_id: 'act-1', date: '2026-07-20T18:00:00.000Z', ativacao_sent_at: '2026-07-20T17:31:00.000Z',
      } } },
    }));
    const send = vi.fn(async () => ({ success: true }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).not.toHaveBeenCalled();
    expect(r.processed).toBe(0);
  });

  it('REMARCAÇÃO: date mudou → estado antigo é descartado e o toque sai de novo', async () => {
    const { client } = makeSupabaseMR(cenarioBase({
      deal: { custom_fields: { meeting_reminder: {
        activity_id: 'act-1', date: '2026-07-17T20:00:00.000Z', // sexta 17h — a reunião ANTIGA
        vespera_sent_at: '2026-07-16T20:00:00.000Z', ativacao_sent_at: '2026-07-17T19:30:00.000Z',
      } } },
    }));
    const send = vi.fn(async () => ({ success: true }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.processed).toBe(1);
  });

  it('no-show marcado DEPOIS da marcação → pula os dois toques', async () => {
    const { client } = makeSupabaseMR(cenarioBase({
      deal: { custom_fields: { no_show_at: '2026-07-20T17:00:00.000Z' } }, // depois do created_at
    }));
    const send = vi.fn(async () => ({ success: true }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  it('no-show ANTES da marcação (deu no-show e remarcou) → envia normal', async () => {
    const { client } = makeSupabaseMR(cenarioBase({
      deal: { custom_fields: { no_show_at: '2026-07-10T14:00:00.000Z' } }, // antes do created_at
    }));
    const send = vi.fn(async () => ({ success: true }));
    await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sem owner_id, cai em "o consultor" e não vaza chave', async () => {
    const { client } = makeSupabaseMR({ ...cenarioBase({ activity: { owner_id: null } }), profiles: [] });
    const send = vi.fn(async () => ({ success: true }));
    await runMeetingReminder(deps(client, { sendResponse: send }));
    const msg = send.mock.calls[0][1];
    expect(msg).toContain('o consultor');
    expect(msg).not.toMatch(/\{|\}/);
  });

  it('envio falhou → reverte o estado e conta failed', async () => {
    const { client, dealUpdates } = makeSupabaseMR(cenarioBase());
    const send = vi.fn(async () => ({ success: false }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(r.failed).toBe(1);
    expect(dealUpdates).toHaveLength(2); // gravou, depois reverteu
    expect((dealUpdates[1].patch.custom_fields as Record<string, unknown>).meeting_reminder)
      .not.toHaveProperty('ativacao_sent_at');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/meeting-reminder.test.ts -t "runMeetingReminder"`
Expected: FAIL — `runMeetingReminder is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append em `lib/ai/followup/meeting-reminder.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { slotLabelFromIso } from '../scheduling/availability';
import { deveEnviar, type Toque } from './meeting-reminder-schedule';

/** Horizonte da query: a véspera mais distante é a de uma reunião de segunda (sexta 17h = 3d). */
const HORIZONTE_DIAS = 4;
const SP_UTC_OFFSET = '-03:00';

export interface MeetingReminderDeps {
  supabase: SupabaseClient;
  now: Date;
  sendResponse: (conversationId: string, message: string) => Promise<{ success: boolean }>;
}

export interface MeetingReminderResult { processed: number; failed: number; skipped: number; }

interface EstadoLembrete {
  activity_id: string;
  date: string;
  vespera_sent_at?: string | null;
  ativacao_sent_at?: string | null;
}

type CF = Record<string, unknown>;

export async function runMeetingReminder(deps: MeetingReminderDeps): Promise<MeetingReminderResult> {
  const { supabase, now } = deps;
  const res: MeetingReminderResult = { processed: 0, failed: 0, skipped: 0 };

  // 1. FONTE DA VERDADE = activities. O JSON reuniao_agendada é podre (status terminal,
  //    schema divergente quando agendado por SQL, dessincronizado do calendário). Ver spec §3.
  const ateIso = new Date(now.getTime() + HORIZONTE_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const { data: acts } = await supabase
    .from('activities')
    .select('id, deal_id, date, created_at, owner_id')
    .eq('type', 'CALL')
    .is('deleted_at', null)
    .eq('completed', false)
    .gte('date', now.toISOString())
    .lte('date', ateIso)
    .not('deal_id', 'is', null);

  if (!acts || acts.length === 0) return res;

  const dealIds = [...new Set(acts.map((a) => a.deal_id as string))];
  const { data: deals } = await supabase
    .from('deals')
    .select('id, organization_id, contact_id, custom_fields')
    .in('id', dealIds)
    .eq('is_won', false)
    .eq('is_lost', false)
    .is('deleted_at', null);
  const dealById = new Map((deals ?? []).map((d) => [d.id as string, d]));

  const contactIds = [...new Set((deals ?? []).map((d) => d.contact_id as string).filter(Boolean))];
  if (contactIds.length === 0) return res;

  // Conversa MAIS RECENTE do contato (achado #3 da revisão do B1: contato multi-canal).
  const { data: convs } = await supabase
    .from('messaging_conversations')
    .select('id, contact_id, last_message_at')
    .in('contact_id', contactIds)
    .order('last_message_at', { ascending: false });
  const convByContact = new Map<string, Record<string, unknown>>();
  for (const c of convs ?? []) {
    const cid = c.contact_id as string | null;
    if (!cid || convByContact.has(cid)) continue;
    convByContact.set(cid, c);
  }

  const { data: contacts } = await supabase.from('contacts').select('id, name').in('id', contactIds);
  const contactById = new Map((contacts ?? []).map((c) => [c.id as string, c]));

  const ownerIds = [...new Set(acts.map((a) => a.owner_id as string).filter(Boolean))];
  const { data: profiles } = ownerIds.length
    ? await supabase.from('profiles').select('id, name').in('id', ownerIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  for (const act of acts) {
    const deal = dealById.get(act.deal_id as string);
    if (!deal) { res.skipped++; continue; }
    const contactId = deal.contact_id as string | null;
    const conv = contactId ? convByContact.get(contactId) : null;
    const contact = contactId ? contactById.get(contactId) : null;
    if (!conv || !contact) { res.skipped++; continue; }

    // NÃO checamos contact.ai_paused: o lembrete é aviso operacional de hora marcada, não
    // conversa (spec §2, decisão 3). Nem last_message_direction: o gatilho aqui é hora
    // marcada, não silêncio (decisão 4).

    const cf = (deal.custom_fields as CF | null) ?? {};

    // Guard do no-show — o único que a activities não resolve (a rota de no-show não toca na
    // activity, só grava no JSON). Comparar com created_at e NUNCA `no_show === true` flat:
    // ninguém limpa no_show, então o flat mataria o lembrete de todo lead que remarcou.
    const noShowAt = Date.parse(String(cf.no_show_at ?? ''));
    const criadaEmMs = Date.parse(act.created_at as string);
    if (Number.isFinite(noShowAt) && Number.isFinite(criadaEmMs) && noShowAt > criadaEmMs) {
      res.skipped++; continue;
    }

    const dataHora = act.date as string;
    const anterior = cf.meeting_reminder as EstadoLembrete | undefined;
    // Estado só vale pra ESTA reunião: activity_id novo (remarcação pelo booker) ou date novo
    // (edição manual na página de Atividades) ⇒ descarta e recomeça.
    const estado: EstadoLembrete =
      anterior && anterior.activity_id === act.id && anterior.date === dataHora
        ? anterior
        : { activity_id: act.id as string, date: dataHora };

    const toque: Toque | null =
      deveEnviar({ toque: 'ativacao', dataHora, criadaEm: act.created_at as string, agora: now, enviadoEm: estado.ativacao_sent_at })
        ? 'ativacao'
        : deveEnviar({ toque: 'vespera', dataHora, criadaEm: act.created_at as string, agora: now, enviadoEm: estado.vespera_sent_at })
          ? 'vespera'
          : null;
    if (!toque) { res.skipped++; continue; }

    const owner = act.owner_id ? profileById.get(act.owner_id as string) : null;
    const consultor = owner?.name ? firstName(owner.name as string) : 'o consultor';
    const msg = renderReminder(TOQUES_COPY[toque], {
      nome: firstName((contact.name as string | null) ?? ''),
      label: slotLabelFromIso(dataHora, SP_UTC_OFFSET),
      consultor,
    });

    // Idempotência: PERSISTE ANTES de enviar (lição do B1). Se morrer entre gravar e mandar, o
    // lead perde um lembrete; ao contrário, levaria o mesmo a cada 15min — em canal com risco
    // de ban, erra pro lado do silêncio.
    const avancado: EstadoLembrete = { ...estado, [`${toque}_sent_at`]: now.toISOString() };
    const okPersist = await persistir(supabase, deal.id as string, cf, avancado);
    if (!okPersist) { res.failed++; continue; }

    const sent = await deps.sendResponse(conv.id as string, msg);
    if (!sent.success) {
      await persistir(supabase, deal.id as string, cf, estado); // reverte (best-effort)
      res.failed++;
      continue;
    }
    res.processed++;
  }

  return res;
}

async function persistir(
  supabase: SupabaseClient, dealId: string, cfExistente: CF, estado: EstadoLembrete,
): Promise<boolean> {
  // custom_fields é REPLACE TOTAL no update ⇒ sempre spread do existente.
  const { error } = await supabase
    .from('deals')
    .update({ custom_fields: { ...cfExistente, meeting_reminder: estado }, updated_at: new Date().toISOString() })
    .eq('id', dealId);
  if (error) { console.error('[meeting-reminder] persist falhou p/ deal', dealId, error); return false; }
  return true;
}
```

> **Ordem dos toques:** a ativação é avaliada ANTES da véspera. As janelas não se sobrepõem
> (véspera = 17h do dia anterior; ativação = T-30min), mas se um dia se sobrepusessem, o toque
> que importa é o que está mais perto da ligação.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/meeting-reminder.test.ts`
Expected: PASS — 27 testes.

- [ ] **Step 5: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/ai/followup/meeting-reminder.ts test/followup/meeting-reminder.test.ts
git commit -m "feat(followup): orquestrador da cadencia 3 ancorado em activities

Query em activities (type=CALL, nao deletada, nao completed, date no horizonte)
em vez do JSON: atividade deletada some, completed exclui (botao de reuniao
realizada E audio->CRM), data editada na mao vira a verdade. Guard so p/ no-show
(a rota de no-show nao toca na activity). Ignora ai_paused e last_message_direction
por decisao do spec. Persiste antes de enviar."
```

---

### Task 5: Ligar no cron existente

**Files:**
- Modify: `app/api/cron/lead-followup/route.ts`

- [ ] **Step 1: Fazer a mudança**

Adicionar o import:

```ts
import { runMeetingReminder } from '@/lib/ai/followup/meeting-reminder';
```

E trocar o bloco do `runLeadFollowup` (linhas 43-53) por:

```ts
  const supabase = createStaticAdminClient();
  const sendResponse = (conversationId: string, message: string) =>
    sendAIResponse({ supabase, conversationId, response: message }).then((r) => ({ success: r.success }));

  const followup = await runLeadFollowup({
    supabase,
    now,
    sendResponse,
    generateWarm: (args) => generateWarmFollowupBubbles({ supabase, ...args }),
  });

  // Cadência 3 (lembrete anti-no-show). Módulo separado: seleção, matemática e parada são
  // outras — e ela ignora de propósito dois `if` que são a espinha do runLeadFollowup.
  const reminder = await runMeetingReminder({ supabase, now, sendResponse });

  console.log('[Cron:lead-followup]', JSON.stringify({ followup, reminder }));
  return json({ followup, reminder });
```

- [ ] **Step 2: Verificar que o teste da rota não quebrou**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/route.test.ts`
Expected: PASS. Se o teste assertar o shape antigo do JSON de resposta (`{processed, failed...}` na raiz), atualizar para o novo (`{followup, reminder}`) — o formato do log mudou de propósito.

- [ ] **Step 3: Commit**

```bash
cd /c/Projetos/nossocrm
git add app/api/cron/lead-followup/route.ts test/followup/route.test.ts
git commit -m "feat(cron): cadencia 3 no cron existente (sem migration nem job pg_cron novo)"
```

---

### Task 6: Rota de cancelar reunião

> **Pré-requisito de entrega da cadência 3** (spec §7): hoje NÃO existe nenhuma forma de
> cancelar reunião no CRM. Sem isso, lead que cancela recebe "deixa o telefone à mão", e como
> o lembrete ignora `ai_paused` não sobra kill switch.

**Files:**
- Create: `app/api/deals/[dealId]/cancel-meeting/route.ts`
- Read first: `app/api/deals/[dealId]/no-show/route.ts` (o molde: auth, gate de org, admin client)

- [ ] **Step 1: Ler o molde**

Run: `cd /c/Projetos/nossocrm && cat "app/api/deals/[dealId]/no-show/route.ts"`

Copiar dali: o padrão de auth do usuário, a leitura do deal via RLS (gate de org — **obrigatório**: foi um HIGH de segurança multi-tenant na revisão do áudio→CRM), o admin client pros writes e o formato de resposta.

- [ ] **Step 2: Escrever a rota**

Criar `app/api/deals/[dealId]/cancel-meeting/route.ts`, seguindo o molde lido no Step 1:

```ts
/**
 * POST /api/deals/[dealId]/cancel-meeting
 *
 * Cancela a reunião marcada: soft-delete da activity + reuniao_agendada.status='cancelada'.
 * Existe porque NÃO havia nenhum caminho de cancelamento no CRM: `cancelMeeting` só era
 * alcançável pela conversa da Ana no board dela (config.ts:26-29 → scheduling.service.ts:45-48),
 * então 'confirmada' era estado terminal. Sem isto, a cadência 3 anuncia reunião cancelada.
 *
 * NÃO move board e NÃO marca perdido: cancelar não é perder — o lead quer remarcar.
 * Idempotente: cancelar de novo devolve 200.
 */
import { cancelMeeting } from '@/lib/ai/scheduling/booker';

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  // 1. auth do usuário + leitura do deal via RLS (404 se não for da org) — MESMO padrão da
  //    rota de no-show. Sem isto, user da org A cancela reunião de deal da org B.
  // 2. const activityId = deal.custom_fields?.reuniao_agendada?.activity_id
  //    Se ausente (deal legado / agendado à mão), resolver pela activity CALL aberta do deal:
  //      select id from activities where deal_id = dealId and type='CALL'
  //        and deleted_at is null and completed = false order by date limit 1
  //    Se ainda assim não houver → 200 { ok: true, already: true } (nada pra cancelar).
  // 3. Idempotência: se reuniao_agendada.status === 'cancelada' → 200 { ok: true, already: true }
  // 4. await cancelMeeting({ supabase: admin, dealId, activityId })
  // 5. 200 { ok: true }
}
```

> ⚠️ O bloco acima é o **contrato**, não código pronto: os detalhes de auth/admin client têm que
> sair do arquivo lido no Step 1, pra não divergir do padrão do repo. `cancelMeeting`
> (`booker.ts:164`) já faz o soft-delete da activity + `status='cancelada'` + remove a tag —
> **não reimplementar**.

- [ ] **Step 3: Verificar**

Run: `cd /c/Projetos/nossocrm && npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 4: Commit**

```bash
cd /c/Projetos/nossocrm
git add "app/api/deals/[dealId]/cancel-meeting/route.ts"
git commit -m "feat(deals): rota de cancelar reuniao (nao existia caminho nenhum no CRM)"
```

---

### Task 7: Botão "Cancelar reunião" no card

**Files:**
- Create: `lib/query/hooks/useCancelMeeting.ts`
- Modify: `features/boards/components/Kanban/KanbanBoard.tsx:374-375`, `features/boards/components/Kanban/DealCard.tsx:458-470`, `features/boards/components/Modals/DealDetailModal.tsx:589`

- [ ] **Step 1: Ler os vizinhos**

Run: `cd /c/Projetos/nossocrm && grep -n "onMarkNoShow\|useMarkNoShow\|isMarkingNoShow" features/boards/components/Kanban/KanbanBoard.tsx features/boards/components/Kanban/DealCard.tsx lib/query/hooks/useMarkNoShow.ts`

O botão de no-show é o molde exato: hook + gating `boardId === CONSULTOR_BOARD_ID` + `window.confirm` + trava anti-duplo-clique.

- [ ] **Step 2: Criar o hook**

`lib/query/hooks/useCancelMeeting.ts`, espelhando `useMarkNoShow.ts` (mesma invalidação de cache), apontando pra `POST /api/deals/${dealId}/cancel-meeting`.

- [ ] **Step 3: Ligar o botão**

- `KanbanBoard.tsx`: passar `onCancelMeeting={boardId === CONSULTOR_BOARD_ID ? handleCancelMeeting : undefined}` (mesmo padrão das linhas 374-375).
- `DealCard.tsx`: renderizar o botão junto do de no-show, com `window.confirm('Cancelar a reunião marcada? A ligação sai da agenda do consultor e o lead para de receber lembretes.')`.
- `DealDetailModal.tsx:589`: mesmo botão no header, gated igual.

- [ ] **Step 4: Verificar**

Run: `cd /c/Projetos/nossocrm && npx tsc --noEmit && npx next lint`
Expected: zero erros.

- [ ] **Step 5: Commit**

```bash
cd /c/Projetos/nossocrm
git add lib/query/hooks/useCancelMeeting.ts features/boards/
git commit -m "feat(boards): botao Cancelar reuniao no card do Consultor"
```

---

### Task 8: Verificação final + deploy + observação

- [ ] **Step 1: Suíte completa**

Run: `cd /c/Projetos/nossocrm && npx vitest run test/followup/ test/scheduling/ && npx tsc --noEmit && npx next lint`
Expected: PASS, zero erros. (As 13 falhas da suíte geral são **pré-existentes** — HANDOFF 07-13 §GOTCHA.)

- [ ] **Step 2: Deploy**

```bash
cd /c/Projetos/nossocrm
git push origin feat/lead-intake-route:main
```

- [ ] **Step 3: Disparo manual (não esperar o cron)**

No Supabase (`nossocrmv2` = `htmgjcelsnldxjbygfcw`):

```sql
select net.http_get(
  url := (select decrypted_secret from vault.decrypted_secrets where name='lead_followup_url'),
  headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cron_secret'))
);
-- depois:
select status_code, left(content, 200) from net._http_response order by created desc limit 5;
```

Expected: `200` com `{"followup":{...},"reminder":{...}}`.

- [ ] **Step 4: Conferir o estado**

```sql
select d.title, a.date, a.completed,
       d.custom_fields->'meeting_reminder' as estado_lembrete
from activities a
join deals d on d.id = a.deal_id
where a.type='CALL' and a.deleted_at is null and a.date >= now()
order by a.date;
```

- [ ] **Step 5: Reportar à Thalita (não marcar como validado sozinho)**

O caso vivo pra observar é a **Nathalia** (deal `9b1afb1c`, reunião segunda 20/07 15h, corrigida à
mão em 17/07): a véspera dela deve sair **sexta 17h** e a ativação **segunda 14h30**. Conferir que
a copy sai limpa (sem `{`), com "Denilson" e o label "segunda, 20/07, às 15h".

---

## Self-Review

**Cobertura do spec:**
- §2 decisões 1-7 → toques (Task 1), módulo separado (Tasks 3-5), ignora ai_paused (Task 4 + teste explícito), ignora last_message_direction (Task 4), activities como fonte (Task 4), copy fixa (Task 3), botão cancelar (Tasks 6-7) ✓
- §3 virada p/ activities → Task 4 (query) ✓
- §4 matemática + gap + expira + último dia útil + feriado → Tasks 1 e 2 ✓
- §5 seleção + guard do no-show → Task 4 ✓
- §6 estado chaveado em (activity_id, date) + persist-antes-de-enviar → Task 4 ✓
- §7 cancelar → Tasks 6 e 7 ✓
- §8 copy + renderReminder + profiles.name + firstName → Task 3 (render) e Task 4 (leitura do owner) ✓
- §9 riscos aceitos → nada a implementar ✓
- §10 testes → todos viraram teste nas Tasks 1-4 ✓
- §11 arquivos → bate, com um desvio: o spec dizia "copy dentro do módulo"; o plano separa a
  lógica pura em `meeting-reminder-schedule.ts` (a copy segue dentro do `meeting-reminder.ts`,
  como o spec pede). Motivo: manter `meeting-reminder.ts` focado no orquestrador e testar as
  janelas sem carregar o cliente Supabase — espelha a separação `schedule.ts`/`run.ts` do B1.

**Consistência de tipos:** `deveEnviar(DeveEnviarParams): boolean` (Task 1) usado na Task 4 com os
mesmos 5 campos. `Toque = 'vespera' | 'ativacao'` (Task 1) indexa `TOQUES_COPY` (Task 3) e a chave
de estado `${toque}_sent_at` (Task 4) — os nomes batem com `vespera_sent_at`/`ativacao_sent_at` do
`EstadoLembrete`. `renderReminder(bolhas, vars)` (Task 3) chamado na Task 4 com
`{nome, label, consultor}` = `ReminderVars`. `firstName` reusado de `copy.ts:45` via re-export.
`slotLabelFromIso(iso, utcOffset)` bate com `availability.ts:86`. `isFeriado(year, month, day)` da
Task 2 bate com o plano de integridade.
