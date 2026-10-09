/**
 * O ENVIO do 1º toque (a apresentação da Ana ao lead que acabou de chegar) — compartilhado entre
 * a entrada do lead (`/api/public/v1/leads`) e a NOVA TENTATIVA do cron de follow-up.
 *
 * Por que saiu da rota (09/10/2026): o 1º toque que FALHAVA nunca era recuperado. A rota só
 * tentava uma vez, gravava `first_touch.status = 'failed'` e, numa reentrada do mesmo lead, olhava
 * se a CHAVE `first_touch` existia (e se a conversa tinha QUALQUER mensagem — a tentativa falhada
 * conta) para concluir "já tocado". Com o WhatsApp fora de 06 a 08/10, giani e Flávia Muniz
 * entraram e nunca receberam nada; tiveram de ir na mão para o Pedro. Pior: a cadência de
 * follow-up começou a tentar mandar "ainda por aí?" para quem nunca recebeu a apresentação.
 *
 * Agora o mesmo código envia nas duas portas, e quem decide "já houve contato" é o que de fato
 * aconteceu na conversa (`jaHouveContato`), não a existência de uma chave.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { getChannelRouter } from '@/lib/messaging/channel-router.service';
import { generateFirstTouchBubbles } from '@/lib/ai/lead-intake/first-touch';
import { stripDashTells } from '@/lib/ai/text/dashes';

// Saudação inicial (aprovada pela Niva) — enviada em BOLHAS curtas, estilo WhatsApp
// (uma ideia por bolha; a última bolha é sempre a pergunta), NUNCA um bloco único.
// A Ana engaja 24/7 (é IA): o MESMO opener imediato a qualquer hora e qualquer dia —
// quem respeita horário comercial é só o AGENDAMENTO (o motor de agenda só oferece slot
// real do consultor, seg–sex). O chamador pode sobrescrever via `greeting` (string, UMA
// bolha por linha). Cada bolha suporta {nome} (primeiro nome). Regras de voz: SEM emojis;
// sem diminutivo; conduz (não pede permissão); reforça o consultor.
export const DEFAULT_GREETING: string[] = [
  'Oi {nome}, tudo bem? Aqui é a Ana, da Niva.',
  'Vi que você tem interesse em otimizar seu plano de saúde pra você e sua família.',
  // Sem travessão: é a marca registrada de texto de IA, e humano não usa no
  // WhatsApp. O `stripDashTells` limpa o que o modelo escorrega, mas texto
  // FIXO nosso não pode precisar de faxina.
  'Quem vai cuidar disso com você é um dos nossos consultores, eu já vou adiantando por aqui pra ele chegar preparado.',
  'Me conta: você já tem plano hoje ou seria o primeiro?',
];

/**
 * Quantas vezes o cron tenta de novo um 1º toque que falhou. A cada 15 min dentro da janela da
 * Ana: 8 tentativas ≈ 2 horas de canal caído. Mais que isso já é caso de gente ligar — e quem
 * recebe o aviso é o time.
 */
export const MAX_TENTATIVAS_PRIMEIRO_TOQUE = 8;

/** Interpola {nome} (primeiro nome), limpando pontuação órfã quando não há nome. */
export function renderGreeting(template: string, vars: { nome: string | null }): string {
  const firstName = (vars.nome ?? '').trim().split(/\s+/)[0] ?? '';
  return template
    .replaceAll('{nome}', firstName)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,!?.])/g, '$1')
    .trim();
}

/** Sleep simples (stagger entre bolhas). */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Pausa antes da próxima bolha, proporcional ao tamanho dela (ritmo de digitação). */
export function bubbleGapMs(nextBubble: string): number {
  return Math.min(Math.max(nextBubble.length * 35, 900), 2500);
}

/**
 * Resolve a saudação em BOLHAS. Default = array aprovado; override do body (Make) =
 * string com UMA bolha por linha. Vazio/whitespace → cai no fallback.
 */
export function resolveGreetingBubbles(override: string | undefined, fallback: string[]): string[] {
  if (override && override.trim()) {
    const parts = override.split('\n').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts;
  }
  return fallback;
}

/**
 * As bolhas do 1º toque. Prioridade: override do body (`greeting`) > opener da IA (lê o
 * lead_form e NÃO re-pergunta o que já sabe) > DEFAULT_GREETING fixo. Sempre sem travessão.
 */
export async function montarBolhasDoPrimeiroToque(opts: {
  supabase: SupabaseClient;
  organizationId: string;
  boardId: string;
  firstName: string | null;
  leadForm: Record<string, unknown>;
  greeting?: string;
}): Promise<string[]> {
  let bubbles: string[];
  if (opts.greeting && opts.greeting.trim()) {
    bubbles = resolveGreetingBubbles(opts.greeting, DEFAULT_GREETING)
      .map((t) => renderGreeting(t, { nome: opts.firstName }))
      .filter(Boolean);
  } else {
    const aiBubbles = await generateFirstTouchBubbles({
      supabase: opts.supabase,
      organizationId: opts.organizationId,
      boardId: opts.boardId,
      firstName: opts.firstName,
      leadForm: opts.leadForm,
    });
    bubbles = (aiBubbles && aiBubbles.length)
      ? aiBubbles
      : DEFAULT_GREETING.map((t) => renderGreeting(t, { nome: opts.firstName })).filter(Boolean);
  }
  // Rede final contra o travessão, nos TRÊS caminhos (override do body, IA e fallback fixo).
  // Foi por essa fresta que saiu "paga mais de R$ 3.500 hoje — vamos ver..." para o Pablo (31/08).
  return bubbles.map(stripDashTells).filter(Boolean);
}

