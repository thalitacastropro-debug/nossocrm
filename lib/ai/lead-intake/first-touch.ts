/**
 * Primeiro toque INTELIGENTE do lead de anúncio (intake route).
 *
 * Antes: a route mandava um DEFAULT_GREETING fixo, ignorando o formulário — a Ana
 * perguntava "você já tem plano?" mesmo com o form respondendo. Agora a IA lê o
 * lead_form e gera um 1º toque que NÃO re-pergunta o que já sabe e faz a próxima
 * pergunta de qualificação que falta. Usa o MESMO provider/modelo/persona da Ana.
 *
 * ⚠️ A PERGUNTA QUEM ESCOLHE É O CÓDIGO, não o modelo (mudança de 31/08/2026).
 * Até aqui o prompt entregava a ESCADA de qualificação e pedia "pergunte o
 * primeiro item que o formulário não respondeu". O modelo leu
 * `"Você possuí plano de saúde": ""` (vazio — o Make ainda manda os campos do
 * formulário antigo em branco), concluiu que faltava, e abriu com o lead Pablo
 * assim:
 *
 *     "Você informou que paga mais de R$ 3.500 hoje"
 *     "Primeiro, você já tem algum plano de saúde no momento?"
 *
 * Duas bolhas seguidas se contradizendo, num lead pago. Quem paga R$3.500 num
 * plano já respondeu — o que falta é saber QUAL é o plano. Agora
 * {@link proximaPergunta} decide em código e o modelo só escreve na voz da Ana.
 *
 * TOTALMENTE best-effort: qualquer falha → retorna null e a route cai no
 * DEFAULT_GREETING (nunca deixa de dar o 1º toque).
 */
import { generateText } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModel } from '@/lib/ai/config';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import { stripDashTells } from '@/lib/ai/text/dashes';
import {
  temPlanoFromLeadForm,
  valorFromLeadForm,
  vidasFromLeadForm,
  idadesFromLeadForm,
  cnpjFromLeadForm,
} from '@/lib/ai/extraction/domain/niva-health';

/**
 * A escada de qualificação, na ordem da persona: plano atual (qual + quanto) ->
 * vidas -> CNPJ. Devolve a ÚNICA pergunta que o 1º toque deve fazer.
 *
 * Sobre o CNPJ: perguntar apenas SE TEM. Não sugerir abrir MEI no primeiro
 * contato — decisão da Thalita em 31/08/2026, depois de a Ana abrir com a Rose
 * *"você tem CNPJ ou seria pra abrir como MEI?"*. Abrir empresa é conversa do
 * consultor, não abertura de quem acabou de clicar num anúncio.
 */
export function proximaPergunta(custom: Record<string, unknown>): string {
  const temPlano = temPlanoFromLeadForm(custom);
  const valor = valorFromLeadForm(custom);
  const vidas = vidasFromLeadForm(custom) ?? (idadesFromLeadForm(custom).length || null);
  const temCnpj = cnpjFromLeadForm(custom);

  if (temPlano === null) return 'se ele já tem plano de saúde hoje';
  // O caso do Pablo: tem plano e o valor já veio do form. O que falta é QUAL.
  if (temPlano === 'sim') {
    if (valor == null) return 'quanto ele paga hoje no plano que já tem';
    return 'de qual operadora é o plano que ele tem hoje';
  }
  if (vidas == null) return 'quantas pessoas entrariam no plano';
  if (temCnpj == null) return 'se ele já tem CNPJ (só se tem ou não — NÃO fale em abrir MEI)';
  return 'em qual cidade fica a empresa dele';
}

const FIRST_TOUCH_TASK = `## TAREFA: PRIMEIRO TOQUE (WhatsApp)
Um lead acabou de vir de um anúncio e PREENCHEU UM FORMULÁRIO. Escreva a PRIMEIRA mensagem da Ana.
Regras específicas do 1º toque:
- Cumprimente pelo primeiro nome e apresente-se (Ana, da Niva). É o 1º contato.
- Mostre que você JÁ SABE o que o lead informou no formulário. NUNCA pergunte algo que o formulário já responde.
- Faça UMA única pergunta: EXATAMENTE a que vem em "PERGUNTE ISTO" abaixo. Não invente outra, não acrescente uma segunda.
- NUNCA contradiga o que você acabou de afirmar (se disse que ele paga um valor no plano, ele TEM plano).
- Bolhas curtas: UMA ideia por LINHA (2 a 4 linhas). A última linha é a pergunta.
- Sem emojis, sem numeração, sem markdown, sem aspas, SEM TRAVESSÃO. Devolva SÓ as bolhas, uma por linha.`;

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

    // Os leitores de formulário esperam o shape de `custom_fields` (procuram
    // `lead_form.raw ?? lead_form.fields`) — por isso remontamos aqui em vez de
    // passar `opts.leadForm` cru.
    const pergunta = proximaPergunta({ lead_form: opts.leadForm });

    const model = getModel(aiConfig.provider, aiConfig.apiKey, aiConfig.model);
    const result = await generateText({
      model,
      system: [persona, FIRST_TOUCH_TASK].filter(Boolean).join('\n\n'),
      prompt:
        `Primeiro nome do lead: ${opts.firstName || '(não informado)'}\n\n` +
        `O que o lead JÁ informou no formulário:\n` +
        `${JSON.stringify({ mapped: opts.leadForm.mapped, fields: opts.leadForm.fields }, null, 2)}\n\n` +
        `PERGUNTE ISTO (e só isto): ${pergunta}\n\n` +
        `Escreva o primeiro toque agora, uma bolha por linha.`,
      maxRetries: 2,
    });

    // stripDashTells também aqui: o opener não passava por ele (só as respostas
    // do agente passavam), e foi por essa fresta que saíram "paga mais de
    // R$ 3.500 hoje — vamos ver..." e "me conta — você tem CNPJ..." em 31/08.
    const bubbles = result.text
      .split('\n')
      .map((s) => stripDashTells(s.trim()))
      .filter(Boolean);
    return bubbles.length >= 1 ? bubbles : null;
  } catch {
    return null;
  }
}
