/**
 * @fileoverview Detecção de intenção de agendamento na conversa (LLM) + validação
 * determinística do horário contra os slots oferecidos (anti-alucinação).
 * @module lib/ai/scheduling/detect
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModel, type AIProvider } from '../config';
import type { DetectResult, Slot } from './types';

const DetectSchema = z.object({
  intent: z.enum(['accept', 'reschedule', 'cancel', 'none']).describe(
    'accept: lead aceitou um horário oferecido. reschedule: já tinha marcado e quer mudar. cancel: quer desmarcar. none: nada de agendamento agora.',
  ),
  slotIso: z.string().nullable().describe(
    'Horário aceito/desejado em ISO UTC, EXATAMENTE igual a um dos "Horários oferecidos". null se não deu pra casar.',
  ),
});

/** Casa o horário detectado com um slot oferecido (tolera segundos; compara no minuto). */
export function validateDetectedSlot(slotIso: string | null, offered: Slot[]): Slot | null {
  if (!slotIso) return null;
  const t = new Date(slotIso).getTime();
  if (Number.isNaN(t)) return null;
  const minute = Math.floor(t / 60000);
  return offered.find((s) => Math.floor(new Date(s.startIso).getTime() / 60000) === minute) ?? null;
}

export interface DetectParams {
  supabase: SupabaseClient;
  conversationId: string;
  offered: Slot[];
  aiConfig: { provider: AIProvider; apiKey: string; model: string };
}

const MAX_MESSAGES = 12;

export async function detectSchedulingIntent(params: DetectParams): Promise<DetectResult> {
  const { supabase, conversationId, offered, aiConfig } = params;

  const { data: messages } = await supabase
    .from('messaging_messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES);

  if (!messages || messages.length === 0) return { intent: 'none', slotIso: null };

  const convo = [...messages]
    .reverse()
    .map((m) => {
      const role = m.direction === 'inbound' ? 'LEAD' : 'ATENDENTE';
      const c = m.content as Record<string, unknown>;
      const text = typeof c === 'string' ? c : (c?.text as string) || '[mensagem]';
      return `[${role}]: ${text}`;
    })
    .join('\n');

  const offeredList = offered.map((s) => `- ${s.label} => ${s.startIso}`).join('\n');

  const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
  const result = await generateText({
    model,
    output: Output.object({ schema: DetectSchema, name: 'SchedulingIntent', description: 'Intenção de agendamento' }),
    system:
      'Você lê uma conversa de WhatsApp entre atendente e lead e detecta a intenção de agendamento da ÚLTIMA mensagem do lead. Só marque accept/reschedule/cancel se o lead foi claro. slotIso DEVE ser exatamente um dos horários oferecidos (copie o ISO). Se o lead foi vago ("qualquer um", "pode ser"), use none.',
    prompt: `Horários oferecidos:\n${offeredList}\n\nConversa:\n${convo}`,
    maxRetries: 2,
  });

  const out = result.output;
  if (!out) return { intent: 'none', slotIso: null };
  return { intent: out.intent, slotIso: out.slotIso };
}
