const TELEGRAM_API = 'https://api.telegram.org';

export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
}

export interface TelegramRecentMessage {
  chatId: number;
  firstName: string;
  username?: string;
}

export async function getTelegramBotInfo(botToken: string): Promise<TelegramBotInfo> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/getMe`);
  const body = await res.json() as { ok: boolean; result?: { id: number; username: string; first_name: string }; description?: string };
  if (!res.ok || !body.ok) {
    throw new Error(body.description ?? `Telegram API error ${res.status}`);
  }
  return {
    id: body.result!.id,
    username: body.result!.username,
    firstName: body.result!.first_name,
  };
}

export async function detectRecentTelegramMessage(
  botToken: string,
  sinceSeconds = 120,
): Promise<TelegramRecentMessage | null> {
  const res = await fetch(
    `${TELEGRAM_API}/bot${botToken}/getUpdates?limit=20&allowed_updates=%5B%22message%22%5D`,
  );
  const body = await res.json() as {
    ok: boolean;
    result?: Array<{
      message?: {
        date: number;
        chat: { id: number; type: string };
        from?: { first_name: string; username?: string };
      };
    }>;
  };
  if (!res.ok || !body.ok || !body.result) return null;

  const cutoff = Math.floor(Date.now() / 1000) - sinceSeconds;
  const recent = body.result
    .filter(u => u.message && u.message.date >= cutoff && ['private', 'group', 'supergroup'].includes(u.message.chat.type))
    .at(-1);

  if (!recent?.message) return null;
  return {
    chatId: recent.message.chat.id,
    firstName: recent.message.from?.first_name ?? 'Usuário',
    username: recent.message.from?.username,
  };
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
}

interface HandoffMessageParams {
  contactName: string;
  dealTitle: string;
  stageName: string;
  lastMessage: string;
  appUrl?: string;
  dealId?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatHandoffMessage({
  contactName,
  dealTitle,
  stageName,
  lastMessage,
  appUrl,
  dealId,
}: HandoffMessageParams): string {
  const truncated = lastMessage.slice(0, 300) + (lastMessage.length > 300 ? '...' : '');
  const lines = [
    `🔔 <b>Lead precisa de atenção humana</b>`,
    ``,
    `👤 <b>Contato:</b> ${escapeHtml(contactName)}`,
    `💼 <b>Deal:</b> ${escapeHtml(dealTitle)}`,
    `📍 <b>Estágio:</b> ${escapeHtml(stageName)}`,
    ``,
    `💬 <b>Última mensagem:</b>`,
    `<i>${escapeHtml(truncated)}</i>`,
  ];
  if (appUrl && dealId) {
    lines.push(``);
    lines.push(`🔗 <a href="${appUrl}/deals/${dealId}">Abrir no CRM</a>`);
  }
  return lines.join('\n');
}

interface EntregaConsultorParams {
  contactName: string;
  /** true quando o lead não responde por mensagem — o consultor precisa LIGAR. */
  precisaLigar: boolean;
  /** Linha pronta do que já se sabe (ex.: "prata · 3 vidas · paga R$1900/mês · São Paulo"). */
  qualificacao?: string;
  /** Há quantos dias o lead entrou no funil. */
  diasNoFunil?: number;
  /** Quantos toques de follow-up a Ana já mandou. */
  toques?: number;
  /** ISO do último toque enviado. */
  ultimoToque?: string;
  appUrl?: string;
  dealId?: string;
}

function diaMes(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  }).format(d);
}

/**
 * Lead ENTREGUE ao consultor sem reunião marcada — o card já está no funil dele, em Qualificação.
 *
 * REGRA (Thalita, 21/08): o lead só sai do funil da Ana quando ela não consegue resolver, e a
 * partir daí é responsabilidade do consultor — a Ana não volta a atender. Antes, o `notify_team`
 * só mandava um aviso e o card FICAVA no funil da Ana, que o consultor nem abre: a Mônica e o
 * Cleysson morreram assim. Agora o aviso acompanha um card que realmente mudou de mão.
 *
 * `precisaLigar` marca o caso em que a cadência inteira já rodou sem o lead responder: insistir por
 * mensagem não vai resolver, e ainda gasta disparo numa API não-oficial (risco de bloqueio).
 */
export function formatEntregaConsultorMessage({
  contactName,
  precisaLigar,
  qualificacao,
  diasNoFunil,
  toques,
  ultimoToque,
  appUrl,
  dealId,
}: EntregaConsultorParams): string {
  const lines: string[] = [
    precisaLigar
      ? `📞 <b>LIGAR — lead não responde por mensagem</b>`
      : `🤝 <b>Lead entregue — a Ana não conseguiu resolver</b>`,
    ``,
    `👤 <b>${escapeHtml(contactName)}</b>`,
  ];

  // Briefing: o que já se sabe, há quanto tempo e o que a Ana tentou. Cada linha só aparece se
  // houver dado — card magro não vira mensagem cheia de "desconhecido".
  if (qualificacao) lines.push(`📋 ${escapeHtml(qualificacao)}`);

  if (typeof diasNoFunil === 'number') {
    const tempo =
      diasNoFunil === 0 ? 'entrou hoje' : diasNoFunil === 1 ? 'no funil há 1 dia' : `no funil há ${diasNoFunil} dias`;
    lines.push(`⏱ ${tempo}`);
  }

  if (typeof toques === 'number' && toques > 0) {
    const quando = diaMes(ultimoToque);
    lines.push(
      `💬 ${toques} toque${toques > 1 ? 's' : ''} da Ana${quando ? `, último em ${quando}` : ''} — sem resposta`
    );
  }

  lines.push(``);
  lines.push(
    precisaLigar
      ? `A cadência inteira já rodou. Por mensagem não resolve — <b>ligue</b>.\nCard em <b>Qualificação</b> no seu funil.`
      : `Card em <b>Qualificação</b> no seu funil e agora é seu. A Ana não atende mais essa conversa.`
  );

  if (appUrl && dealId) {
    lines.push(``);
    lines.push(`🔗 <a href="${appUrl}/deals/${dealId}">Abrir no CRM</a>`);
  }
  return lines.join('\n');
}

interface HandoffEscalationParams {
  contactName: string;
  dealTitle: string;
  /** Horas úteis que o lead já esperou desde o handoff. */
  horasUteis: number;
  lastMessage: string;
  appUrl?: string;
  dealId?: string;
}

/**
 * SEGUNDO aviso: ninguém pegou o lead no prazo (2 horas úteis — decisão da Thalita, 20/08).
 *
 * Diferente do `formatHandoffMessage`, que é o toque inicial: aqui o ponto é que o prazo
 * ESTOUROU. Por isso diz há quanto tempo o lead espera e o que acontece se continuar parado —
 * é esse aviso que vai também pro Telegram da dona, pra virar visível quando o consultor não pegou.
 */
export function formatHandoffEscalationMessage({
  contactName,
  dealTitle,
  horasUteis,
  lastMessage,
  appUrl,
  dealId,
}: HandoffEscalationParams): string {
  const truncated = lastMessage.slice(0, 300) + (lastMessage.length > 300 ? '...' : '');
  const lines = [
    `⏰ <b>Lead esperando há ${horasUteis}h úteis — ninguém assumiu</b>`,
    ``,
    `👤 <b>Contato:</b> ${escapeHtml(contactName)}`,
    `💼 <b>Deal:</b> ${escapeHtml(dealTitle)}`,
    ``,
    `💬 <b>Última mensagem do lead:</b>`,
    `<i>${escapeHtml(truncated)}</i>`,
    ``,
    `Se continuar parado por 1 dia útil, a Ana retoma a conversa pra não perder o lead.`,
  ];
  if (appUrl && dealId) {
    lines.push(``);
    lines.push(`🔗 <a href="${appUrl}/deals/${dealId}">Abrir no CRM</a>`);
  }
  return lines.join('\n');
}

interface MeetingHandoffMessageParams {
  contactName: string;
  /** Label já formatado do horário (ex.: "Segunda, 20/07, às 15h"). */
  meetingLabel: string;
  appUrl?: string;
  dealId?: string;
}

/**
 * Aviso POSITIVO pro consultor quando a Ana agenda uma reunião e o deal é movido pro funil dele.
 * Diferente do `formatHandoffMessage` (genérico "precisa de atenção humana"): aqui é um lead já
 * qualificado E agendado entrando no funil — a mensagem celebra e diz o horário.
 */
export function formatMeetingHandoffMessage({
  contactName,
  meetingLabel,
  appUrl,
  dealId,
}: MeetingHandoffMessageParams): string {
  const lines = [
    `✅ <b>Novo lead agendado</b>`,
    ``,
    `👤 <b>${escapeHtml(contactName)}</b>`,
    `📅 <b>Reunião:</b> ${escapeHtml(meetingLabel)}`,
    `📥 Já está no seu funil (Comercial — Consultor).`,
  ];
  if (appUrl && dealId) {
    lines.push(``);
    lines.push(`🔗 <a href="${appUrl}/deals/${dealId}">Abrir no CRM</a>`);
  }
  return lines.join('\n');
}

interface RespostaBloqueadaParams {
  contactName: string;
  /** Rótulos do `output-validator` (ex.: `leakage:declared_ai_pt`, `length_exceeded:…`). */
  issues: string[];
  /** Última coisa que o lead escreveu — o que ficou sem resposta de verdade. */
  ultimaMensagemDoLead?: string;
  appUrl?: string;
  dealId?: string;
}

/**
 * A Ana gerou uma resposta e o validador de saída a BLOQUEOU (§1b do roadmap).
 *
 * Por que este aviso existe: até 26/08/2026 o bloqueio era invisível — só um `console.info`
 * que sumia da Vercel em poucos dias. O lead recebia uma despedida educada e o time nunca
 * ficava sabendo. Foram 6 disparos em 5 conversas de lead pago desde 28/07, 2 delas mortas ali.
 *
 * Agora o lead recebe uma PONTE ("já te respondo") e este alarme chama alguém para assumir.
 * O aviso NÃO move o card: bloqueio pode ser falso positivo do validador, e tirar o lead do
 * funil da Ana por causa disso seria pior que o problema.
 */
export function formatRespostaBloqueadaMessage({
  contactName,
  issues,
  ultimaMensagemDoLead,
  appUrl,
  dealId,
}: RespostaBloqueadaParams): string {
  const lines: string[] = [
    `🚧 <b>Resposta da Ana bloqueada — ela não respondeu o lead</b>`,
    ``,
    `👤 <b>${escapeHtml(contactName)}</b>`,
  ];

  if (issues.length > 0) {
    lines.push(`⚠️ <b>Motivo:</b> ${escapeHtml(issues.join(', '))}`);
  }

  if (ultimaMensagemDoLead) {
    const truncated =
      ultimaMensagemDoLead.slice(0, 300) + (ultimaMensagemDoLead.length > 300 ? '...' : '');
    lines.push(``);
    lines.push(`💬 <b>O lead disse:</b>`);
    lines.push(`<i>${escapeHtml(truncated)}</i>`);
  }

  lines.push(``);
  lines.push(
    `A Ana mandou só "já te respondo" para não encerrar a conversa. <b>Alguém precisa responder de verdade.</b>`
  );

  if (appUrl && dealId) {
    lines.push(``);
    lines.push(`🔗 <a href="${appUrl}/deals/${dealId}">Abrir no CRM</a>`);
  }
  return lines.join('\n');
}
