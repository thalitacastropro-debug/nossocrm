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

/**
 * Janela em que a ANA pode mandar follow-up. **Não confundir com expediente humano.**
 *
 * O 1º toque sempre foi 24/7 por decisão explícita ("a Ana engaja 24/7, é IA; quem respeita
 * horário comercial é só o AGENDAMENTO" — ver app/api/public/v1/leads/route.ts). Só que o cron do
 * follow-up desligava tudo fora de 08:00–17:30 seg–sex. As duas peças nasceram em momentos
 * diferentes e ninguém decidiu a contradição: a Ana podia abordar um estranho à meia-noite, mas
 * não mandar o 2º toque às 18:00 de uma sexta.
 *
 * Numa cadência de 10 dias isso diluía. Na de 3 dias (09/09/2026) virava a maior parte do prazo —
 * de sexta 17:30 a segunda 08:00 são **62h30 de silêncio**, mais de dois dos três dias.
 *
 * Janela escolhida pela Thalita (09/09/2026): **08:00–21:00, seg–sáb**. Sai de 47h30 para 78h
 * úteis por semana (+64%) e encolhe o buraco do fim de semana de 62h30 para 35h. Pega a noite, que
 * é quando as pessoas de fato respondem WhatsApp.
 *
 * Por que NÃO 24/7, mesmo sendo o princípio declarado: o opener de madrugada é resposta a uma ação
 * que o lead acabou de fazer (preencheu o formulário segundos antes). Follow-up às 3h para quem
 * ignorou é outra coisa — irrita, e num WhatsApp não-oficial aumenta risco de bloqueio do número.
 */
export const JANELA_ANA = {
  inicioMin: 8 * 60, // 08:00
  fimMin: 21 * 60, // 21:00
  dias: [1, 2, 3, 4, 5, 6] as readonly number[], // seg–sáb (0 = domingo)
  /** America/São_Paulo como offset fixo — mesma convenção do resto do scheduling. */
  tzOffsetHours: -3,
} as const;

/** A Ana pode mandar follow-up NESTE instante? Pura: recebe o `now` em vez de olhar o relógio. */
export function anaPodeFalar(now: Date): boolean {
  const local = new Date(now.getTime() + JANELA_ANA.tzOffsetHours * H);
  if (!JANELA_ANA.dias.includes(local.getUTCDay())) return false;
  const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutos >= JANELA_ANA.inicioMin && minutos <= JANELA_ANA.fimMin;
}

// Offsets a partir da âncora (ms). 3 toques em cada cadência, ambas fechando em 3 DIAS.
//
// MUDANÇA 09/09/2026 (Thalita): *"vamos ajustar a cadência de follow up da Ana para 3 dias e
// depois ela já passa esse lead pro consultor, assim o lead não esfria tanto"* — 3 dias no TOTAL,
// não entre toques. Antes a fria levava 4 toques e **10 dias** até a entrega ao consultor (10,5
// dias reais, medido em produção) e a quente, 5 — tempo demais para um lead pago que acabou de
// levantar a mão.
//
// A fria perdeu um toque (era 4). O que saiu foi o ângulo do "reajuste composto", que pressupõe
// que a pessoa JÁ TEM plano — e boa parte destes leads responde "não tenho ainda" no próprio
// formulário. Os três ângulos que ficaram funcionam com ou sem plano atual.
//
// ⚠️ A Ana só fala em horário comercial (seg–sex, 08:00–17:30): um toque devido na sexta à noite
// só sai na segunda. Numa janela de 3 dias isso pesa muito mais do que pesava numa de 10 — a
// cadência real de um lead que entra na quinta é mais longa que a nominal.
export const COLD_SCHEDULE_MS = [3 * H, 24 * H, 72 * H]; // +3h, +1d, +3d
export const WARM_SCHEDULE_MS = [15 * MIN, 24 * H, 72 * H]; // +15min, +1d, +3d

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
