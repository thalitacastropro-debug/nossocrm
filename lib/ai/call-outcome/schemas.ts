/**
 * Schema estruturado do desfecho da call (Zod v4). Cada .describe() É o prompt
 * do campo. Structured output roda SEMPRE no Gemini (Anthropic rejeita min/max/int).
 */
import { z } from 'zod';
import { MotivoTagSchema } from '@/lib/ai/taxonomy/motivos';

export const DesfechoSchema = z.object({
  desfecho: z
    .enum(['fechou', 'vai_pensar', 'perdeu', 'remarcar', 'nao_atendeu'])
    .describe('Resultado da ligação: fechou (vendeu), vai_pensar (segue em negociação), perdeu (não vai fechar), remarcar (vai ligar de novo), nao_atendeu (não atendeu/caixa postal)'),
  nota_resumo: z.string().describe('Resumo objetivo do que aconteceu na call, em 1-3 frases, para o histórico do card'),
  tarefas: z
    .array(z.object({
      descricao: z.string().describe('O que precisa ser feito (ex.: "enviar contrato", "mandar documentos", "ligar terça")'),
      // SEM fuso de propósito: fuso é o que o modelo mais erra (escreveu "10:00Z"
      // para um "10h" de Brasília, virando 07:00 no card do Bruce em 31/08/2026).
      // Quem resolve fuso e ano é normalizarDataTarefa, em código.
      data: z.string().nullable().describe('Data/hora da tarefa no formato AAAA-MM-DDTHH:mm, SEM fuso e SEM "Z", no horário de Brasília. Nunca uma data no passado. null se o consultor não disse quando'),
    }))
    .describe('TODAS as tarefas/próximos passos ditos no áudio. Cada uma vira uma atividade na agenda. Array vazio se nenhuma'),
  dados_negocio: z.object({
    operadora: z.string().nullable().describe('Operadora escolhida/negociada (ex.: Amil, Bradesco). null se não citada'),
    vidas: z.number().nullable().describe('Número de vidas do plano fechado/negociado. null se não citado'),
    valor: z.number().nullable().describe('Valor mensal do plano em reais (só número). null se não citado'),
  }).describe('Dados comerciais do negócio mencionados na call'),
  objecoes: z.array(MotivoTagSchema).describe('Objeções ouvidas na call, cada uma como categoria da taxonomia. Array vazio se nenhuma'),
  motivo_perda: MotivoTagSchema.nullable().describe('Categoria do motivo da perda. Preencher SOMENTE quando desfecho=perdeu; senão null'),
  motivo_perda_detalhe: z.string().nullable().describe('Detalhe livre do motivo da perda (frase do consultor). null se não perdeu'),
  reabordar_em: z.string().nullable().describe('Data ISO sugerida para reabordar o lead (só quando perdeu). Priorize o sinal REAL da conversa (vencimento do contrato/apólice, "me chama em março") sobre qualquer padrão. null se não perdeu'),
  confidence: z.number().describe('Confiança geral da extração, de 0 a 1'),
});

export type Desfecho = z.infer<typeof DesfechoSchema>;
