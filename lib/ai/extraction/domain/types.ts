/**
 * @fileoverview Domain-specific extraction — tipos do registry.
 *
 * Um "DomainExtractor" pluga a extração de campos de qualificação + classificação
 * (tier) específicos de um vertical (ex.: planos de saúde da Niva) num board.
 * Hoje o registry é em código (gated por board_id); a costura permite trocar por
 * config no `board_ai_config` quando o CRM virar produto multi-cliente.
 *
 * @module lib/ai/extraction/domain/types
 */

import type { z } from 'zod';

export type Tier = 'ouro' | 'prata' | 'bronze' | 'fora_icp' | 'indefinido';

export interface TierResult {
  tier: Tier;
  /** Motivos curtos da classificação (vão pro card / consultor). */
  motivos: string[];
  /** true quando faltam campos-chave e o tier é provisório (consultor termina na ligação). */
  provisorio: boolean;
}

export interface DomainApplyResult {
  /** custom_fields completo já mesclado (a service grava isso no deal). */
  customFields: Record<string, unknown>;
  tier: Tier;
  /** Tags de tier a garantir no deal (ex.: ['tier:ouro']). A service une e remove tier:* antigos. */
  tags: string[];
  /** priority sugerida (ouro=high, prata=medium, bronze=low). null = não mexer. */
  priority: 'high' | 'medium' | 'low' | null;
  /** Motivo da perda, quando fora_icp; null caso contrário. */
  lossReason: string | null;
  /**
   * Valor numérico a gravar em `deals.value` (aparece no topo do card e no total "na mesa"
   * da coluna). Para a Niva = a mensalidade que o lead paga hoje. null = não mexer no value.
   */
  dealValue?: number | null;
}

export interface DomainExtractor<T = unknown> {
  /** Identificador curto (logs). */
  key: string;
  /** Decide se este extractor se aplica ao board. */
  appliesTo(boardId: string | null | undefined): boolean;
  /** Schema Zod para Output.object (structured output). */
  schema: z.ZodType<T>;
  /** System prompt da extração. */
  systemPrompt: string;
  /**
   * Mescla a extração nos custom_fields atuais e calcula tier/tags/priority/loss.
   * PURO e DETERMINÍSTICO (sem I/O) — fácil de testar.
   */
  apply(currentCustomFields: Record<string, unknown>, extraction: T): DomainApplyResult;
}
