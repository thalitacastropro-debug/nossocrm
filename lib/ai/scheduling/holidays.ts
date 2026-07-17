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
    const dt = new Date(easterMs + offset * DIA_MS);
    out.add(mmdd(dt.getUTCMonth() + 1, dt.getUTCDate()));
  }
  return out;
}

/** Feriado nacional? `month` é 1-12. Recebe a data já em componentes SP. */
export function isFeriado(year: number, month: number, day: number): boolean {
  const key = mmdd(month, day);
  if (FIXOS.has(key)) return true;
  return moveisDoAno(year).has(key);
}
