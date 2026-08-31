/**
 * Extração estruturada do desfecho da call a partir da transcrição.
 * Structured output SEMPRE no Gemini (getModel('google', …)).
 */
import { generateText, Output } from 'ai';
import { getModel } from '@/lib/ai/config';
import type { OrgAIConfig } from '@/lib/ai/agent/agent.service';
import { DesfechoSchema, type Desfecho } from './schemas';
import { hojeParaPrompt, normalizarDataTarefa } from './datas';

/**
 * O prompt recebe HOJE injetado. Sem essa âncora o modelo completa o ano com o
 * que lhe parece natural: em 31/08/2026 o Denilson disse "retorno dia 02/09 às
 * 10h" e a tarefa nasceu em **2023**-09-02, atrasada, no fim da timeline.
 * Também mandamos escrever a data SEM fuso — fuso é a parte que o modelo mais
 * erra (ele escreveu `10:00Z`, que em Brasília é 07:00), e quem resolve isso é
 * `normalizarDataTarefa`, que lê tudo como horário de Brasília.
 */
function montarSystemPrompt(agora: Date): string {
  return `Você estrutura o desfecho de uma ligação de vendas de plano de saúde a partir da transcrição da nota de voz do consultor.

HOJE é ${hojeParaPrompt(agora)} (horário de Brasília). Toda data relativa ("semana que vem", "terça", "daqui a 10 dias") é calculada a partir de hoje.

Regras:
- Extraia TODAS as tarefas/próximos passos ditos (cada uma com data se houver).
- FORMATO DA DATA: AAAA-MM-DDTHH:mm, SEM fuso horário e SEM "Z". O horário é sempre o de Brasília, como o consultor falou. Ex.: "dia 2 de setembro às 10h" => "${agora.getUTCFullYear()}-09-02T10:00".
- Data no PASSADO nunca é a resposta certa para um próximo passo. Na dúvida sobre o ano, use o ano que deixa a data no futuro.
- Só marque desfecho=perdeu se ficou claro que não vai fechar; use motivo_perda da taxonomia.
- Para reabordar_em, priorize o sinal real da conversa (vencimento de contrato/apólice, "me chama em X").
- Não invente valores. Campo sem informação = null.`;
}

export async function extractCallOutcome(opts: {
  aiConfig: OrgAIConfig;
  transcricao: string;
  /** "Agora" injetável — o teste não pode depender do relógio da máquina. */
  agora?: Date;
}): Promise<{ desfecho: Desfecho; tokens: number }> {
  const agora = opts.agora ?? new Date();
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
    system: montarSystemPrompt(agora),
    prompt: `Transcrição da nota de voz do consultor:\n\n${opts.transcricao}`,
    maxRetries: 2,
  });

  const bruto = result.output as Desfecho;

  // Cinto e suspensório: mesmo instruído, o modelo escorrega em data. Aqui a
  // data passa a ser um fato verificado, não uma promessa do prompt — é o que
  // impede a tarefa de nascer atrasada e sumir no fim da timeline do card.
  const desfecho: Desfecho = {
    ...bruto,
    tarefas: (bruto.tarefas ?? []).map((t) => ({
      ...t,
      data: normalizarDataTarefa(t.data, agora),
    })),
    reabordar_em: normalizarDataTarefa(bruto.reabordar_em, agora),
  };

  return { desfecho, tokens: result.usage?.totalTokens ?? 0 };
}
