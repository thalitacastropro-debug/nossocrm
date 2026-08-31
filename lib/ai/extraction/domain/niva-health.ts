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
import type { DomainExtractor, DomainApplyResult, TierResult, Tier } from './types';
import { MotivoTagSchema, type MotivoTag } from '@/lib/ai/taxonomy/motivos';

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
    .array(MotivoTagSchema)
    .describe('Objeções levantadas pelo lead, cada uma como categoria da taxonomia (sem_oportunidade [inclui preço/caro], ficou_na_atual, carencia, rede, concorrente, fora_icp, sem_resposta, timing, reembolso, confianca, decisor, burocracia, outro). Array vazio se nenhuma'),
  quer_so_cotacao: z
    .boolean()
    .describe(
      'true SOMENTE se o lead RECUSAR explicitamente falar com o consultor/agendar, insistindo em receber só o preço. ' +
        'Pedir cotação, perguntar quanto custa ou dizer quantas vidas quer cotar NÃO conta. ' +
        'Se o lead segue respondendo as perguntas, escolheu um horário, ou simplesmente não recusou nada, é false.'
    ),
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
- quer_so_cotacao: é um GATE que descarta o lead — só marque true com RECUSA EXPLÍCITA de falar com o consultor
  (ex.: "não quero conversar, só me manda o preço", "não tenho interesse em reunião"). Pedir cotação, perguntar
  quanto custa ou dizer quantas vidas quer cotar ("quero cotar com estas vidas apenas") NÃO é recusa — é interesse.
  Se o lead continua respondendo, escolheu um horário, ou não recusou nada explicitamente: false. Na dúvida, false.
- objecoes: classifique cada objeção levantada numa categoria da taxonomia: sem_oportunidade (inclui "achou caro"/preço), ficou_na_atual, carencia, rede, concorrente, fora_icp, sem_resposta, timing, reembolso, confianca, decisor, burocracia, outro.
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
/** Tag no card quando o lead resiste ao diagnóstico e insiste só em preço. */
export const TAG_SO_COTACAO = 'so-cotacao';
/** Texto da objeção correspondente (usado também pra dedup). */
export const OBJECAO_SO_COTACAO = 'só quer cotação — resistiu ao diagnóstico';

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
  //
  // `quer_so_cotacao` NÃO é gate (decisão da Thalita, 14/08 — "tira o poder de matar").
  // Era: um palpite do modelo sobre INTENÇÃO virava descarte irreversível. Matou a Ruberleide,
  // que só tinha escrito "Quero cotar com estas vidas apenas" (dizendo quantas vidas entram) e
  // depois aceitou o horário das 14h; e quase matou a Graci. Como a extração relê a conversa
  // inteira a cada turno, a frase re-disparava pra sempre. Agora o sinal vira OBJEÇÃO + TAG
  // (ver apply()) e quem decide descartar é o consultor. Os gates abaixo são FATOS
  // verificáveis (não tem CNPJ, nº de vidas), não leitura de intenção.
  if (f.tem_cnpj === 'nao_tem') {
    return { tier: 'fora_icp', motivos: ['Sem CNPJ e não quer abrir MEI'], provisorio: false };
  }
  if (f.vidas != null && f.vidas < 2) {
    // 1 vida = plano individual, em geral fora do perfil empresarial. EXCEÇÃO (política da Thalita,
    // 27/07): se o que a pessoa paga hoje for ALTO (> R$1.500/mês), é alto ticket individual e vale
    // a avaliação do consultor — não elimina. Sem valor conhecido (ex.: primeiro plano), não dá pra
    // presumir alto ticket → fora do perfil.
    const altoTicket1Vida = valor != null && valor > 1500;
    if (!altoTicket1Vida) {
      return { tier: 'fora_icp', motivos: ['Apenas 1 vida (plano individual, fora do perfil)'], provisorio: false };
    }
    // Alto ticket, mas o produto é EMPRESARIAL (exige CNPJ). Se o CNPJ ainda é desconhecido, não crava
    // 'prata' prematuro (nem semeia no intake): fica indefinido/provisório e o consultor confirma. Com
    // CNPJ conhecido (pme/mei/vai_abrir_mei — 'nao_tem' já foi eliminado acima) → prata provisório.
    if (f.tem_cnpj === 'desconhecido') {
      return {
        tier: 'indefinido',
        motivos: ['1 vida com ticket alto — confirmar CNPJ (o consultor avalia)'],
        provisorio: true,
      };
    }
    return {
      tier: 'prata',
      motivos: ['1 vida, mas ticket alto', `paga R$${valor} hoje (o consultor avalia)`],
      provisorio: true,
    };
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

/**
 * Deriva `tem_cnpj` do FORMULÁRIO do lead (Meta Lead Ads), como FALLBACK de quando a conversa
 * não estabeleceu o CNPJ. O lead responde "Você possuí CNPJ" no form; se disse "sim" (ou já
 * preencheu o número), ele TEM empresa → 'pme'. Foi o buraco da Nathalia: ela desviou da
 * pergunta na conversa ("mando depois") → a extração ficou 'desconhecido' → tier indefinido
 * apesar do form dizer "sim". A extração da CONVERSA, quando existe, tem precedência (só caímos
 * aqui com `merged.tem_cnpj == null`). NÃO inferimos 'nao_tem' do form: um "não" ali pode virar
 * 'vai_abrir_mei' na conversa — deixamos indefinido, mais seguro.
 */
export function cnpjFromLeadForm(current: Record<string, unknown> | null | undefined): 'pme' | null {
  // `leadFormSource` (raw ?? fields), igual às irmãs desta família. Antes lia SÓ `raw`, e
  // lead que chega apenas com `fields` — importação manual, intake de outra origem — tinha
  // o CNPJ ignorado: sem CNPJ o `classifyTier` para em "faltam dados essenciais" e o card
  // nasce sem selo. Foi o que aconteceu com os leads recuperados à mão em 27/08/2026.
  const raw = leadFormSource(current);
  if (!raw) return null;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') continue;
    const key = k.toLowerCase();
    if (/possu.*cnpj/.test(key) && /^\s*sim/i.test(v)) return 'pme';
    if (/n[uú]mero.*cnpj/.test(key) && v.replace(/\D/g, '').length >= 8) return 'pme';
  }
  return null;
}

