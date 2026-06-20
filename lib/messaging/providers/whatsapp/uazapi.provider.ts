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
  ProviderConfig,
  SendMessageParams,
  SendMessageResult,
  TextContent,
} from '../../types';

// UazAPI usa a mesma estrutura de credenciais do Evolution (serverUrl, instanceName, apiKey).
// Para a UazAPI, `apiKey` deve ser o INSTANCE TOKEN (usado no header `token`).
export type UazApiCredentials = EvolutionCredentials;
export type UazApiWebhookPayload = EvolutionWebhookPayload;

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
      return {
        success: false,
        error: {
          code: 'UNSUPPORTED_CONTENT',
          message: `UazAPI provider: envio de "${content.type}" ainda não implementado (apenas texto por enquanto).`,
        },
      };
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

      const externalMessageId =
        (json.id as string) ||
        (json.messageid as string) ||
        ((json.key as { id?: string } | undefined)?.id) ||
        undefined;

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
}

export default UazApiWhatsAppProvider;
