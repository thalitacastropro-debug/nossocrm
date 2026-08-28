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
  /** Falhas de ENVIO seguidas (não de cadência). Zera no primeiro envio que dá certo. */
  fail_count?: number;
  last_failed_at?: string | null;
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

/**
 * Retry de ENVIO — nasceu do incidente de 28/08/2026 (WhatsApp desconectado).
 *
 * Falha de envio reverte a cadência (o toque não foi entregue, não pode ser consumido),
 * e sem freio o cron retentava o MESMO toque a cada 15 min para sempre. O freio é duplo:
 * backoff exponencial entre as tentativas e um teto de falhas seguidas que para a
 * cadência e avisa gente de verdade. Ambos zeram no primeiro envio que dá certo.
 */
/**
 * 3, e não mais: o cron só roda em horário comercial, então cada falha "custa" o backoff
 * inteiro em tempo de relógio. Com 3 o alarme sai ~1h30 depois da primeira falha; com 5
 * sairia no fim da tarde — tarde demais para uma queda que começa de manhã.
 */
export const MAX_FALHAS_SEGUIDAS = 3;
export const BACKOFF_BASE_MS = 30 * MIN;
/** Teto do backoff: além disso o alarme já disparou, esperar mais não ajuda. */
export const BACKOFF_MAX_MS = 8 * H;

/** Espera exigida DEPOIS da n-ésima falha seguida: 30min, 1h, 2h, 4h… até o teto. */
export function backoffMs(failCount: number): number {
  if (failCount <= 0) return 0;
  return Math.min(BACKOFF_BASE_MS * 2 ** (failCount - 1), BACKOFF_MAX_MS);
}

export function registerFailure(state: FollowupState, failedAt: Date): FollowupState {
  const failCount = (state.fail_count ?? 0) + 1;
  const esgotou = failCount >= MAX_FALHAS_SEGUIDAS;
  return {
    ...state,
    fail_count: failCount,
    last_failed_at: failedAt.toISOString(),
    stopped: esgotou ? true : (state.stopped ?? false),
    stopped_reason: esgotou ? 'falhas_de_envio' : (state.stopped_reason ?? null),
  };
}

export function clearFailures(state: FollowupState): FollowupState {
  if (!state.fail_count && !state.last_failed_at) return state;
  return { ...state, fail_count: 0, last_failed_at: null };
}

export function nextDueTouch(state: FollowupState, now: Date): TouchDecision | null {
  if (state.stopped) return null;

  // Backoff: depois de uma falha de envio, o mesmo toque só volta a ser tentado quando a
  // espera exponencial vencer. Sem isto, o toque devido é retentado a cada rodada do cron.
  if (state.fail_count && state.last_failed_at) {
    const failedMs = Date.parse(state.last_failed_at);
    if (!Number.isNaN(failedMs) && now.getTime() < failedMs + backoffMs(state.fail_count)) return null;
  }

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
