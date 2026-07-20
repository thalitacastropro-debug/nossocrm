/**
 * @fileoverview Mensagem de resgate de No-show, na voz da Ana (UMA bolha, sem emoji).
 * Quando o consultor marca no-show, a Ana reabre a conversa e JÁ oferece 2 horários livres
 * reais (encaixe mesmo-dia incluso) — em vez do texto genérico "consigo reagendar". Função
 * PURA: recebe o nome + os slots já calculados pelo motor de agenda; sem I/O.
 * @module lib/ai/scheduling/no-show-message
 */

import type { Slot } from './types';

/**
 * Monta a mensagem de resgate.
 * - 2+ slots → oferece os 2 primeiros ("consigo te encaixar {a} ou {b}. Qual fica melhor?").
 * - 1 slot   → oferece o único ("tenho {a} — te serve?").
 * - 0 slots  → fallback pro texto genérico (agenda cheia/sem consultor/erro no cálculo).
 */
export function buildRescueMessage(nome: string | null, slots: Slot[]): string {
  const abertura = nome
    ? `Oi ${nome}, o consultor tentou te ligar agora no horário e não conseguiu completar. Aconteceu algum imprevisto?`
    : `O consultor tentou te ligar agora no horário e não conseguiu completar. Aconteceu algum imprevisto?`;

  if (slots.length >= 2) {
    return `${abertura} Consigo reagendar pra gente não perder essa conversa — consigo te encaixar ${slots[0].label} ou ${slots[1].label}. Qual fica melhor pra você?`;
  }
  if (slots.length === 1) {
    return `${abertura} Consigo reagendar pra gente não perder essa conversa — tenho ${slots[0].label}. Te serve?`;
  }
  return `${abertura} Consigo reagendar pra gente não perder essa conversa.`;
}
