/**
 * @fileoverview Configuração de provedores de IA para o CRM.
 * 
 * Este módulo abstrai a criação de clientes de diferentes provedores de IA
 * (Google Gemini, OpenAI, Anthropic Claude), permitindo trocar entre eles
 * de forma transparente.
 * 
 * @module services/ai/config
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AI_DEFAULT_MODELS, AI_DEFAULT_PROVIDER } from './defaults';

export type AIProvider = 'google' | 'anthropic';

const ALLOWED_GOOGLE_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
  'gemini-2.5-pro-preview-03-25',
  'gemini-2.5-flash-preview-04-17',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.5-pro-preview-05-06',
]);

// Modelos Claude permitidos (Anthropic). Se ai_model não estiver aqui, cai no
// default AI_DEFAULT_MODELS.anthropic. IDs exatos conforme console.anthropic.com.
const ALLOWED_ANTHROPIC_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-5',
  'claude-opus-4-8',
]);

/**
 * Cria e retorna uma instância do modelo de IA configurada.
 * 
 * Suporta múltiplos provedores com modelos padrão:
 * - Google: gemini-3-flash-preview
 * - OpenAI: gpt-4o
 * - Anthropic: claude-3-5-sonnet-20240620
 * 
 * @param provider - Provedor de IA a ser utilizado.
 * @param apiKey - Chave de API do provedor.
 * @param modelId - ID do modelo específico (opcional, usa padrão se não informado).
 * @returns Instância configurada do modelo de IA.
 * @throws Error se a API key não for fornecida ou provedor não for suportado.
 * 
 * @example
 * ```typescript
 * // Usando Google Gemini
 * const model = getModel('google', 'sua-api-key', 'gemini-3-pro-preview');
 * 
 * // Usando OpenAI com modelo padrão
 * const model = getModel('openai', 'sua-api-key', '');
 * ```
 */
export const getModel = (provider: AIProvider, apiKey: string, modelId: string) => {
    if (!apiKey) {
        throw new Error('API Key is missing');
    }

    if (provider === 'anthropic') {
        const resolvedModel = modelId && ALLOWED_ANTHROPIC_MODELS.has(modelId)
            ? modelId
            : AI_DEFAULT_MODELS.anthropic;

        // baseURL explícito blinda contra uma env ANTHROPIC_BASE_URL herdada do
        // ambiente sem "/v1" (sobrescreveria o default do SDK e causaria 404).
        const anthropic = createAnthropic({ apiKey, baseURL: 'https://api.anthropic.com/v1' });
        return anthropic(resolvedModel);
    }

    // default: Google Gemini
    const resolvedModel = modelId && ALLOWED_GOOGLE_MODELS.has(modelId)
        ? modelId
        : AI_DEFAULT_MODELS.google;

    const google = createGoogleGenerativeAI({ apiKey });
    return google(resolvedModel);
};

/**
 * Configuração de modelo para uso com env vars.
 */
export interface ModelConfig {
    provider?: AIProvider;
    model?: string;
}

/**
 * Retorna um modelo de IA usando variáveis de ambiente.
 *
 * Usa as seguintes env vars:
 * - GOOGLE_GENERATIVE_AI_API_KEY
 * - OPENAI_API_KEY
 * - ANTHROPIC_API_KEY
 *
 * @param config - Configuração opcional (provider e model)
 * @returns Instância configurada do modelo de IA
 *
 * @example
 * ```typescript
 * // Usa provider padrão (google) com model padrão
 * const model = getModelFromEnv();
 *
 * // Especifica provider e model
 * const model = getModelFromEnv({ provider: 'openai', model: 'gpt-4o-mini' });
 * ```
 */
export const getModelFromEnv = (config?: ModelConfig) => {
    const model = config?.model || '';
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!apiKey) {
        throw new Error('API Key for google not found in environment (GOOGLE_GENERATIVE_AI_API_KEY)');
    }

    return getModel(AI_DEFAULT_PROVIDER, apiKey, model);
};
