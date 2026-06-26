/**
 * @fileoverview Registry de domain extractors (gated por board).
 *
 * Costura limpa: hoje o mapeamento board→extractor é em código (só a Niva). Quando o
 * CRM virar produto multi-cliente, trocar este lookup por uma leitura de config no
 * `board_ai_config` — sem mexer no resto do pipeline.
 *
 * @module lib/ai/extraction/domain/registry
 */

import type { DomainExtractor } from './types';
import { nivaHealthExtractor } from './niva-health';

const EXTRACTORS: DomainExtractor[] = [nivaHealthExtractor as DomainExtractor];

/** Retorna o domain extractor aplicável ao board, ou null se nenhum (zero impacto em outras boards). */
export function getDomainExtractor(boardId: string | null | undefined): DomainExtractor | null {
  if (!boardId) return null;
  return EXTRACTORS.find((e) => e.appliesTo(boardId)) ?? null;
}
