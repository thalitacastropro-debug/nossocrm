/**
 * @fileoverview Lógica PURA da cadência 3 (lembrete anti-no-show). Sem I/O.
 * Ver spec 2026-07-17-followup-cadencia3-antinoshow-design.md §4.
 * @module lib/ai/followup/meeting-reminder-schedule
 */
import { isFeriado } from '../scheduling/holidays';

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
  // Recua enquanto cair em fim de semana OU feriado nacional — a véspera não pode cair num
  // dia em que ninguém lê nem o cron age. Teto de 10 iterações é fusível: nenhuma sequência
  // real de fim de semana + feriados encosta nisso, e sem ele um bug no isFeriado viraria
  // loop infinito no cron.
  for (let i = 0; i < 10; i++) {
    const dow = weekdaySp(cursor);
    const { year, month, day } = spParts(cursor);
    if (dow !== 0 && dow !== 6 && !isFeriado(year, month, day)) break;
    cursor -= DIA_MS;
  }
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
