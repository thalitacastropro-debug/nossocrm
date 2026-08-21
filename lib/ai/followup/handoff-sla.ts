/**
 * @fileoverview SLA do handoff Ana→humano (P0.4, 4ª causa).
 *
 * PROBLEMA: quando a etapa tem `notify_team`, a Ana entrega o lead pro humano e cala.
 * Ela grava `ai_handoff_pending` na conversa e manda UM aviso no Telegram — e nada no
 * CRM inteiro jamais lê essa flag. Se ninguém pegar, o lead espera pra sempre.
 * A Mônica foi entregue às **00:24 da madrugada** de 19/07, no turno em que mandou
 * "1200 duas vidas" (o dado que faltava pra qualificar). O aviso saiu pra ninguém e
 * ela nunca mais teve resposta. O Cleysson, mesma coisa, 02:51.
 *
 * DECISÃO DA THALITA (20/08):
 *   - 2 HORAS ÚTEIS sem ninguém responder  → segundo aviso, agora também pro Telegram dela
 *   - 1 DIA ÚTIL parado                    → a Ana RETOMA e mantém o lead aquecido
 *
 * POR QUE HORA ÚTIL E NÃO HORA CORRIDA: é o caso Mônica. Com relógio corrido, um lead
 * entregue 00:24 estoura o prazo às 02:24 e o segundo aviso vai pro vazio igual ao
 * primeiro. Contando expediente, o relógio dela só começa às 08:00.
 *
 * O risco de a Ana atropelar o consultor é baixo por construção: 1 dia útil INTEIRO sem
 * nenhum humano escrever significa que ninguém pegou mesmo — e qualquer resposta humana
 * encerra o SLA na hora (`humanRepliedAt`).
 */

/** Expediente: 08:00–17:30, seg–sex. Espelha app/api/cron/lead-followup/route.ts. */
const BUSINESS_START_MIN = 8 * 60;
const BUSINESS_END_MIN = 17 * 60 + 30;
const BUSINESS_DAYS = [1, 2, 3, 4, 5];
/** America/São_Paulo como offset fixo — mesma convenção do resto do scheduling. */
const TZ_OFFSET_HOURS = -3;

/** 2 horas úteis. */
export const SLA_SEGUNDO_AVISO_MIN = 120;
/** 1 dia útil = 08:00→17:30 = 9h30. */
export const SLA_RETOMADA_MIN = BUSINESS_END_MIN - BUSINESS_START_MIN;
/**
 * Teto de idade do handoff: 5 dias úteis (1 semana de expediente).
 *
 * ANTI-RAJADA. Descoberto conferindo o banco ANTES do primeiro deploy: havia 7 handoffs
 * pendentes de JULHO, o mais velho de 10/07. Sem teto, o primeiro tick do cron mandaria a
 * mensagem de retomada pra 5 leads parados há mais de um mês — a mesma mensagem fora de hora
 * que a dona reclamou no caso Valdenice. Vale igualmente se o cron ficar dias fora do ar e
 * voltar com backlog. Acima do teto o handoff é considerado MORTO: encerra em silêncio, sem
 * mandar nada. Mesmo espírito do anti-rajada da cadência (commit a920cc8).
 */
export const SLA_JANELA_MAX_MIN = 5 * (BUSINESS_END_MIN - BUSINESS_START_MIN);

const MS_PER_MIN = 60_000;

function toLocal(d: Date): Date {
  return new Date(d.getTime() + TZ_OFFSET_HOURS * 60 * 60 * 1000);
}

/**
 * Minutos de EXPEDIENTE entre dois instantes (fora do horário e fim de semana não contam).
 *
 * Datas invertidas devolvem 0 em vez de negativo — o chamador é um cron, e um relógio
 * torto não pode virar "prazo estourado".
 */
export function businessMinutesBetween(from: string | Date, to: Date): number {
  const start = typeof from === 'string' ? new Date(from) : from;
  if (Number.isNaN(start.getTime()) || Number.isNaN(to.getTime())) return 0;
  if (to <= start) return 0;

  const localStart = toLocal(start);
  const localEnd = toLocal(to);

  let total = 0;
  // Varre dia a dia no calendário LOCAL, somando a interseção com a janela do expediente.
  const cursor = new Date(
    Date.UTC(localStart.getUTCFullYear(), localStart.getUTCMonth(), localStart.getUTCDate())
  );
  const lastDay = Date.UTC(localEnd.getUTCFullYear(), localEnd.getUTCMonth(), localEnd.getUTCDate());

  while (cursor.getTime() <= lastDay) {
    if (BUSINESS_DAYS.includes(cursor.getUTCDay())) {
      const dayStart = cursor.getTime() + BUSINESS_START_MIN * MS_PER_MIN;
      const dayEnd = cursor.getTime() + BUSINESS_END_MIN * MS_PER_MIN;
      const janelaIni = Math.max(dayStart, localStart.getTime());
      const janelaFim = Math.min(dayEnd, localEnd.getTime());
      if (janelaFim > janelaIni) total += Math.round((janelaFim - janelaIni) / MS_PER_MIN);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return total;
}

export interface HandoffSlaState {
  /** Quando a Ana entregou (metadata.ai_handoff_at). */
  handoffAt: string;
  /** Quando o 2º aviso já foi mandado (null = ainda não). */
  segundoAvisoAt: string | null;
  /** 1ª mensagem de HUMANO após o handoff (null = ninguém pegou). */
  humanRepliedAt: string | null;
  /** Quando a Ana já retomou (null = ainda não). */
  retomadaAt: string | null;
}

export type HandoffSlaAcao = 'nada' | 'encerrar' | 'segundo_aviso' | 'retomar';

export interface HandoffSlaResult {
  acao: HandoffSlaAcao;
  minutosUteis: number;
}

/**
 * Decide o que fazer com um handoff pendente. Pura — o cron cuida do I/O.
 *
 * Precedência: resposta humana > retomar > segundo aviso. "Retomar" ganha do "segundo
 * aviso" quando os dois vencem juntos (cron parado, backlog): não faz sentido mandar o
 * alerta de 2h junto com a retomada de 1 dia.
 */
export function resolveHandoffSla(state: HandoffSlaState, now: Date): HandoffSlaResult {
  const minutosUteis = businessMinutesBetween(state.handoffAt, now);

  // Alguém do time respondeu: o handoff cumpriu o papel, para de vigiar.
  if (state.humanRepliedAt) return { acao: 'encerrar', minutosUteis };

  // Já retomou: nada a fazer (não reengaja em loop).
  if (state.retomadaAt) return { acao: 'nada', minutosUteis };

  // Velho demais: reengajar agora seria pior que não reengajar. Encerra sem mandar nada.
  if (minutosUteis > SLA_JANELA_MAX_MIN) return { acao: 'encerrar', minutosUteis };

  if (minutosUteis >= SLA_RETOMADA_MIN) return { acao: 'retomar', minutosUteis };

  if (minutosUteis >= SLA_SEGUNDO_AVISO_MIN && !state.segundoAvisoAt) {
    return { acao: 'segundo_aviso', minutosUteis };
  }

  return { acao: 'nada', minutosUteis };
}
