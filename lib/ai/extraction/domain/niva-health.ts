/**
 * @fileoverview Domain extractor da Niva — planos de saúde EMPRESARIAIS.
 *
 * Extrai os campos da §10 (handoff-whatsapp-oficial-sdr.md) da conversa e classifica
 * o tier (§10.1) de forma DETERMINÍSTICA (não deixa o LLM fazer a aritmética dos
 * thresholds). Aplica só na board SDR inbound da Niva (registry gated por board_id).
 *
 * @module lib/ai/extraction/domain/niva-health
 */

import { z } from 'zod';
import type { DomainExtractor, DomainApplyResult, TierResult } from './types';

/** Board SDR — IA Qualificação (inbound) da Niva. */
export const NIVA_SDR_BOARD_ID = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';

// =============================================================================
// Schema de extração (§10)
// =============================================================================

export const NivaHealthSchema = z.object({
  tem_cnpj: z
    .enum(['pme', 'mei', 'vai_abrir_mei', 'nao_tem', 'desconhecido'])
    .describe(
      'Situação de CNPJ: pme (já tem empresa/CNPJ), mei, vai_abrir_mei (não tem mas topa abrir), nao_tem (não tem e não quer abrir), desconhecido (não falou)',
    ),
  vidas: z.number().int().nullable().describe('Número de pessoas (vidas) no plano. null se não informado'),
  idades: z.array(z.number().int()).describe('Idade de cada vida informada pelo lead. Array vazio se não informado'),
  tem_plano_atual: z.enum(['sim', 'nao', 'desconhecido']).describe('Se o lead já tem plano de saúde hoje'),
  operadora: z.string().nullable().describe('Operadora do plano atual. null se não informado'),
  valor_pago_exato: z
    .number()
    .nullable()
    .describe('Valor EXATO da mensalidade atual em reais (apenas número). null se é o primeiro plano ou não informou'),
  coparticipacao: z.enum(['com', 'sem', 'desconhecido']).describe('Se o plano atual tem coparticipação'),
  hospital_preferencia: z.string().nullable().describe('Hospital ou rede de preferência. null se não informado'),
  cidade_uf: z.string().nullable().describe('Cidade/UF do lead. null se não informado'),
  reuniao_preferencia: z
    .string()
    .nullable()
    .describe('Preferência de dia e turno para a ligação do consultor (ex.: "terça de manhã"). null se não combinado'),
  algo_a_destacar: z.string().nullable().describe('Algo que o lead queira destacar para o consultor. null se nada'),
  objecoes: z
    .array(z.string())
    .describe('Objeções levantadas pelo lead (ex.: preço, cobertura, carência, desconfiança). Array vazio se nenhuma'),
  quer_so_cotacao: z
    .boolean()
    .describe('true SOMENTE se o lead insiste em receber cotação/preço e recusa o diagnóstico/agendamento'),
  overallConfidence: z.number().min(0).max(1).describe('Confiança geral da extração (0 a 1)'),
});

export type NivaHealthExtraction = z.infer<typeof NivaHealthSchema>;

const SYSTEM_PROMPT = `Você extrai dados de qualificação de planos de saúde EMPRESARIAIS de uma conversa de WhatsApp entre a atendente (SDR) e o lead.

REGRAS:
- Extraia SOMENTE o que o lead disse explicitamente. Não invente nem assuma.
- Use null / "desconhecido" / array vazio quando a informação não aparecer.
- tem_cnpj: "pme" se já tem empresa/CNPJ; "mei" se é MEI; "vai_abrir_mei" se não tem mas aceita abrir; "nao_tem" se não tem e não quer abrir; "desconhecido" se não falou.
- vidas: número de pessoas que entram no plano. idades: a idade de CADA vida que o lead informou.
- valor_pago_exato: o valor EXATO da mensalidade ATUAL, apenas o número em reais (ex.: 2500). null se é o primeiro plano ou se não informou o valor.
- quer_so_cotacao: true apenas se o lead insistir em cotação/preço e recusar o diagnóstico/agendamento.
- objecoes: liste objeções levantadas (preço, cobertura, rede, carência, desconfiança, etc.).
- Responda em português brasileiro.`;

// =============================================================================
// Classificação de tier (§10.1) — DETERMINÍSTICA
// =============================================================================