/** Campos do lead_form (Meta Lead Ads). Prefere `raw` (todos os campos), cai em `fields`. */
function leadFormSource(current: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const lf = current?.lead_form as { raw?: Record<string, unknown>; fields?: Record<string, unknown> } | undefined;
  const src = lf?.raw ?? lf?.fields;
  return src && typeof src === 'object' ? src : null;
}

/**
 * Idades a partir do FORMULÁRIO (campo "Quais as idades das pessoas": "41,30,17,13 e 1 ano").
 * Extrai todos os inteiros plausíveis (0–120). O nº de idades informadas é o proxy do nº de vidas
 * a cobrir. Vazio se o campo não existe ou não tem números.
 */
export function idadesFromLeadForm(current: Record<string, unknown> | null | undefined): number[] {
  const src = leadFormSource(current);
  if (!src) return [];
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'string' || !/idade/i.test(k)) continue;
    // 0–120: idade 0 = recém-nascido é uma vida válida (não descartar, senão subconta vidas).
    const nums = (v.match(/\d+/g) ?? []).map((n) => parseInt(n, 10)).filter((n) => n >= 0 && n <= 120);
    if (nums.length) return nums;
  }
  return [];
}

/**
 * Nº de VIDAS direto do formulário — o campo que o formulário NOVO do Meta passou a usar.
 *
 * O formulário antigo perguntava "Quais as idades das pessoas" e as vidas saíam de contar as
 * idades (`idadesFromLeadForm`). O que estreou em 21/08/2026 ("21.08 FORM VIDEOS") pergunta
 * **"Quantas vidas você tem para adicionar no plano?"** e responde `4_vidas`. Ninguém lia
 * isso: `vidas` ficava null e o tier caía em `indefinido` com o motivo "Faltam dados
 * essenciais (CNPJ e/ou número de vidas)" — foi o que aconteceu com o lead Bruce Mendes em
 * 27/08 e o que a dona viu como "leads chegando sem categorização".
 *
 * Teto de 30: acima disso é digitação errada ou o lead respondendo outra coisa no campo, e
 * vida demais infla o tier — justamente o erro que faria alguém priorizar o lead errado.
 * Zero não conta: plano sem vida não existe.
 */