/**
 * Houve contato DE VERDADE nesta conversa? O lead escreveu, ou alguma mensagem nossa SAIU
 * (sent/delivered/read). Tentativa falhada não conta — é exatamente o caso que não pode ser lido
 * como "já tocado". `pending` também não: é envio em voo ou que morreu no meio.
 */
export async function jaHouveContato(supabase: SupabaseClient, conversationId: string): Promise<boolean> {
  const { count: entradas } = await supabase
    .from('messaging_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound');
  if ((entradas ?? 0) > 0) return true;
  const { count: saidas } = await supabase
    .from('messaging_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .in('status', ['sent', 'delivered', 'read']);
  return (saidas ?? 0) > 0;
}

/**
 * Erro que não melhora tentando de novo. O caso real: Igor Moraes (08/2026), "the number ... is
 * not on WhatsApp" — acumulou 291 envios falhados. Para esse, a resposta é uma pessoa ligar.
 */
export function erroPermanente(mensagem: string | null | undefined): boolean {
  if (!mensagem) return false;
  return /not on whatsapp|não (está|tem) (no )?whatsapp|invalid (phone|number|jid)|número inválido/i.test(mensagem);
}

/** Mescla o resultado do 1º toque em custom_fields.lead_form.first_touch (sem sobrescrever o resto). */
export async function mergeDealFirstTouch(
  sb: SupabaseClient,
  dealId: string,
  firstTouch: Record<string, unknown>,
): Promise<void> {
  const { data } = await sb.from('deals').select('custom_fields').eq('id', dealId).maybeSingle();
  const custom = (data?.custom_fields as Record<string, unknown>) || {};
  const leadForm = (custom.lead_form as Record<string, unknown>) || {};
  await sb
    .from('deals')
    .update({
      custom_fields: { ...custom, lead_form: { ...leadForm, first_touch: firstTouch } },
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: { code: string; message: string };
}

/**
 * Envia a saudação em BOLHAS (várias mensagens curtas, estilo WhatsApp), com uma pausa
 * entre elas proporcional ao tamanho da próxima (ritmo de digitação). Para no 1º erro
 * pra não deixar a conversa pela metade. O `success` reflete a 1ª bolha (saudação crítica);
 * o `messageId` retornado é o da 1ª bolha (referência do 1º toque).
 */
export async function sendGreetingBubbles(params: {
  conversationId: string;
  channelId: string;
  to: string;
  bubbles: string[];
}): Promise<SendResult & { sentCount: number }> {
  const { conversationId, channelId, to, bubbles } = params;
  let firstMessageId: string | undefined = undefined;
  let firstError: SendResult['error'] = undefined;
  let firstOk = false;
  let sentCount = 0;

  for (let i = 0; i < bubbles.length; i++) {
    const res = await sendOneMessage({ conversationId, channelId, to, text: bubbles[i], index: i });
    if (i === 0) {
      firstOk = res.success;
      firstMessageId = res.messageId;
      firstError = res.error;
    }
    if (!res.success) break; // não envia as bolhas seguintes pra não deixar a conversa pela metade
    sentCount++;
    if (i < bubbles.length - 1) await sleep(bubbleGapMs(bubbles[i + 1]));
  }

  return { success: firstOk, messageId: firstMessageId, error: firstError, sentCount };
}

/**
 * Insere UMA mensagem outbound e a envia pelo ChannelRouter — mesmo fluxo de
 * `sendAIResponse` (lib/ai/agent/agent.service.ts). sender_type 'ai' + sent_by_ai:true
 * faz a Ana enxergar a própria saudação (não re-cumprimenta) no histórico.
 * `index` = posição da bolha (0 = 1ª, marca o first_touch).
 */
async function sendOneMessage(params: {
  conversationId: string;
  channelId: string;
  to: string;
  text: string;
  index: number;
}): Promise<SendResult> {
  const { conversationId, channelId, to, text, index } = params;
  const sb = createStaticAdminClient();

  const { data: message, error: insertError } = await sb
    .from('messaging_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      content_type: 'text',
      content: { type: 'text', text },
      status: 'pending',
      sender_type: 'ai',
      metadata: { sent_by_ai: true, source: 'lead_intake', first_touch: index === 0, bubble_index: index },
    })
    .select('id')
    .single();
  if (insertError) {
    return { success: false, error: { code: 'INSERT_FAILED', message: insertError.message } };
  }

  try {
    const router = getChannelRouter();
    const result = await router.sendMessage(channelId, {
      conversationId,
      to,
      content: { type: 'text', text },
    });

    if (result.success) {
      await sb
        .from('messaging_messages')
        .update({ external_id: result.externalMessageId, status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', message.id);
      return { success: true, messageId: message.id };
    }

    await sb
      .from('messaging_messages')
      .update({
        status: 'failed',
        error_code: result.error?.code || 'SEND_FAILED',
        error_message: result.error?.message || 'Unknown error',
        failed_at: new Date().toISOString(),
      })
      .eq('id', message.id);
    return {
      success: false,
      messageId: message.id,
      error: { code: result.error?.code || 'SEND_FAILED', message: result.error?.message || 'Falha ao enviar' },
    };
  } catch (error) {
    await sb
      .from('messaging_messages')
      .update({
        status: 'failed',
        error_code: 'PROVIDER_ERROR',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        failed_at: new Date().toISOString(),
      })
      .eq('id', message.id);
    return {
      success: false,
      messageId: message.id,
      error: { code: 'PROVIDER_ERROR', message: error instanceof Error ? error.message : 'Erro ao enviar' },
    };
  }
}
