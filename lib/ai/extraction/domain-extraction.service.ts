/**
 * @fileoverview Domain-specific extraction runner.
 *
 * Roda a extração de campos de qualificação + classificação de tier de um vertical
 * (via registry, gated por board) e grava no deal: custom_fields.qualificacao, .tier,
 * .objecoes, tags (tier:*), priority e (em perda) loss_reason.
 *
 * Roda em observe E respond — só ATUALIZA DADOS do card; NÃO move etapa nem envia
 * mensagem. `is_lost` só é marcado fora do dry-run (mover card pra "perdido" é ação).
 *
 * @module lib/ai/extraction/domain-extraction.service
 */

import { generateText, Output } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getModel, type AIProvider } from '../config';
import { getDomainExtractor } from './domain/registry';
import { resolveExtractionLoss, PERDA_ORIGEM_EXTRACAO } from './loss-guard';

const MAX_MESSAGES_FOR_EXTRACTION = 30;

export interface RunDomainExtractionParams {
  supabase: SupabaseClient;
  dealId: string;
  conversationId: string;
  organizationId: string;
  boardId: string | null | undefined;
  /** Config de IA da org (passada pelo agent.service para evitar import circular). */
  aiConfig: { provider: AIProvider; apiKey: string; model: string; structuredApiKey: string; structuredModel: string };
  /** observe mode: não marca is_lost (não move o card). */
  dryRun: boolean;
}

export interface RunDomainExtractionResult {
  success: boolean;
  /** Indica se algum extractor se aplicou ao board. */
  applied?: boolean;
  tier?: string;
  error?: string;
}

/**
 * Extrai campos de domínio da conversa e atualiza o deal. No-op silencioso se nenhum
 * extractor se aplica ao board (outras orgs/boards não são afetadas).
 */