export function vidasFromLeadForm(current: Record<string, unknown> | null | undefined): number | null {
  const src = leadFormSource(current);
  if (!src) return null;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'string') continue;
    const key = k.toLowerCase();
    // Só o campo de VIDAS. "idade" e "quanto paga" têm funções próprias — casar aqui faria
    // "49,48,26" virar 49 vidas e "3200" virar 3200 vidas.
    if (!/vida/.test(key)) continue;
    if (/idade/.test(key) || /quanto/.test(key) || /paga/.test(key)) continue;
    const n = parseInt((v.match(/\d+/) ?? [''])[0], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 30) return n;
  }
  return null;
}

/**
 * Valor da mensalidade ATUAL a partir do formulário (campo "Quanto você paga atualmente no seu
 * plano": "1200 p 2 vidas" / "2250" / "R$ 2.500,00"). Pega o primeiro número em reais, tolerando
 * separador de milhar (.) e decimal (,). null se não houver número. NÃO casa "Você possuí plano de
 * saúde" (sem "quanto"/"paga").
 */
export function valorFromLeadForm(current: Record<string, unknown> | null | undefined): number | null {
  const src = leadFormSource(current);
  if (!src) return null;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'string') continue;
    const key = k.toLowerCase();
    if (!(/quanto.*paga/.test(key) || /mensalidade/.test(key) || /valor.*plano/.test(key))) continue;
    const m = v.match(/\d[\d.,]*/);
    if (!m) return null;
    let tok = m[0];
    if (tok.includes(',')) tok = tok.replace(/\./g, '').replace(',', '.'); // 2.500,00 -> 2500.00
    else tok = tok.replace(/\.(?=\d{3}\b)/g, ''); // 2.250 -> 2250 (milhar); 1200 -> 1200
    const n = Number(tok);
    if (!Number.isFinite(n)) return null;
    // Sufixo "mil"/"k" (formas comuns no BR: "5 mil", "5k" = R$5.000). Multiplica por 1000 só se o
    // número for pequeno (< 1000), pra não estragar "5000" ou "2.500,00".
    const after = v.slice((m.index ?? 0) + m[0].length);
    const isMil = /^\s*k\b/i.test(after) || /\bmil\b/i.test(v);
    return Math.round(isMil && n < 1000 ? n * 1000 : n);
  }
  return null;
}

/**
 * O lead JÁ TEM plano, segundo o formulário? 'sim' | 'nao' | null (não dá pra saber).
 *
 * O CASO QUE ISTO CONSERTA (lead Pablo, 31/08/2026): a Ana abriu com *"você informou que paga
 * mais de R$ 3.500 hoje"* e, na bolha seguinte, perguntou *"você já tem algum plano de saúde no
 * momento?"*. Quem paga R$3.500 num plano já respondeu essa pergunta — o que falta saber é QUAL
 * plano é esse.
 *
 * Por que aconteceu: o campo explícito **"Você possuí plano de saúde" chega VAZIO** (o Make ainda
 * manda os campos do formulário ANTIGO em branco — pendência conhecida), então quem responde de
 * fato é **"Quanto você paga atualmente no seu plano"**. Ali cabem as duas respostas:
 *   - "Mais de R$ 3500" / "1200 p 2 vidas"  -> tem plano
 *   - "Não possuo plano"                     -> não tem
 *
 * Ordem de leitura: o campo explícito primeiro (quando vier preenchido), o campo de valor depois.
 * A negação é checada ANTES do número de propósito: "Não possuo plano" não tem dígito, mas uma
 * variante como "não tenho, quero pagar até 500" tem — e ali o 500 é desejo, não plano atual.
 */
