/**
 * Toque QUENTE por IA — irmão de lead-intake/first-touch.ts. Lê o histórico da conversa
 * + persona da Ana e escreve o próximo toque RETOMANDO de onde o lead parou. Best-effort:
 * qualquer falha/vazio => retorna null e o chamador usa o fallback fixo (copy.ts).
 */
import { generateText } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModel } from '@/lib/ai/config';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import { validateAIOutput } from '@/lib/ai/agent/output-validator';

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

    // O MESMO VALIDADOR DA RESPOSTA, AGORA TAMBÉM AQUI (05-07/10/2026).
    //
    // `ae7eb47` (28/09, 15:42) criou `validateAIOutput` para impedir que a Ana pensasse em voz
    // alta na bolha do lead — mas plugou só no `agent.service`, o caminho de RESPONDER. O
    // follow-up gera texto por conta própria e mandava direto, então a trava nunca o cobriu.
    //
    // O custo disso, medido em produção: a lead Regina Balbino (4 vidas, Hapvida, CNPJ em SP,
    // paga R$ 3.400 — lead ouro) RECEBEU E LEU, em 29/09 às 8h, cinco bolhas de raciocínio
    // interno, entre elas "Qual é a situação exata?", "- Regina viu a mensagem mas não
    // respondeu?" e "Você quer que eu escreva como se ESSA mensagem acima ainda não tivesse
    // sido mandada?". A Ana tratou a cliente como se fosse o operador. Ela nunca mais
    // respondeu. E não foi caso único: Adelino Miguel levou outra em 06/10, 15:30.
    //
    // Falha macia, igual à do agent.service: toque suspeito é DESCARTADO (retorna null) e o
    // chamador cai no fallback fixo de `copy.ts`. Entre mandar uma bolha estranha e mandar a
    // frase padrão, a frase padrão ganha sempre — o lead não vê a diferença, e nós não
    // queimamos a conversa.
    // Contexto vazio de propósito: aqui interessam os checks que NÃO dependem dele — narração
    // interna, vazamento de prompt/identidade de IA e tamanho. O check de PII compara a saída
    // com e-mail/telefone do contato, dado que este caminho não carrega; com o contexto vazio
    // ele simplesmente não acusa nada, em vez de acusar errado.
    const semContexto = { contact: null, deal: null, stage: null, messages: [] } as unknown as Parameters<typeof validateAIOutput>[1];
    const veredito = validateAIOutput(bubbles.join('\n'), semContexto, {
      org_id: opts.organizationId,
      conversation_id: opts.conversationId,
    });
    if (!veredito.safe) return null;

    return bubbles.length >= 1 ? bubbles : null;
  } catch {
    return null;
  }
}