/**
 * Classifica o tier conforme §10.1. Precedência aplicada (documentada):
 *  1. Gates → fora_icp: só quer cotação · sem CNPJ e não quer MEI · 1 vida (individual).
 *  2. Falta CNPJ ou nº de vidas → indefinido (provisório).
 *  3. 2 vidas → bronze (operadoras aceitam com limitação; ideal 3+) — independe do valor.
 *  4. 3+ vidas:
 *     - valor < R$2.000 → bronze (idades não mudam isso);
 *     - idades desconhecidas (e valor não é baixo) → indefinido (idades decidiriam o tier — não
 *       cravamos no escuro; decisão da dona, confirmada por verificação adversarial);
 *     - maioria das vidas > 67 anos → bronze (mesmo com valor alto);
 *     - valor ≥ R$5.000 e TODOS ≤ 67 → ouro;
 *     - demais (valor 2.000–4.999; ou ≥5.000 com 1+ vida >67 não-maioria; ou primeiro
 *       plano sem valor com idades conhecidas) → prata.
 * `provisorio` = faltam idades e/ou valor (consultor termina de qualificar na ligação).
 */
export function classifyTier(f: {
  tem_cnpj: NivaHealthExtraction['tem_cnpj'];
  vidas: number | null;
  idades: number[];
  valor_pago_exato: number | null;
  quer_so_cotacao: boolean;
}): TierResult {
  const idades = Array.isArray(f.idades) ? f.idades.filter((n) => typeof n === 'number' && !Number.isNaN(n)) : [];
  const valor = typeof f.valor_pago_exato === 'number' ? f.valor_pago_exato : null;

  // 1. Gates eliminatórios
  if (f.quer_so_cotacao === true) {
    return { tier: 'fora_icp', motivos: ['Só quer cotação e recusa o diagnóstico'], provisorio: false };
  }
  if (f.tem_cnpj === 'nao_tem') {
    return { tier: 'fora_icp', motivos: ['Sem CNPJ e não quer abrir MEI'], provisorio: false };
  }
  if (f.vidas != null && f.vidas < 2) {
    return { tier: 'fora_icp', motivos: ['Apenas 1 vida (plano individual, fora do perfil)'], provisorio: false };
  }

  // 2. Dados essenciais ausentes → provisório
  if (f.tem_cnpj === 'desconhecido' || f.vidas == null) {
    return {
      tier: 'indefinido',
      motivos: ['Faltam dados essenciais para classificar (CNPJ e/ou número de vidas)'],
      provisorio: true,
    };
  }

  const vidas = f.vidas;
  const maxIdade = idades.length ? Math.max(...idades) : null;
  const todosAte67 = maxIdade != null ? maxIdade <= 67 : null; // null = idades desconhecidas
  const maioriaMais67 = idades.length ? idades.filter((a) => a > 67).length > idades.length / 2 : false;
  const provisorio = idades.length === 0 || valor == null;

  // 3. 2 vidas → bronze (limitação estrutural; valor/idades não sobrepõem)
  if (vidas === 2) {
    return { tier: 'bronze', motivos: ['2 vidas (operadoras aceitam com limitação; ideal 3+)'], provisorio };
  }

  // 4. 3+ vidas
  // 4a. Valor baixo → bronze (idades não mudam isso).
  if (valor != null && valor < 2000) {
    return { tier: 'bronze', motivos: [`${vidas} vidas`, `paga R$${valor} (abaixo de R$2.000)`], provisorio };
  }
  // 4b. Idades desconhecidas (e valor não é baixo) → indefinido: as idades decidiriam ouro/prata/
  //     bronze, então não cravamos no escuro. Decisão da dona (verificação adversarial: 4/4 leitores).
  if (idades.length === 0) {
    return {
      tier: 'indefinido',
      motivos: [`${vidas} vidas`, 'faltam as idades para classificar com segurança (o consultor confirma)'],
      provisorio: true,
    };
  }
  // 4c. Idades conhecidas a partir daqui.
  if (maioriaMais67) {
    return { tier: 'bronze', motivos: [`${vidas} vidas`, 'maioria das vidas acima de 67 anos'], provisorio };
  }
  if (valor != null && valor >= 5000 && todosAte67 === true) {
    return { tier: 'ouro', motivos: [`${vidas} vidas`, 'todos até 67 anos', `paga R$${valor}`], provisorio: false };
  }

  // Demais 3+ vidas → prata
  const motivos: string[] = [`${vidas} vidas`];
  if (valor != null) motivos.push(`paga R$${valor}`);
  else motivos.push('primeiro plano (ticket a definir na ligação)');
  if (todosAte67 === false) motivos.push('1+ vida acima de 67 (não maioria)');
  return { tier: 'prata', motivos, provisorio };
}

