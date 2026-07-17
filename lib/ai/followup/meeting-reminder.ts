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
