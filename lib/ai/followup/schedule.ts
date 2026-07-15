/**
 * Lógica PURA do motor de follow-up da Ana (cadências fria/quente).
 * Sem I/O — testável isoladamente. Ver spec 2026-07-13-followup-cadencias-ana-design.md.
 */

export type Cadence = 'cold' | 'warm';

export interface FollowupState {
  cadence: Cadence;
  anchor_at: string; // ISO UTC, congelado na 1ª detecção
  count: number; // toques já enviados (0 = nenhum)
  last_sent_at?: string | null;
  stopped?: boolean;
  stopped_reason?: string | null;
}

const H = 60 * 60 * 1000;
const MIN = 60 * 1000;

// Offsets a partir da âncora (ms). 4 toques frios / 3 quentes.
export const COLD_SCHEDULE_MS = [3 * H, 24 * H, 96 * H, 240 * H]; // +3h, +1d, +4d, +10d
export const WARM_SCHEDULE_MS = [15 * MIN, 24 * H, 120 * H]; // +15min, +1d, +5d

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
  isLast: boolean; // este envio atinge o máximo
}

export function nextDueTouch(state: FollowupState, now: Date): TouchDecision | null {
  if (state.stopped) return null;
  const schedule = scheduleFor(state.cadence);
  if (state.count >= schedule.length) return null;
  const anchorMs = Date.parse(state.anchor_at);
  if (Number.isNaN(anchorMs)) return null;

  // Devido pela âncora (offset fixo desde o início da cadência).
  const anchorDueMs = anchorMs + schedule[state.count];

  // Espaçamento mínimo desde o ÚLTIMO envio: evita rajada quando a âncora é antiga
  // (backlog) ou o cron ficou parado — o toque N só sai após o gap normal entre N-1 e N.
  let gapDueMs = Number.NEGATIVE_INFINITY;
  if (state.count > 0 && state.last_sent_at) {
    const lastSentMs = Date.parse(state.last_sent_at);
    if (!Number.isNaN(lastSentMs)) {
      gapDueMs = lastSentMs + (schedule[state.count] - schedule[state.count - 1]);
    }
  }

  const dueMs = Math.max(anchorDueMs, gapDueMs);
  if (now.getTime() < dueMs) return null;
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