export async function runDomainExtraction(
  params: RunDomainExtractionParams,
): Promise<RunDomainExtractionResult> {
  const { supabase, dealId, conversationId, organizationId, boardId, aiConfig, dryRun } = params;

  const extractor = getDomainExtractor(boardId);
  if (!extractor) return { success: true, applied: false };

  try {
    // 1. Histórico da conversa
    const { data: messages } = await supabase
      .from('messaging_messages')
      .select('direction, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(MAX_MESSAGES_FOR_EXTRACTION);

    if (!messages || messages.length < 1) return { success: true, applied: true };

    const messagesText = messages
      .map((m) => {
        const role = m.direction === 'inbound' ? 'LEAD' : 'ATENDENTE';
        return `[${role}]: ${extractTextContent(m.content as Record<string, unknown>)}`;
      })
      .join('\n');

    // 2. Extração estruturada
    const model = getModel('google', aiConfig.structuredApiKey ?? aiConfig.apiKey, aiConfig.structuredModel ?? aiConfig.model);
    const result = await generateText({
      model,
      output: Output.object({
        schema: extractor.schema,
        name: 'DomainExtraction',
        description: 'Extração de campos de qualificação do vertical em português',
      }),
      system: extractor.systemPrompt,
      prompt: `Analise esta conversa e extraia os campos:\n\n${messagesText}`,
      maxRetries: 2,
    });

    // Log de tokens (fire-and-forget) para o budget contabilizar
    const tokensUsed = result.usage?.totalTokens ?? 0;
    if (tokensUsed > 0) {
      supabase
        .from('ai_conversation_log')
        .insert({
          organization_id: organizationId,
          conversation_id: conversationId,
          tokens_used: tokensUsed,
          model_used: aiConfig.model,
          action_taken: 'domain_extraction',
          action_reason: `Domain extraction (${extractor.key}) for deal ${dealId}`,
          ai_response: '',
        })
        .then(({ error }) => {
          if (error) console.error('[DomainExtraction] Failed to log tokens (non-fatal):', error.message);
        });
    }

    if (!result.output) return { success: false, applied: true, error: 'Sem output estruturado' };

    // 3. Estado atual do deal
    const { data: deal } = await supabase
      .from('deals')
      .select('custom_fields, tags, is_lost')
      .eq('id', dealId)
      .single();

    const applyResult = extractor.apply((deal?.custom_fields as Record<string, unknown>) || {}, result.output);

    // 4. Tags: preserva as não-tier, garante a tag de tier atual
    const prevTags = Array.isArray(deal?.tags) ? (deal!.tags as unknown[]).map(String) : [];
    const tags = Array.from(new Set([...prevTags.filter((t) => !t.startsWith('tier:')), ...applyResult.tags]));

    const update: Record<string, unknown> = {
      custom_fields: applyResult.customFields,
      tags,
      updated_at: new Date().toISOString(),
    };
    if (applyResult.priority) update.priority = applyResult.priority;
    // Valor "na mesa": grava a mensalidade atual em deals.value (topo do card + total da coluna).
    // Só sobe/atualiza quando o extractor tem um número; nunca zera um valor já preenchido.
    if (typeof applyResult.dealValue === 'number' && applyResult.dealValue > 0) {
      update.value = applyResult.dealValue;
    }
    // GUARD (P0 24/07 — cards da Graci/Giovana "sumiram"): um lead com reunião JÁ confirmada
    // ou já entregue ao consultor (handoff) NUNCA é marcado perdido pela extração. Marcar a
    // reunião é a verdade da intenção do lead (ele topou falar com o consultor); setar is_lost
    // sobrescreve isso e SOME com o card (o board filtra 'open' = esconde is_lost), fazendo o
    // consultor perder um agendamento real. Mantemos o loss_reason como CONTEXTO pro consultor
    // (ex.: "só quer cotação e recusa diagnóstico"), mas o card continua vivo e visível.
    //
    // CAMINHO DE VOLTA (P0.3, 14/08 — caso Ruberleide): a extração relê a conversa INTEIRA a cada
    // turno, então um falso positivo ("Quero cotar com estas vidas apenas", dito 4 dias antes)
    // re-dispara pra sempre. Antes, is_lost só era ESCRITO e nunca limpo — um turno errado virava
    // estado permanente e o card sumia. Agora a extração desfaz a PRÓPRIA conclusão quando muda de
    // ideia; perda decidida por humano é intocável. Ver lib/ai/extraction/loss-guard.ts.
    const cf = (deal?.custom_fields as Record<string, unknown> | null | undefined) ?? {};
    const reuniao = cf.reuniao_agendada as { status?: string } | undefined;
    const lossFields = resolveExtractionLoss({
      lossReason: applyResult.lossReason ?? null,
      meetingConfirmed: reuniao?.status === 'confirmada' || reuniao?.status === 'confirmed',
      alreadyHandedOff: cf.handoff_consultor != null,
      currentIsLost: deal?.is_lost === true,
      lossOwnedByExtraction: cf.perda_origem === PERDA_ORIGEM_EXTRACAO,
    });

    if (lossFields.loss_reason !== undefined) update.loss_reason = lossFields.loss_reason;
    // Mexer no is_lost é ação (some/volta o card) — só fora do dry-run (observe não move card).
    if (!dryRun && lossFields.is_lost !== undefined) {
      update.is_lost = lossFields.is_lost;
      // Carimba (ou apaga) a autoria da perda, pra nunca reverter o que um humano decidiu.
      const cfOut = { ...(applyResult.customFields as Record<string, unknown>) };
      if (lossFields.is_lost) cfOut.perda_origem = PERDA_ORIGEM_EXTRACAO;
      else delete cfOut.perda_origem;
      update.custom_fields = cfOut;
    }

    const { error: updateError } = await supabase.from('deals').update(update).eq('id', dealId);
    if (updateError) {
      console.error('[DomainExtraction] Failed to update deal:', updateError);
      return { success: false, applied: true, error: updateError.message };
    }

    console.log('[DomainExtraction] %s → tier=%s deal=%s', extractor.key, applyResult.tier, dealId);
    return { success: true, applied: true, tier: applyResult.tier };
  } catch (error) {
    console.error('[DomainExtraction] Error:', error);
    return { success: false, applied: true, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function extractTextContent(content: Record<string, unknown>): string {
  if (typeof content === 'string') return content;
  if (content?.text && typeof content.text === 'string') return content.text;
  if (content?.type === 'image') return '[Imagem]';
  if (content?.type === 'audio') return '[Áudio]';
  if (content?.type === 'video') return '[Vídeo]';
  if (content?.type === 'document') return '[Documento]';
  return '[Mensagem]';
}
