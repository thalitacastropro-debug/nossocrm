/**
 * Toque QUENTE por IA — irmão de lead-intake/first-touch.ts. Lê o histórico da conversa
 * + persona da Ana e escreve o próximo toque RETOMANDO de onde o lead parou. Best-effort:
 * qualquer falha/vazio => retorna null e o chamador usa o fallback fixo (copy.ts).
 */
import { generateText } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModel } from '@/lib/ai/config';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';

function warmTask(touchIndex: number): string {
  const foco =
    touchIndex === 0
      ? 'Toque 1 (logo após o silêncio): leve, reabre a porta e retoma a última pergunta pendente.'
      : 'Toque 2: reforce o VALOR ancorado no que o lead já disse (reajuste composto, carência ou reembolso).';
  return `## TAREFA: FOLLOW-UP (WhatsApp)
Um lead da Niva ENGAJOU na conversa e parou de responder. Escreva o próximo toque da Ana para reengajar.
Regras:
- NÃO re-cumprimente nem se re-apresente (já está no meio da conversa).
- Retome DE ONDE PAROU: use o que o lead já disse; refaça a última pergunta pendente.
- Objetivo é marcar 30 min com o consultor. Nunca "cotação".
- ${foco}
- NUNCA escreva placeholders entre colchetes (ex.: [cidade], [estado/cidade], [nome], [valor]). Só use dados CONCRETOS que aparecem na conversa; se não tiver o dado, pergunte de forma aberta ou não cite o dado.
- Sem diminutivos (nada de "listinha", "rapidinho", "cotaçãozinha") e não narre seu processo interno ("anoto na minha lista").
- Bolhas curtas: uma ideia por LINHA (1 a 3 linhas). Sem emojis, sem travessão, sem markdown, sem aspas.
- Devolva SÓ as bolhas, uma por linha.`;
}

export async function generateWarmFollowupBubbles(opts: {
  supabase: SupabaseClient;
  organizationId: string;
  boardId: string;
  conversationId: string;
  firstName: string | null;
  touchIndex: number;
}): Promise<string[] | null> {
  try {
    const aiConfig = await getOrgAIConfig(opts.supabase, opts.organizationId);
    if (!aiConfig) return null;

    let persona = '';
    try {
      const { data: cfg } = await opts.supabase
        .from('board_ai_config')
        .select('persona_prompt')
        .eq('board_id', opts.boardId)
        .maybeSingle();
      persona = (cfg?.persona_prompt as string | null) || '';
    } catch {
      /* segue sem persona */
    }

    const { data: msgs } = await opts.supabase
      .from('messaging_messages')
      .select('direction, content, created_at')
      .eq('conversation_id', opts.conversationId)
      .order('created_at', { ascending: false })
      .limit(12);

    const history = (msgs ?? [])
      .slice()
      .reverse()
      .map((m) => {
        const who = (m.direction as string) === 'inbound' ? 'Lead' : 'Ana';
        const text = ((m.content as { text?: string } | null)?.text ?? '').toString().trim();
        return text ? `${who}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');

    const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
    const result = await generateText({
      model,
      system: [persona, warmTask(opts.touchIndex)].filter(Boolean).join('\n\n'),
      prompt:
        `Primeiro nome do lead: ${opts.firstName || '(não informado)'}\n\n` +
        `Conversa até agora (mais antiga -> mais recente):\n${history || '(sem histórico legível)'}\n\n` +
        `Escreva o próximo toque agora, uma bolha por linha.`,
      maxRetries: 2,
    });

    const bubbles = result.text.split('\n').map((s) => s.trim()).filter(Boolean);
    // Guard anti-alucinação: se a IA vazou placeholder em colchetes, descarta o toque
    // (o chamador usa o fallback fixo) em vez de mandar "[estado/cidade]" pro lead.
    if (bubbles.some((b) => /[[\]]/.test(b))) return null;
    return bubbles.length >= 1 ? bubbles : null;
  } catch {
    return null;
  }
}
