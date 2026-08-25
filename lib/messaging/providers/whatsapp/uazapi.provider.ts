/**
 * @fileoverview UazAPI WhatsApp Provider
 *
 * WhatsApp API provider using UazAPI (uazapi.com).
 *
 * IMPORTANTE: apesar de a UazAPI se anunciar "compatível com Evolution", a API
 * NATIVA que a instância da Niva usa (e que o fluxo n8n usa em produção) é:
 *   - Envio de texto:  POST {serverUrl}/send/text   header `token`  body { number, text }
 *   - Envio de mídia:  POST {serverUrl}/send/media  header `token`
 * (O Evolution usaria POST /message/sendText/{instance} com header `apikey` — INCOMPATÍVEL.)
 *
 * Por isso este provider faz override do envio em vez de só herdar o Evolution.
 *
 * @see https://docs.uazapi.com/
 * @module lib/messaging/providers/whatsapp/uazapi
 */

import { EvolutionWhatsAppProvider } from './evolution.provider';
import type { EvolutionCredentials, EvolutionWebhookPayload } from './evolution.provider';
import type {
  ChannelType,
  MessageContent,
  ProviderConfig,
  SendMessageParams,
  SendMessageResult,
  TextContent,
} from '../../types';

/**
 * Campos de mídia que o envio usa. Os dois últimos são nossos, não do provider:
 * escolhem o formato "gravado" do WhatsApp (bolinha de vídeo / áudio de voz).
 */
type MediaContent = {
  mediaUrl?: string;
  caption?: string;
  fileName?: string;
  /** Manda o vídeo como PTV — a bolinha redonda. */
  enviarComoBolinha?: boolean;
  /** Manda o áudio como PTT — a onda de voz, não um arquivo de música. */
  enviarComoVoz?: boolean;
};

// UazAPI usa a mesma estrutura de credenciais do Evolution (serverUrl, instanceName, apiKey).
// Para a UazAPI, `apiKey` deve ser o INSTANCE TOKEN (usado no header `token`).
export type UazApiCredentials = EvolutionCredentials;
export type UazApiWebhookPayload = EvolutionWebhookPayload;

/**
 * Normaliza o id de mensagem da UazAPI para a forma PURA (sem o prefixo do
 * remetente). O /send/text devolve "5511988209448:3EB0..." mas o webhook (eco
 * fromMe e status updates) usa "3EB0...". Guardar sempre a forma pura faz o
 * índice único de external_id deduplicar o eco e os status casarem com o envio.
 */
/**
 * Traduz o tipo de conteúdo do CRM para o `type` do `/send/media` da UAZAPI.
 *
 * `ptv` é o **vídeo bolinha** (Push-to-Video) e `ptt` é o áudio de gravação —
 * os dois só saem quando o conteúdo pede explicitamente (`enviarComoBolinha` /
 * `enviarComoVoz`), porque o padrão de um vídeo/áudio anexado é o formato comum.
 *
 * Devolve `null` para o que não é mídia enviável (texto, localização, contato...).
 */
export function tipoUazapiDaMidia(content: MessageContent): string | null {
  const m = content as MediaContent;

  switch (content.type) {
    case 'image':
      return 'image';
    case 'video':
      return m.enviarComoBolinha ? 'ptv' : 'video';
    case 'audio':
      return m.enviarComoVoz ? 'ptt' : 'audio';
    case 'document':
      return 'document';
    case 'sticker':
      return 'sticker';
    default:
      return null;
  }
}

export function normalizeUazApiMessageId(id: string | undefined): string | undefined {
  if (!id) return id;
  // Prefixo do remetente = só dígitos antes do primeiro ":". Preserva ids que
  // não seguem esse formato (não corta ":" que faça parte do próprio id).
  const m = id.match(/^\d+:(.+)$/);
  return m ? m[1] : id;
}

/**
 * UazAPI WhatsApp provider.
 *
 * Herda do Evolution para conexão/QR/webhook, mas faz OVERRIDE do envio
 * para usar a API nativa da UazAPI (/send/text + header `token`).
 */
export class UazApiWhatsAppProvider extends EvolutionWhatsAppProvider {
  readonly channelType: ChannelType = 'whatsapp';
  readonly providerName = 'uazapi';