// =============================================================================
// apply() — mescla custom_fields + grava tier/objeções/tags/priority/loss
// =============================================================================

function isMeaningful(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function apply(current: Record<string, unknown>, ext: NivaHealthExtraction): DomainApplyResult {
  const customFields: Record<string, unknown> = { ...(current || {}) };

  // 1. Mescla qualificação (preserva o que já era conhecido; só sobrescreve com valor novo não-vazio)
  const prevQual = (customFields.qualificacao as Record<string, unknown>) || {};
  const merged: Record<string, unknown> = { ...prevQual };
  const setIf = (k: string, v: unknown) => {
    if (isMeaningful(v)) merged[k] = v;
  };
  setIf('tem_cnpj', ext.tem_cnpj === 'desconhecido' ? null : ext.tem_cnpj);
  setIf('vidas', ext.vidas);
  setIf('idades', ext.idades);
  setIf('tem_plano_atual', ext.tem_plano_atual === 'desconhecido' ? null : ext.tem_plano_atual);
  setIf('operadora', ext.operadora);
  setIf('valor_pago_exato', ext.valor_pago_exato);
  setIf('coparticipacao', ext.coparticipacao === 'desconhecido' ? null : ext.coparticipacao);
  setIf('hospital_preferencia', ext.hospital_preferencia);
  setIf('cidade_uf', ext.cidade_uf);
  setIf('reuniao_preferencia', ext.reuniao_preferencia);
  setIf('algo_a_destacar', ext.algo_a_destacar);
  customFields.qualificacao = merged;

  // 2. Objeções (acumula + dedupe)
  if (Array.isArray(ext.objecoes) && ext.objecoes.length) {
    const prev = Array.isArray(customFields.objecoes) ? (customFields.objecoes as unknown[]).map(String) : [];
    customFields.objecoes = Array.from(new Set([...prev, ...ext.objecoes.map(String)]));
  }

  // 3. Tier determinístico — usa os dados MESCLADOS (acumulados ao longo da conversa)
  const tierResult = classifyTier({
    tem_cnpj: (merged.tem_cnpj as NivaHealthExtraction['tem_cnpj']) ?? 'desconhecido',
    vidas: typeof merged.vidas === 'number' ? (merged.vidas as number) : null,
    idades: Array.isArray(merged.idades) ? (merged.idades as number[]) : [],
    valor_pago_exato: typeof merged.valor_pago_exato === 'number' ? (merged.valor_pago_exato as number) : null,
    quer_so_cotacao: ext.quer_so_cotacao === true,
  });
  customFields.tier = {
    value: tierResult.tier,
    motivos: tierResult.motivos,
    provisorio: tierResult.provisorio,
  };

  const priority: DomainApplyResult['priority'] =
    tierResult.tier === 'ouro'
      ? 'high'
      : tierResult.tier === 'prata'
        ? 'medium'
        : tierResult.tier === 'bronze'
          ? 'low'
          : null;

  const lossReason = tierResult.tier === 'fora_icp' ? tierResult.motivos[0] ?? 'Fora do perfil (ICP)' : null;

  return {
    customFields,
    tier: tierResult.tier,
    // Não gera tag de tier: o selo COLORIDO do card (derivado de custom_fields.tier)
    // já mostra o tier automaticamente. Uma tag "tier:bronze" além do selo seria
    // informação duplicada. A service ainda remove tags tier:* antigas dos deals.
    tags: [],
    priority,
    lossReason,
  };
}

// =============================================================================
// Extractor
// =============================================================================

export const nivaHealthExtractor: DomainExtractor<NivaHealthExtraction> = {
  key: 'niva-health',
  appliesTo: (boardId) => boardId === NIVA_SDR_BOARD_ID,
  schema: NivaHealthSchema,
  systemPrompt: SYSTEM_PROMPT,
  apply,
};
