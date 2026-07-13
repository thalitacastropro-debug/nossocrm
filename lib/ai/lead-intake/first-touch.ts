/**
 * Primeiro toque INTELIGENTE do lead de anúncio (intake route).
 *
 * Antes: a route mandava um DEFAULT_GREETING fixo, ignorando o formulário — a Ana
 * perguntava "você já tem plano?" mesmo com o form respondendo. Agora a IA lê o
 * lead_form e gera um 1º toque que NÃO re-pergunta o que já sabe e faz a próxima
 * pergunta de qualificação que falta. Usa o MESMO provider/modelo/persona da Ana.
 *
 * TOTALMENTE best-effort: qualquer falha → retorna null e a route cai no
 * DEFAULT_GREETING (nunca deixa de dar o 1º toque).
 */
import { generateText } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModel } from '@/lib/ai/config';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';

const FIRST_TOUCH_TASK = `## TAREFA: PRIMEIRO TOQUE (WhatsApp)
Um lead acabou de vir de um anúncio e PREENCHEU UM FORMULÁRIO. Escreva a PRIMEIRA mensagem da Ana.
Regras específicas do 1º toque:
- Cumprimente pelo primeiro nome e apresente-se (Ana, da Niva) — é o 1º contato.
- Mostre que você JÁ SABE o que o lead informou no formulário. NUNCA pergunte algo que o formulário já responde (ex.: se o form diz que ele já tem plano/operadora/valor, NÃO pergunte "você já tem plano?").
- Faça UMA única pergunta: a informação de qualificação mais importante que AINDA falta.
- Ordem de qualificação (pergunte o PRIMEIRO item que o formulário NÃO respondeu): tem plano hoje? -> operadora -> valor que paga hoje -> nº de vidas + idades -> CNPJ/cidade.
- Bolhas curtas: UMA ideia por LINHA (2 a 4 linhas). A última linha é a pergunta.
- Sem emojis, sem numeração, sem markdown, sem aspas. Devolva SÓ as bolhas, uma por linha.`;

export async function generateFirstTouchBubbles(opts: {
  supabase: SupabaseClient;
  organizationId: string;
  boardId: string;
  firstName: string | null;
  leadForm: { mapped?: unknown; fields?: unknown };
}): Promise<string[] | null> {
  try {
    const aiConfig = await getOrgAIConfig(opts.supabase, opts.organizationId);
    if (!aiConfig) return null;

    // Persona do board (voz da Ana) — best-effort, não bloqueia se faltar.
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

    const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
    const result = await generateText({
      model,
      system: [persona, FIRST_TOUCH_TASK].filter(Boolean).join('\n\n'),
      prompt:
        `Primeiro nome do lead: ${opts.firstName || '(não informado)'}\n\n` +
        `O que o lead JÁ informou no formulário:\n` +
        `${JSON.stringify({ mapped: opts.leadForm.mapped, fields: opts.leadForm.fields }, null, 2)}\n\n` +
        `Escreva o primeiro toque agora, uma bolha por linha.`,
      maxRetries: 2,
    });

    const bubbles = result.text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return bubbles.length >= 1 ? bubbles : null;
  } catch {
    return null;
  }
}
