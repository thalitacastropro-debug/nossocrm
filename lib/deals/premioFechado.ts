/**
 * @fileoverview O PRÊMIO DO PLANO VENDIDO — o número que o CRM nunca guardou.
 *
 * ATENÇÃO À SEMÂNTICA, porque aqui moram dois números parecidos e opostos:
 *
 * - `deals.value` NESTA OPERAÇÃO é **a mensalidade que o lead paga hoje no plano ANTIGO**.
 *   Vem de `custom_fields.qualificacao.valor_pago_exato`, apurado pela Ana na qualificação.
 *   É o gatilho da conversa ("você paga R$ 750 e pode pagar menos"), não receita.
 * - `custom_fields.venda.premio_mensal` é **a mensalidade do plano que o cliente COMPROU**.
 *   É este o número que fecha o mês: "Já ganho no mês" soma ele, e a comissão é um
 *   percentual DELE, variável por operadora (Porto 250%, AMIL 260%, Sulamérica 250%,
 *   Alice 220%, Bradesco 330% — média 262%).
 *
 * Enquanto o prêmio não existia, o topo do funil somava o plano VELHO do lead e qualquer
 * número de comissão na tela seria chute (niva-os-visao.md §1, roadmap §6c).
 *
 * ⚠️ COMISSÃO NÃO MORA AQUI. A tabela de percentuais é dado confidencial: em 26/08/2026 o
 * `goal_description` do funil expôs pró-labore e comissão média para todo o time. Este
 * módulo guarda o PRÊMIO; o cálculo da comissão vive na tela restrita de fechamento do mês.
 *
 * @module lib/deals/premioFechado
 */

/**
 * Teto de sanidade do prêmio MENSAL (R$). Não é regra de negócio — é rede contra erro de
 * digitação, que aqui custa caro: um zero a mais infla a meta do mês e, depois, a comissão.
 * Plano empresarial de família grande com vidas idosas não passa disso nem de longe.
 */
export const LIMITE_PREMIO_MENSAL = 100_000;

/** Tamanho máximo do nome da operadora (o campo aceita "Outra" digitada à mão). */
export const LIMITE_TAMANHO_OPERADORA = 80;

/** Os três campos do plano vendido, do jeito que ficam em `custom_fields.venda`. */
export interface PremioFechado {
  /** Mensalidade do plano COMPRADO (R$). */
  premio_mensal: number;
  /** Operadora do plano comprado — é ela que define o percentual da comissão. */
  operadora: string;
  /** Início de vigência (`YYYY-MM-DD`). Nem toda venda já sabe a data no fechamento. */
  vigencia_em: string | null;
}

/** O que chega do formulário (ou do corpo da requisição): nada é confiável. */
export interface EntradaPremioFechado {
  premio_mensal?: unknown;
  operadora?: unknown;
  vigencia_em?: unknown;
}

export type ResultadoValidacao =
  | { ok: true; valor: PremioFechado }
  | { ok: false; erro: string };

/** `YYYY-MM-DD` — o formato do `<input type="date">`. */
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Número vindo de formulário brasileiro. O `<input>` manda texto e a pessoa digita
 * "1.234,50": `Number('1.234,50')` é NaN e `parseFloat` devolveria 1 — os dois errados, e o
 * segundo errado EM SILÊNCIO, que é o pior tipo de erro para um campo de dinheiro.
 */
const paraNumero = (valor: unknown): number | null => {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (limpo === '') return null;
  // "1.234,50" → "1234.50"; "1234.50" (sem vírgula) fica como está.
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
};

/** Data existe de verdade? `2026-02-31` passa no regex e não existe no calendário. */
const dataValida = (texto: string): boolean => {
  if (!FORMATO_DATA.test(texto)) return false;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
  );
};

/**
 * Valida e normaliza o prêmio fechado. Mensagens em português e acionáveis: elas aparecem
 * direto para quem está preenchendo o card.
 */
export const validarPremioFechado = (entrada: EntradaPremioFechado): ResultadoValidacao => {
  const premio = paraNumero(entrada.premio_mensal);
  if (premio === null) {
    return { ok: false, erro: 'Informe o prêmio mensal do plano vendido (ex.: 1.850,00).' };
  }
  if (premio <= 0) {
    return { ok: false, erro: 'O prêmio mensal precisa ser maior que zero.' };
  }
  if (premio > LIMITE_PREMIO_MENSAL) {
    return {
      ok: false,
      erro: `Confira o valor: ${premio.toLocaleString('pt-BR')} é alto demais para uma mensalidade. `
        + 'O campo é o prêmio MENSAL do plano vendido, não o anual nem a comissão.',
    };
  }

  const operadora = typeof entrada.operadora === 'string' ? entrada.operadora.trim() : '';
  if (operadora === '') {
    return { ok: false, erro: 'Informe a operadora do plano vendido.' };
  }
  if (operadora.length > LIMITE_TAMANHO_OPERADORA) {
    return { ok: false, erro: 'Nome da operadora muito longo.' };
  }

  let vigencia: string | null = null;
  const vigenciaBruta = typeof entrada.vigencia_em === 'string' ? entrada.vigencia_em.trim() : '';
  if (vigenciaBruta !== '') {
    if (!dataValida(vigenciaBruta)) {
      return { ok: false, erro: 'Data de vigência inválida. Use o seletor de data.' };
    }
    vigencia = vigenciaBruta;
  }

  // Duas casas: dinheiro. Sem isso, "1234.567" entraria e reapareceria arredondado na tela,
  // sem bater com o que foi gravado.
  return {
    ok: true,
    valor: { premio_mensal: Math.round(premio * 100) / 100, operadora, vigencia_em: vigencia },
  };
};

/** O carimbo já tem prêmio utilizável? Aceita qualquer coisa: o JSON vem do banco. */
export const lerPremioFechado = (venda: unknown): PremioFechado | null => {
  if (typeof venda !== 'object' || venda === null) return null;
  const bruto = venda as Record<string, unknown>;
  const premio = typeof bruto.premio_mensal === 'number' ? bruto.premio_mensal : null;
  if (premio === null || !Number.isFinite(premio) || premio <= 0) return null;
  return {
    premio_mensal: premio,
    operadora: typeof bruto.operadora === 'string' ? bruto.operadora : '',
    vigencia_em: typeof bruto.vigencia_em === 'string' && bruto.vigencia_em !== ''
      ? bruto.vigencia_em
      : null,
  };
};

/**
 * A pendência da tela: card CARIMBADO como venda e ainda sem prêmio.
 *
 * É deliberadamente "só um aviso". A alternativa — um modal obrigatório no momento do
 * arrastar — travaria quem está operando o funil, e a operação vem antes do relatório
 * (niva-os-visao.md §1: "a operação não trava; o número não some").
 */
export const precisaInformarPremio = (venda: unknown): boolean => {
  if (typeof venda !== 'object' || venda === null) return false;
  return lerPremioFechado(venda) === null;
};
