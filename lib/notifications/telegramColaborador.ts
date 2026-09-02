/**
 * @fileoverview Como cada pessoa do time vira um destino de mensagem no Telegram.
 *
 * O diário individual das 8h precisa de um `chat_id` por pessoa, e não há como
 * o CRM descobrir isso sozinho: **o bot não pode puxar conversa** — o Telegram
 * só permite que ele responda a quem falou com ele primeiro. Então o fluxo é
 * necessariamente: a pessoa fala com o bot, e o CRM identifica qual conversa é
 * dela.
 *
 * ## Por que um CÓDIGO, e não "detecta a última mensagem"
 *
 * Já existe `detectRecentTelegramMessage` (usada em Configurações para ligar o
 * Telegram da organização): ela pega a última mensagem recebida nos últimos 2
 * minutos. Para UMA pessoa configurando a org, serve. Para o time, não:
 *
 * Se o Pedro e o Denilson mandarem `/start` com segundos de diferença — que é
 * exatamente o que acontece quando o aviso cai no grupo — quem clicar primeiro
 * leva o chat do outro. E o relatório do gestor contém o que a EQUIPE tem em
 * aberto: o Pedro receberia a visão de cobrança sobre ele mesmo. Um erro
 * silencioso, que ninguém perceberia até ser tarde.
 *
 * Com código, a mensagem carrega a identidade: casamos a pessoa certa com o
 * chat certo, sem janela de tempo e sem corrida.
 *
 * @module lib/notifications/telegramColaborador
 */

/** Só o que interessa de um update do Telegram. */
export interface UpdateDoTelegram {
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { first_name?: string; username?: string };
  };
}

export interface ChatEncontrado {
  chatId: string;
  primeiroNome: string;
  username?: string;
}

/**
 * Alfabeto sem os caracteres que se confundem lidos em voz alta ou num print:
 * sem O/0, sem I/1, sem S/5. O código é ditado por WhatsApp na vida real.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';

/** Quanto tempo o código vale. Curto porque o passo inteiro leva 20 segundos. */
export const VALIDADE_DO_CODIGO_MIN = 15;

/**
 * Sorteia um código de vínculo.
 *
 * ⚠️ Precisa ser ALEATÓRIO, e a primeira versão errou isso: usava os 6
 * primeiros caracteres do `profiles.id`. Como a policy de leitura de `profiles`
 * libera a organização inteira, o código de qualquer colega era calculável — e
 * quem soubesse o código do gestor podia mandá-lo ao bot pelo Telegram próprio
 * e ficar com o vínculo dele, passando a receber o relatório que mostra o que a
 * equipe deve. Nenhum dos dois lados perceberia.
 *
 * `crypto.getRandomValues` (Web Crypto, presente no Node 18+ e no runtime da
 * Vercel) em vez de Math.random: o custo é o mesmo e tira a dúvida.
 */
export function gerarCodigo(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let saida = '';
  for (const b of bytes) saida += ALFABETO[b % ALFABETO.length];
  return `NIVA-${saida}`;
}

/** Tira acento de formatação, espaço e pontuação para comparar o que a pessoa digitou. */
function normalizar(texto: string): string {
  return texto.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

/**
 * Acha, entre os updates, o chat PRIVADO de quem mandou o código.
 *
 * Varre do fim para o começo: se a pessoa mandou o código duas vezes (o que
 * acontece quando ela acha que não funcionou), vale a conversa mais recente.
 *
 * Só chat `private`: se alguém colar o código num grupo onde o bot esteja, o
 * diário individual iria para o grupo inteiro — o oposto do combinado.
 */
export function acharChatPeloCodigo(
  updates: UpdateDoTelegram[],
  codigo: string,
): ChatEncontrado | null {
  const alvo = normalizar(codigo);
  if (!alvo) return null;

  for (let i = updates.length - 1; i >= 0; i--) {
    const msg = updates[i]?.message;
    const texto = msg?.text;
    const chatId = msg?.chat?.id;
    if (!texto || typeof chatId !== 'number') continue;
    if (msg?.chat?.type !== 'private') continue;
    if (!normalizar(texto).includes(alvo)) continue;

    return {
      chatId: String(chatId),
      primeiroNome: msg.from?.first_name ?? 'Sem nome',
      username: msg.from?.username,
    };
  }
  return null;
}

/**
 * Puxa os updates pendentes do bot.
 *
 * NÃO passamos `offset`, de propósito: confirmar os updates os APAGA da fila do
 * Telegram, e aí a segunda pessoa a clicar não acharia mais a própria mensagem.
 * Sem offset, o Telegram guarda tudo por 24h e cada pessoa acha a sua.
 *
 * ⚠️ Isto só funciona porque o bot NÃO tem webhook (confirmado em 02/09/2026:
 * `getWebhookInfo` volta sem url). Se um dia alguém registrar um webhook neste
 * bot, `getUpdates` passa a devolver erro 409 e este caminho morre — a saída
 * seria ler o `chat_id` do próprio webhook.
 */
export async function buscarUpdatesDoBot(botToken: string): Promise<UpdateDoTelegram[]> {
  const url =
    `https://api.telegram.org/bot${botToken}/getUpdates` +
    `?limit=100&allowed_updates=%5B%22message%22%5D`;

  const res = await fetch(url);
  const corpo = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: UpdateDoTelegram[];
    description?: string;
  } | null;

  if (!res.ok || !corpo?.ok) {
    throw new Error(corpo?.description ?? `Telegram respondeu ${res.status}`);
  }
  return corpo.result ?? [];
}
