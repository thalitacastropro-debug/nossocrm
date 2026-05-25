/**
 * @fileoverview UazAPI WhatsApp Provider
 *
 * WhatsApp API provider using UazAPI (uazapi.dev).
 * UazAPI is fully compatible with Evolution API — this provider
 * extends EvolutionWhatsAppProvider with UazAPI-specific branding.
 *
 * Setup:
 * 1. Create account at uazapi.dev
 * 2. Copy your Server URL and Admin Token from the dashboard
 * 3. Create an instance and copy the instance name
 *
 * @see https://docs.uazapi.com/
 *
 * @module lib/messaging/providers/whatsapp/uazapi
 */

import { EvolutionWhatsAppProvider } from './evolution.provider';
import type { EvolutionCredentials, EvolutionWebhookPayload } from './evolution.provider';
import type { ChannelType } from '../../types';

// UazAPI uses the same credentials structure as Evolution API
export type UazApiCredentials = EvolutionCredentials;
export type UazApiWebhookPayload = EvolutionWebhookPayload;

/**
 * UazAPI WhatsApp provider.
 *
 * Extends Evolution API provider since UazAPI is fully API-compatible.
 *
 * @example
 * ```ts
 * const provider = new UazApiWhatsAppProvider();
 * await provider.initialize({
 *   channelId: 'uuid',
 *   credentials: {
 *     serverUrl: 'https://suainstancia.uazapi.com',
 *     instanceName: 'MinhaInstancia',
 *     apiKey: 'seu-admin-token',
 *   },
 * });
 * ```
 */
export class UazApiWhatsAppProvider extends EvolutionWhatsAppProvider {
  readonly channelType: ChannelType = 'whatsapp';
  readonly providerName = 'uazapi';
}

export default UazApiWhatsAppProvider;
