/**
 * @fileoverview Provider failover for AI model generation.
 *
 * Tries the primary provider first, then falls back to secondary/tertiary
 * providers if configured. Only retries on provider-level errors (auth,
 * rate limit, server errors), NOT on content/validation errors.
 */

import { generateText, type LanguageModel } from 'ai';
import { getModel, type AIProvider } from '../config';

export interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
}

interface GenerateWithFailoverParams {
  providers: ProviderConfig[];
  system: string;
  prompt: string;
  maxRetries?: number;
  temperature?: number;
}

interface GenerateWithFailoverResult {
  text: string;
  usage?: { totalTokens?: number };
  modelUsed: string;
  providerUsed: AIProvider;
}

/**
 * Try generating text with failover across multiple providers.
 *
 * @throws If ALL providers fail
 */
export async function generateWithFailover(
  params: GenerateWithFailoverParams
): Promise<GenerateWithFailoverResult> {
  const { providers, system, prompt, maxRetries = 2, temperature } = params;

  if (providers.length === 0) {
    throw new Error('No AI providers configured');
  }

  const errors: Array<{ provider: AIProvider; error: string }> = [];

  for (const config of providers) {
    try {
      const model: LanguageModel = getModel(
        config.provider,
        config.apiKey,
        config.model
      );

      // Prompt caching (Anthropic/Claude): o `system` (persona + goal + business) é ESTÁVEL
      // entre leads — só muda o `prompt` (mensagem/contexto do lead). Marcamos a system-message
      // com cacheControl ephemeral pra reusar o prefixo a cada request e cortar custo (~90% no
      // trecho cacheado). Só no provider anthropic (o Google ignora o namespace, mas mantemos o
      // caminho antigo INTACTO nele = zero risco no fallback). Persona ~4k+ tokens (> mínimo de
      // 4096 do Haiku); se ficar abaixo, o cache é no-op silencioso (sem erro).
      const result =
        config.provider === 'anthropic'
          ? await generateText({
              model,
              messages: [
                {
                  role: 'system',
                  content: system,
                  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
                },
                { role: 'user', content: prompt },
              ],
              maxRetries,
              ...(temperature !== undefined ? { temperature } : {}),
            })
          : await generateText({
              model,
              system,
              prompt,
              maxRetries,
              ...(temperature !== undefined ? { temperature } : {}),
            });

      // Métricas de cache (best-effort) pra validar ao vivo nos logs da Vercel. cache_read>0 =
      // o prefixo bateu; se ficar sempre 0, a persona está abaixo do mínimo de 4096 tokens.
      if (config.provider === 'anthropic') {
        const meta = (result.providerMetadata?.anthropic ?? {}) as Record<string, unknown>;
        const read = meta.cacheReadInputTokens;
        const created = meta.cacheCreationInputTokens;
        if (typeof read === 'number' || typeof created === 'number') {
          console.log(`[AIAgent] prompt-cache anthropic: read=${read ?? 0} created=${created ?? 0}`);
        }
      }

      if (errors.length > 0) {
        console.warn(
          `[AIAgent] Failover: ${config.provider} succeeded after ${errors.length} failed provider(s):`,
          errors.map((e) => `${e.provider}: ${e.error}`)
        );
      }

      return {
        text: result.text,
        usage: result.usage
          ? { totalTokens: result.usage.totalTokens }
          : undefined,
        modelUsed: config.model,
        providerUsed: config.provider,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(
        `[AIAgent] Provider ${config.provider} failed:`,
        errorMessage
      );
      errors.push({ provider: config.provider, error: errorMessage });
    }
  }

  // All providers failed
  const summary = errors
    .map((e) => `${e.provider}: ${e.error}`)
    .join('; ');
  throw new Error(`All AI providers failed: ${summary}`);
}

/**
 * Build an ordered list of provider configs from org settings.
 * Primary provider first, then others that have API keys configured.
 */
export function buildProviderList(orgConfig: {
  provider: AIProvider;
  apiKey: string;
  model: string;
}): ProviderConfig[] {
  const { provider: primary, apiKey, model } = orgConfig;
  const providers: ProviderConfig[] = [];

  // Primary always first
  if (apiKey) {
    providers.push({ provider: primary, apiKey, model });
  }

  return providers;
}