export function temPlanoFromLeadForm(
  current: Record<string, unknown> | null | undefined,
): 'sim' | 'nao' | null {
  const src = leadFormSource(current);
  if (!src) return null;

  const NEGACAO = /\b(n[ãa]o|nao)\b.{0,20}\b(possuo|tenho|possui|tem|plano)\b|\bsem plano\b|\bnenhum\b|\bprimeiro plano\b/i;

  // 1) Campo explícito "Você possuí plano de saúde" — só vale se veio preenchido.
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const key = k.toLowerCase();
    if (!/possu.*plano|tem.*plano/.test(key) || /quanto/.test(key) || /paga/.test(key)) continue;
    if (NEGACAO.test(v)) return 'nao';
    if (/^\s*sim/i.test(v)) return 'sim';
  }

  // 2) Fallback: o campo do VALOR. É ele que chega preenchido no formulário de hoje.
  for (const [k, v] of Object.entries(src)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const key = k.toLowerCase();
    if (!(/quanto.*paga/.test(key) || /mensalidade/.test(key) || /valor.*plano/.test(key))) continue;
    if (NEGACAO.test(v)) return 'nao';
    if (/\d/.test(v)) return 'sim';
  }

  return null;
}

/**
 * Tier PROVISÓRIO computado só do FORMULÁRIO, na CRIAÇÃO do lead (antes da Ana conversar) — pra o
 * card já nascer com selo em vez de "layout antigo sem tier". Reusa o mesmo `classifyTier` da
 * conversa (mesma semântica), alimentado por `cnpjFromLeadForm` + `idadesFromLeadForm` +
 * `valorFromLeadForm`; `vidas` = nº de idades informadas.
 *
 * Só semeia quando dá pra cravar um tier de QUALIDADE (ouro/prata/bronze). Sem dados suficientes
 * (→ `indefinido`) ou sinal de fora do ICP a partir de um form magro (→ `fora_icp`) NÃO grava:
 * é prematuro/arriscado antes da conversa — a Ana/consultor classificam depois. SEMPRE `provisorio:
 * true` (é auto-declarado no anúncio; o motor da conversa recomputa e sobrepõe). Retorna o shape já
 * pronto pra `custom_fields.tier`, ou null (não grava).
 */
