/**
 * @fileoverview Qualificação é pré-condição do agendamento.
 *
 * Decisão da Thalita em 09/09/2026: *"como ela vai marcar reunião sem arrancar os dados?"* e
 * *"categorizado é ter a medalha"*. Antes disto, o único gate antes de a Ana oferecer horário era
 * `fora_icp` — ela marcava reunião sem saber se havia CNPJ e sem saber quantas vidas, e o consultor
 * recebia um card sem medalha para descobrir tudo na ligação.
 *
 * ## A régua é o `classifyTier`, não uma lista nova
 *
 * O handoff descrevia o gate como "exigir tem_cnpj, vidas, idades e valor". Implementar isso como
 * uma segunda lista criaria duas verdades que divergem no primeiro ajuste — e divergiriam já: pela
 * régua vigente, **2 vidas** dão bronze sem precisar de idade nem valor, **valor abaixo de R$2.000**
 * dá bronze sem precisar de idades, e **primeiro plano** não tem valor para informar. Exigir os 4
 * sempre prenderia leads que já estão classificados.
 *
 * `classifyTier` já devolve `indefinido` exatamente quando falta dado para cravar a medalha. Então a
 * regra é uma frase: **tem medalha (ouro/prata/bronze) → pode agendar.**
 *
 * ## Um alvo por turno
 *
 * O risco nº 1 é a Ana repetir pergunta — o caso Isabella, 5x a mesma pergunta num lead pago. Por
 * isso este módulo devolve UM campo alvo, escolhido na ordem em que a conversa naturalmente anda, e
 * nunca um campo que já está preenchido. Quem imprime isso no prompt subordina o pedido ao bloco
 * "O QUE JÁ SABEMOS", que é a segunda trava contra a repetição.
 *
 * @module lib/ai/scheduling/qualificacao-gate
 */

import { classifyTier } from '@/lib/ai/extraction/domain/niva-health';
import type { Tier } from '@/lib/ai/extraction/domain/types';

/** Os campos que a Ana pode ir buscar para destravar a classificação. */
export type CampoQualificacao = 'tem_cnpj' | 'vidas' | 'idades' | 'valor_pago_exato';

export interface QualificacaoGate {
  /** Tem medalha? Só então a Ana oferece horário. */
  podeAgendar: boolean;
  tier: Tier;
  /** O que ainda falta, na ordem de prioridade. Vazio quando pode agendar. */
  faltando: CampoQualificacao[];
  /** O ÚNICO campo a perseguir neste turno. `null` quando não há o que perguntar. */
  alvo: CampoQualificacao | null;
  /** Como pedir esse campo, em português, pronto para o prompt. */
  comoPerguntar: string | null;
}

/**
 * Ordem de perseguição.
 *
 * Segue a conversa real: primeiro quantas pessoas entram (a resposta mais fácil e a que mais move a
 * régua), depois o CNPJ, depois as idades, e por último o valor. É a mesma sequência já instruída no
 * `stage_ai_config` da etapa em-qualificação, para o gate não brigar com a persona.
 */
const ORDEM: CampoQualificacao[] = ['vidas', 'tem_cnpj', 'idades', 'valor_pago_exato'];

const COMO_PERGUNTAR: Record<CampoQualificacao, string> = {
  vidas: 'quantas pessoas entram no plano (incluindo ele)',
  tem_cnpj: 'se ele tem CNPJ — e, se tiver, em qual cidade fica a empresa',
  idades: 'a idade de cada uma das pessoas que entram',
  valor_pago_exato: 'quanto ele paga hoje no plano atual, o valor exato da mensalidade',
};

interface QualificacaoAtual {
  tem_cnpj?: unknown;
  vidas?: unknown;
  idades?: unknown;
  valor_pago_exato?: unknown;
  tem_plano_atual?: unknown;
  quer_so_cotacao?: unknown;
}

function comoNumero(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

function comoIdades(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number' && !Number.isNaN(n)) : [];
}

/**
 * A Ana pode oferecer horário para este lead?
 *
 * @param qualificacao `deals.custom_fields.qualificacao` como está hoje (pode vir vazio)
 */
export function qualificacaoParaAgendar(qualificacao: QualificacaoAtual | null | undefined): QualificacaoGate {
  const q = qualificacao ?? {};
  const idades = comoIdades(q.idades);
  const vidas = comoNumero(q.vidas);
  const valor = comoNumero(q.valor_pago_exato);
  const temCnpj = (typeof q.tem_cnpj === 'string' ? q.tem_cnpj : 'desconhecido') as
    'pme' | 'mei' | 'vai_abrir_mei' | 'nao_tem' | 'desconhecido';

  const r = classifyTier({
    tem_cnpj: temCnpj,
    vidas,
    idades,
    valor_pago_exato: valor,
    quer_so_cotacao: false, // não é gate desde 14/08 (decisão da Thalita: "tira o poder de matar")
  });

  // Fora do ICP não é falta de dado: perguntar mais não muda nada, e quem barra o agendamento
  // nesse caso é o gate de ICP que já existe. Aqui só reportamos.
  if (r.tier === 'fora_icp') {
    return { podeAgendar: false, tier: r.tier, faltando: [], alvo: null, comoPerguntar: null };
  }

  if (r.tier !== 'indefinido') {
    return { podeAgendar: true, tier: r.tier, faltando: [], alvo: null, comoPerguntar: null };
  }

  // Indefinido: falta dado. Lista o que está ausente, na ordem de perseguição.
  const ausente: Record<CampoQualificacao, boolean> = {
    vidas: vidas == null,
    tem_cnpj: temCnpj === 'desconhecido',
    idades: idades.length === 0,
    // Primeiro plano não tem valor a informar — perguntar seria pedir um dado que não existe.
    valor_pago_exato: valor == null && q.tem_plano_atual !== 'nao',
  };

  const faltando = ORDEM.filter((c) => ausente[c]);
  const alvo = faltando[0] ?? null;

  return {
    podeAgendar: false,
    tier: r.tier,
    faltando,
    alvo,
    comoPerguntar: alvo ? COMO_PERGUNTAR[alvo] : null,
  };
}