  // Guarda cópia própria (os campos do Evolution são private e não acessíveis aqui).
  private uazServerUrl = '';
  private uazToken = '';

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    const credentials = config.credentials as unknown as UazApiCredentials;
    this.uazServerUrl = credentials.serverUrl.replace(/\/$/, '');
    this.uazToken = credentials.apiKey; // instance token da UazAPI (header `token`)
  }

  /**
   * Override do envio para a API nativa da UazAPI.
   * v1: texto (caminho crítico do agente). Mídia/outros tipos: a implementar
   * quando o contrato de /send/media for validado (ver fluxo n8n).
   */
  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const { content } = params;
    const number = params.to.replace(/\D/g, ''); // só dígitos

    if (content.type !== 'text') {
      return this.enviarMidia(number, content);
    }

    try {
      const res = await fetch(`${this.uazServerUrl}/send/text`, {
        method: 'POST',
        headers: {
          token: this.uazToken,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ number, text: (content as TextContent).text }),
      });

      const raw = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        // resposta não-JSON
      }

      if (!res.ok) {
        return {
          success: false,
          error: { code: 'SEND_FAILED', message: `UazAPI ${res.status}: ${raw.slice(0, 200)}` },
        };
      }

      const rawMessageId =
        (json.id as string) ||
        (json.messageid as string) ||
        ((json.key as { id?: string } | undefined)?.id) ||
        undefined;

      // A UazAPI devolve o id do /send/text prefixado com o número do remetente
      // (ex.: "5511988209448:3EB0...") enquanto o eco do MESMO envio chega no
      // webhook (fromMe) com o id PURO ("3EB0..."). Se guardarmos o id prefixado,
      // o índice único de external_id não reconhece o eco como duplicata → o
      // webhook insere uma 2ª linha (a mensagem aparece DOBRADA na conversa) e
      // ainda cai no ramo de "reply manual", pausando a IA sem motivo. Normalizamos
      // pro id puro (o que o webhook usa) pra o dedup e os status updates casarem.
      const externalMessageId = normalizeUazApiMessageId(rawMessageId);

      return { success: true, externalMessageId, status: 'sent' };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'REQUEST_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Envia mídia por `POST /send/media`.
   *
   * Contrato lido na doc oficial em 25/08/2026
   * (docs.uazapi.com/endpoint/post/send~media):
   *   `{ number, type, file, text?, docName?, viewOnce? }`
   * `file` aceita **URL** ou base64 — mandamos a URL assinada do nosso Storage,
   * que a UAZAPI baixa. Tipos aceitos: `image`, `video`, `videoplay`, `ptv`
   * (vídeo bolinha), `document`, `audio`, `myaudio`, `ptt` (áudio de voz),
   * `sticker`.
   *
   * Até aqui o provider recusava tudo que não fosse texto — era por isso que o
   * consultor não conseguia mandar arquivo nem áudio pelo chat.
   */
  private async enviarMidia(
    number: string,
    content: MessageContent,
  ): Promise<SendMessageResult> {
    const midia = content as MediaContent;
    const url = midia.mediaUrl;

    if (!url) {
      return {
        success: false,
        error: { code: 'MISSING_MEDIA_URL', message: 'Mídia sem URL para enviar.' },
      };
    }

    const tipo = tipoUazapiDaMidia(content);
    if (!tipo) {
      return {
        success: false,
        error: {
          code: 'UNSUPPORTED_CONTENT',
          message: `UazAPI provider: tipo "${content.type}" não é mídia enviável.`,
        },
      };
    }

    try {
      const body: Record<string, unknown> = { number, type: tipo, file: url };

      // `text` é a legenda no /send/media.
      const legenda = midia.caption?.trim();
      if (legenda) body.text = legenda;

      // Nome que o destinatário vê no documento — sem isso vira o hash do arquivo.
      if (tipo === 'document' && midia.fileName) body.docName = midia.fileName;

      const res = await fetch(`${this.uazServerUrl}/send/media`, {
        method: 'POST',
        headers: {
          token: this.uazToken,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const raw = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        // resposta não-JSON
      }

      if (!res.ok) {
        return {
          success: false,
          error: { code: 'SEND_FAILED', message: `UazAPI ${res.status}: ${raw.slice(0, 200)}` },
        };
      }

      const rawMessageId =
        (json.id as string) ||
        (json.messageid as string) ||
        ((json.key as { id?: string } | undefined)?.id) ||
        undefined;

      // Mesmo motivo do /send/text: o id vem prefixado com o número do remetente e
      // o eco do webhook usa o id puro. Sem normalizar, a mídia aparece dobrada.
      return {
        success: true,
        externalMessageId: normalizeUazApiMessageId(rawMessageId),
        status: 'sent',
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'REQUEST_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

export default UazApiWhatsAppProvider;