export function seedTierFromLeadForm(
  current: Record<string, unknown> | null | undefined,
): { value: Tier; motivos: string[]; provisorio: boolean } | null {
  if (!leadFormSource(current)) return null;
  const temCnpj = cnpjFromLeadForm(current); // 'pme' | null
  const idades = idadesFromLeadForm(current);
  const valor = valorFromLeadForm(current);
  // Vidas: as idades são a fonte mais rica (dão o perfil etário junto), mas o formulário
  // NOVO do Meta (21/08/2026) não pergunta mais idade — pergunta "Quantas vidas". Sem este
  // fallback o tier nasce `indefinido` em todo lead do formulário novo, que foi o que a
  // dona viu como "leads chegando sem categorização" (27/08).
  const vidas = idades.length > 0 ? idades.length : vidasFromLeadForm(current);

  // Nenhum sinal útil no form → não semeia.
  if (!temCnpj && vidas == null && valor == null) return null;

  const r = classifyTier({
    tem_cnpj: temCnpj ?? 'desconhecido',
    vidas,
    idades,
    valor_pago_exato: valor,
    quer_so_cotacao: false,
  });
  if (r.tier === 'indefinido' || r.tier === 'fora_icp') return null;
  return { value: r.tier, motivos: r.motivos, provisorio: true };
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
  // Fallback: se a CONVERSA não estabeleceu o CNPJ, usa o que o lead respondeu no formulário.
  // (A conversa tem precedência — só caímos aqui com tem_cnpj ainda nulo.) Persiste no merged
  // pra ficar consistente no painel e "grudar" na próxima extração.
  if (merged.tem_cnpj == null) {
    const fromForm = cnpjFromLeadForm(current);
    if (fromForm) merged.tem_cnpj = fromForm;
  }
  // Fallback (idem CNPJ): idades/vidas/valor do FORMULÁRIO quando a conversa ainda não os
  // estabeleceu. Sem isso, o tier semeado no intake era RECOMPUTADO p/ 'indefinido' assim que o
  // lead respondia algo sem qualificação (vidas ficava null → guard do classifyTier). A conversa
  // tem precedência (só caímos aqui com o campo nulo/vazio); persiste no merged pra "grudar".
  if (!Array.isArray(merged.idades) || (merged.idades as unknown[]).length === 0) {
    const idadesForm = idadesFromLeadForm(current);
    if (idadesForm.length) {
      merged.idades = idadesForm;
      if (merged.vidas == null) merged.vidas = idadesForm.length; // nº de idades = proxy de vidas
    }
  }
  // Vidas pelo campo DIRETO do formulário novo ("Quantas vidas... 4_vidas"). Vem depois das
  // idades de propósito: quando o lead informou as idades, elas são a fonte mais rica (dão
  // vidas E perfil etário). Este fallback é o que faz o tier nascer nos leads do formulário
  // de 21/08 em diante, que não perguntam mais idade nenhuma.
  if (merged.vidas == null) {
    const vidasForm = vidasFromLeadForm(current);
    if (vidasForm != null) merged.vidas = vidasForm;
  }
  if (merged.valor_pago_exato == null) {
    const valorForm = valorFromLeadForm(current);
    if (valorForm != null) merged.valor_pago_exato = valorForm;
  }
  customFields.qualificacao = merged;

  // 2. Objeções (acumula estruturado {categoria,detalhe,origem} + dedupe por categoria;
  //    tolera formato antigo string[] convertendo pra categoria 'outro').
  //    LIMITAÇÃO CONHECIDA (revisão 13/07, aceita): um deal legado com string
  //    (ex.: 'achou caro') pode exibir a MESMA objeção 2x no painel — o chip
  //    'outro: achou caro' + a re-classificação do Gemini ('sem_oportunidade').
  //    É limitado (estabiliza em 2, não cresce) e só cosmético; o fix real
  //    seria backfill único da base — não vale o risco agora.
  if (Array.isArray(ext.objecoes) && ext.objecoes.length) {
    const prev = Array.isArray(customFields.objecoes)
      ? (customFields.objecoes as unknown[]).map((o) =>
          typeof o === 'string'
            ? { categoria: 'outro' as MotivoTag, detalhe: o, origem: 'ana' as const }
            : (o as { categoria?: MotivoTag; detalhe?: string | null; origem?: string }),
        )
      : [];
    const prevCats = new Set(prev.map((o) => o?.categoria).filter(Boolean));
    const additions = (ext.objecoes as MotivoTag[])
      .filter((c) => !prevCats.has(c))
      .map((categoria) => ({ categoria, detalhe: null, origem: 'ana' as const }));
    customFields.objecoes = [...prev, ...additions];
  }

  // 2b. "Só quer cotação" — SINAL, não sentença ("tira o poder de matar", 14/08).
  //     Deixou de descartar o lead (ver classifyTier) e passou a aparecer como objeção no
  //     painel + tag no card, pro consultor decidir. Dedup pelo detalhe: a extração relê a
  //     conversa inteira todo turno, então o sinal se repete indefinidamente.
  const querSoCotacao = ext.quer_so_cotacao === true;
  if (querSoCotacao) {
    const atuais = Array.isArray(customFields.objecoes)
      ? (customFields.objecoes as Array<{ detalhe?: string | null }>)
      : [];
    if (!atuais.some((o) => o?.detalhe === OBJECAO_SO_COTACAO)) {
      customFields.objecoes = [
        ...atuais,
        { categoria: 'outro' as MotivoTag, detalhe: OBJECAO_SO_COTACAO, origem: 'ana' as const },
      ];
    }
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

  // Valor "na mesa" = a mensalidade que o lead paga hoje (o que ele quer otimizar). Vai pro
  // deals.value pra aparecer no topo do card e somar no total da coluna do pipeline.
  const dealValue = typeof merged.valor_pago_exato === 'number' ? (merged.valor_pago_exato as number) : null;

  return {
    customFields,
    tier: tierResult.tier,
    dealValue,
    // Não gera tag de tier: o selo COLORIDO do card (derivado de custom_fields.tier)
    // já mostra o tier automaticamente. Uma tag "tier:bronze" além do selo seria
    // informação duplicada. A service ainda remove tags tier:* antigas dos deals.
    // Exceção: `so-cotacao` não é tier — é o sinal de que o lead resistiu ao diagnóstico,
    // visível no card pro consultor decidir se descarta (antes isso descartava sozinho).
    tags: querSoCotacao ? [TAG_SO_COTACAO] : [],
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
