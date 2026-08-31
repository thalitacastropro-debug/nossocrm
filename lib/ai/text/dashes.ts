/**
 * @fileoverview Tira o travessão das mensagens da Ana.
 *
 * Morava dentro de `agent.service` (2 mil linhas, cliente de IA, Supabase,
 * agendamento...). Saiu de lá em 31/08/2026 porque o OPENER precisava dele: a
 * rota pública de intake importar o agent.service inteiro só para limpar um
 * traço arrastava o módulo todo para o caminho de entrada de lead — e, no teste,
 * qualquer mock parcial de `agent.service` fazia a função virar `undefined` e o
 * opener morrer em silêncio (ele é best-effort e engole exceção).
 *
 * `agent.service` re-exporta daqui, então nada que já importava de lá quebrou.
 *
 * @module lib/ai/text/dashes
 */

/**
 * Remove o travessão "—" (e variantes en-dash "–", barra horizontal "―" e "--")
 * das mensagens da Ana. O travessão denuncia texto de IA de cara: humano no
 * WhatsApp não usa. A persona pede pra evitar (e desde 31/08 proíbe por escrito),
 * mas o modelo às vezes escorrega, então garantimos no código, no envio. Vira
 * vírgula quando separa orações ("você — segunda" → "você, segunda"). NÃO toca no
 * hífen simples de datas/compostos ("13-07", "bem-estar").
 */
export function stripDashTells(text: string): string {
  return text
    .replace(/\s*[—–―]\s*/g, ', ') // travessão/en-dash/barra → vírgula
    .replace(/\s+--\s+/g, ', ') // "--" usado como travessão
    .replace(/\s+,/g, ',') // espaço antes de vírgula que possa ter sobrado
    .replace(/,\s*,/g, ',') // vírgula dupla
    .replace(/^\s*,\s*/, '') // vírgula solta no início
    .replace(/\s*,\s*$/, '') // vírgula solta no fim
    .trim();
}
