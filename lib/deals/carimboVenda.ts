/**
 * @fileoverview O carimbo da venda — quem vendeu, quando, de onde e por quanto.
 *
 * `custom_fields.venda` é o registro de que a venda ACONTECEU. Ele importa mais do que parece:
 * a barra de meta do mês lê **ele**, não `is_won` (o card ganho sai do funil), a regra
 * "venda sem o prêmio informado" do gestor diário filtra por ele, e a rota que informa o prêmio
 * recusa card sem ele ("o prêmio só existe depois que o card é dado como ganho").
 *
 * Nasceu dentro de `app/api/deals/[dealId]/proximo-funil/route.ts`, o caminho do kanban. Foi
 * extraído para cá em 10/09/2026 quando o desfecho da call (voz e manual) passou a poder fechar
 * venda: sem um lugar só, os dois caminhos gravariam carimbos diferentes e a divergência apareceria
 * meses depois, no fechamento do mês.
 *
 * ⚠️ SEMÂNTICA — dois números parecidos e opostos (ver lib/deals/premioFechado.ts):
 * `valor_na_venda` é o `deals.value` congelado no instante da venda (na Niva, a mensalidade do
 * plano ANTIGO do lead); `premio_mensal` é o valor do plano COMPRADO. Só o segundo é receita.
 *
 * @module lib/deals/carimboVenda
 */

import { LIMITE_PREMIO_MENSAL } from './premioFechado';

export interface CarimboVenda {
  vendedor_id: string | null;
  vendedor_nome: string | null;
  vendido_em: string;
  board_id_da_venda: string;
  funil_da_venda: string;
  etapa_da_venda: string;
  /** `deals.value` no instante da venda. NÃO é o prêmio. */
  valor_na_venda: number;
  /** Mensalidade do plano COMPRADO. Ausente quando ainda não se sabe — nunca 0. */
  premio_mensal?: number;
  /** Operadora do plano comprado (define o percentual da comissão). */
  operadora?: string;
}

export interface EntradaCarimboVenda {
  vendedorId: string | null;
  vendedorNome: string | null;
  vendidoEm: string;
  boardIdDaVenda: string;
  funilDaVenda: string;
  etapaDaVenda: string;
  valorNaVenda: number;
  /** Só quando já se sabe no fechamento (o desfecho da call costuma saber). */
  premioMensal?: unknown;
  operadora?: unknown;
}

/**
 * Prêmio válido, ou `undefined`.
 *
 * `undefined` e não `0` de propósito: zero seria uma venda de R$0 somando na meta do mês, enquanto
 * ausente é exatamente o que a pendência âmbar do card e a regra do gestor sabem ler como
 * "falta informar". O teto é a mesma rede contra erro de digitação de `premioFechado`.
 */
function premioValido(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v <= 0 || v > LIMITE_PREMIO_MENSAL) return undefined;
  return v;
}

export function montarCarimboVenda(e: EntradaCarimboVenda): CarimboVenda {
  const carimbo: CarimboVenda = {
    vendedor_id: e.vendedorId,
    vendedor_nome: e.vendedorNome,
    vendido_em: e.vendidoEm,
    board_id_da_venda: e.boardIdDaVenda,
    funil_da_venda: e.funilDaVenda,
    etapa_da_venda: e.etapaDaVenda,
    valor_na_venda: e.valorNaVenda,
  };

  const premio = premioValido(e.premioMensal);
  if (premio !== undefined) carimbo.premio_mensal = premio;

  const operadora = typeof e.operadora === 'string' ? e.operadora.trim() : '';
  if (operadora) carimbo.operadora = operadora;

  return carimbo;
}
