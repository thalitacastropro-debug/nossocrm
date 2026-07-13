/**
 * Extração estruturada do desfecho da call a partir da transcrição.
 * Structured output SEMPRE no Gemini (getModel('google', …)).
 */
import { generateText, Output } from 'ai';
import { getModel } from '@/lib/ai/config';
import type { OrgAIConfig } from '@/lib/ai/agent/agent.service';
import { DesfechoSchema, type Desfecho } from './schemas';

const SYSTEM_PROMPT = `Você estrutura o desfecho de uma ligação de vendas de plano de saúde a partir da transcrição da nota de voz do consultor.
Regras:
- Extraia TODAS as tarefas/próximos passos ditos (cada uma com data ISO se houver).
- Só marque desfecho=perdeu se ficou claro que não vai fechar; use motivo_perda da taxonomia.
- Para reabordar_em, priorize o sinal real da conversa (vencimento de contrato/apólice, "me chama em X").
- Não invente valores. Campo sem informação = null.`;

export async function extractCallOutcome(opts: {
  aiConfig: OrgAIConfig;
  transcricao: string;
}): Promise<{ desfecho: Desfecho; tokens: number }> {
  const model = getModel(
    'google',
    opts.aiConfig.structuredApiKey || opts.aiConfig.apiKey,
    opts.aiConfig.structuredModel || opts.aiConfig.model,
  );

  const result = await generateText({
    model,
    output: Output.object({
      schema: DesfechoSchema,
      name: 'DesfechoCall',
      description: 'Desfecho estruturado da ligação do consultor',
    }),
    system: SYSTEM_PROMPT,
    prompt: `Transcrição da nota de voz do consultor:\n\n${opts.transcricao}`,
    maxRetries: 2,
  });

  return { desfecho: result.output as Desfecho, tokens: result.usage?.totalTokens ?? 0 };
}
