/**
 * @fileoverview Vocabulário do roadmap do time — fonte única para a rota, a
 * tela e os testes.
 *
 * As cinco etapas espelham o CHECK da tabela `roadmap_items`
 * (`20260831120000_roadmap_colaborativo.sql`). Mudar uma lista sem a outra faz
 * o item cair silenciosamente em "sugerido" na leitura, então elas andam juntas.
 *
 * "recusado" existe de propósito e não é castigo: sem um fim explícito a lista
 * vira cemitério, o time deixa de sugerir e o mural morre. Uma recusa com
 * motivo escrito ensina mais que silêncio.
 *
 * @module lib/roadmap/types
 */

export const ROADMAP_STATUS = ['sugerido', 'aprovado', 'em_andamento', 'feito', 'recusado'] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUS)[number];

export function isRoadmapStatus(value: unknown): value is RoadmapStatus {
  return typeof value === 'string' && (ROADMAP_STATUS as readonly string[]).includes(value);
}

/** Rótulo e explicação de cada etapa, na linguagem do time (não em jargão). */
export const ROADMAP_STATUS_LABEL: Record<RoadmapStatus, { titulo: string; ajuda: string }> = {
  sugerido: {
    titulo: 'Sugerido',
    ajuda: 'Alguém do time pediu. Ainda não foi decidido.',
  },
  aprovado: {
    titulo: 'Aprovado',
    ajuda: 'Vai ser feito. Ainda sem data.',
  },
  em_andamento: {
    titulo: 'Em andamento',
    ajuda: 'Está sendo construído agora.',
  },
  feito: {
    titulo: 'Feito',
    ajuda: 'Já está no ar, pode usar.',
  },
  recusado: {
    titulo: 'Não vai ser feito',
    ajuda: 'Decidido que não entra — o motivo fica escrito no item.',
  },
};

/** Ordem em que as colunas aparecem na tela: o que está vivo primeiro. */
export const ROADMAP_ORDEM: readonly RoadmapStatus[] = [
  'sugerido',
  'aprovado',
  'em_andamento',
  'feito',
  'recusado',
];

/** Um item do mural, já com votos e nomes resolvidos pela rota. */
export interface RoadmapItem {
  id: string;
  title: string;
  description: string | null;
  area: string | null;
  status: RoadmapStatus;
  /** Nome de quem sugeriu (nunca o e-mail). */
  autor: string;
  souOAutor: boolean;
  decididoPor: string | null;
  decididoEm: string | null;
  decisao: string | null;
  votos: number;
  votei: boolean;
  criadoEm: string;
  atualizadoEm: string;
}
