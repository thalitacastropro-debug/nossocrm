/**
 * @fileoverview Output Validator for AI Agent
 *
 * Validates LLM-generated responses before sending to leads via WhatsApp/Instagram.
 * Checks for: system prompt leakage, PII exposure, excessive length, and safety issues.
 *
 * @module lib/ai/agent/output-validator
 */

import type { LeadContext } from './types';
import { logStructured } from './structured-logger';

// =============================================================================
// Constants
// =============================================================================

/** WhatsApp message character limit */
const MAX_RESPONSE_LENGTH = 4096;

/**
 * Texto enviado quando a resposta gerada é bloqueada.
 *
 * PRECISA ser uma PONTE, nunca uma despedida. Até 26/08/2026 esta constante era
 * *"Obrigado pelo contato! Nossa equipe retornará em breve."* — uma frase de encerramento.
 * Ela disparou 6× em 5 conversas de lead PAGO desde 28/07 e, em 2 delas, a conversa
 * acabou exatamente ali (Ana Paula Trivino 09/08 e Domingos 04/08): o lead entendeu que
 * tinha sido despachado, e ninguém no time ficou sabendo.
 *
 * A ponte segura o lead no mesmo canal, com a mesma pessoa (a Ana), e a próxima mensagem
 * dele reentra no fluxo normal. O alarme para o time sai em `agent.service`.
 */
export const BLOCKED_OUTPUT_BRIDGE = 'Deixa eu confirmar uma informação aqui e já te respondo.';

// =============================================================================
// Leakage Detection Patterns
// =============================================================================

/**
 * Patterns that suggest the LLM leaked its system prompt or revealed it is an AI.
 * These catch common phrasings in Portuguese and English.
 */
const LEAKAGE_PATTERNS: Array<[RegExp, string]> = [
  // System prompt leakage
  [/minha[s]?\s+(instrução|instruções|regra|regras|diretiva|prompt)\s+(é|são|diz|dizem)/iu, 'leaked_instructions_pt'],
  [/my\s+(instructions?|rules?|directives?|prompt)\s+(is|are|says?|tells?)/iu, 'leaked_instructions_en'],
  [/fui\s+(programado|configurado|instruído)\s+(para|a)\s/iu, 'revealed_programming_pt'],
  [/i\s+(was|am)\s+(programmed|configured|instructed)\s+to\s/iu, 'revealed_programming_en'],
  [/como\s+(uma?\s+)?(IA|inteligência\s+artificial|modelo\s+de\s+linguagem|LLM|chatbot|assistente\s+virtual)/iu, 'revealed_ai_identity_pt'],
  [/as\s+an?\s+(AI|artificial\s+intelligence|language\s+model|LLM|chatbot|virtual\s+assistant)/iu, 'revealed_ai_identity_en'],
  [/sou\s+(uma?\s+)?(IA|inteligência\s+artificial|robô|bot|modelo|programa)/iu, 'declared_ai_pt'],
  [/i\s+am\s+an?\s+(AI|artificial\s+intelligence|robot|bot|model|program)/iu, 'declared_ai_en'],
  [/não\s+(sou|tenho)\s+(humano|pessoa|sentimentos)/iu, 'denied_humanity_pt'],

  // Prompt/instruction dump (detects blocks of rules being repeated)
  [/REGRA[S]?\s+(IMPORTANTE|DE\s+SEGURANÇA)[S]?.*:/iu, 'rules_dump_pt'],
  [/(IMPORTANT|SECURITY)\s+RULES?.*:/iu, 'rules_dump_en'],
  [/INSTRUÇÃO\s+ESPECÍFICA.*:/iu, 'instruction_dump_pt'],
];

/**
 * NARRAÇÃO INTERNA — a Ana falando SOBRE a conversa em vez de dentro dela.
 *
 * Categoria diferente do vazamento de prompt acima: aqui ela não revela regra nem diz que é IA.
 * Ela **pensa em voz alta e o pensamento vira bolha no WhatsApp do lead**. Nenhum dos padrões de
 * cima pega, porque o texto não tem nada de "sistema" — é português normal, só que endereçado à
 * pessoa errada.
 *
 * Os 3 incidentes reais, achados varrendo as 1726 mensagens que a Ana já enviou:
 *
 *  - 16/08, Richard Gois (duas bolhas seguidas):
 *      "No momento, você já fez a pergunta de abertura (...) e o lead respondeu apenas com 'Olá'"
 *      "Relance a pergunta de forma leve e direta, sem repetir a introdução:"
 *  - 21/09, Brooksfield: "Sem resposta ainda do lead sobre a imagem. Vou reengajar retomando de
 *    onde parou:"
 *  - 28/09, Regina Balbino: "Aqui está o follow-up:"
 *
 * ## Os padrões saíram do corpus, não da imaginação
 *
 * Cada regex abaixo foi medida contra as 1726 mensagens antes de entrar. As quatro juntas casam
 * exatamente as 4 bolhas acima e NENHUMA outra — zero falso positivo no histórico inteiro.
 *
 * ⚠️ O que FICOU DE FORA e por quê: `de onde paramos` parecia ótimo (está no vazamento do
 * Brooksfield) e casaria 5 mensagens — 3 delas legítimas, do tipo *"Lay, ainda por aí? Podemos
 * continuar de onde paramos."*, que é follow-up correto. Padrão que pega o bug e mata a conversa
 * boa não entra.
 *
 * ## Sobre o dois-pontos no fim
 *
 * É o mais largo dos quatro e o que mais rende: sozinho pegou 3 dos 4 casos, inclusive os dois que
 * ninguém tinha achado. A razão é que mensagem de verdade para uma pessoa não termina em ":" —
 * quem anuncia "aqui está:" está entregando resultado a um sistema, não conversando. Se um dia a
 * Ana quiser abrir uma lista assim, ela cai na ponte e o time recebe o alarme: falha MACIA e
 * VISÍVEL, que é o oposto do problema que estamos consertando aqui.
 */
const NARRACAO_INTERNA: Array<[RegExp, string]> = [
  // Ela nunca chama a pessoa de "lead" — quem faz isso está falando DO lead, não COM ele.
  [/\blead(s|es)?\b/iu, 'narracao:fala_do_lead_em_terceira_pessoa'],
  // Anunciou e não entregou: o conteúdo ficou do outro lado dos dois-pontos.
  [/:\s*$/u, 'narracao:anuncia_e_nao_entrega'],
  // Rótulo de saída — endereçado a quem PEDIU o texto, não a quem vai ler.
  //
  // Dois formatos, e os dois exigem os dois-pontos: "aqui está" solto é conversa normal.
  // ⚠️ O rótulo seco ("Resposta:", "Mensagem:") pede dois-pontos COLADO, de propósito. Escrevi
  // primeiro como "rótulo + até 40 caracteres + dois-pontos" e isso passou a casar
  // "Resposta RAG: produto X resolve seu problema." — frase que não estava no corpus que eu medi.
  // Foi alargamento meu depois da medição, e quebrou um teste que existia. Padrão só vale na
  // forma em que foi medido.
  [/^\s*(aqui\s+est[áa]|segue\s+(o|a))\b[^:\n]{0,40}:/iu, 'narracao:rotulo_de_saida'],
  [/^\s*(resposta|mensagem|sa[íi]da)\s*:/iu, 'narracao:rotulo_seco'],
];

/*
 * ⚠️ O QUE EU TIREI DAQUI, e por que a lista é curta de propósito.
 *
 * A primeira versão tinha um quinto padrão, para imperativo dirigido a si mesma:
 *   /^\s*(relance|reformule|retome|prossiga|pergunte|responda|confirme|evite|mantenha)\b/
 *
 * Ele saiu por duas razões que só aparecem quando se mede:
 *
 * 1. RECALL ZERO. O único caso real que ele pegava — "Relance a pergunta de forma leve e direta,
 *    sem repetir a introdução:" — termina em dois-pontos e já cai no padrão de cima. Ele não
 *    acrescentava captura nenhuma.
 * 2. RISCO ALTO. "Confirme se entendi certo: são 5 vidas?" e "Responda quando puder" são frases
 *    que a Ana diz PARA o lead, e as duas seriam bloqueadas. Trocar mensagem boa por ponte, numa
 *    conversa de lead pago, custa mais caro que o vazamento que ele não pegava.
 *
 * Padrão que não aumenta captura e aumenta falso positivo é prejuízo líquido. A régua para
 * acrescentar o próximo é a mesma: medir contra o histórico antes, não depois.
 */

// =============================================================================
// PII Detection
// =============================================================================

/**
 * Check if the response exposes PII from the lead context verbatim.
 * We only flag PII that comes from the CONTEXT (not from what the lead themselves sent).
 * E.g., if the AI response repeats the lead's email from context, that's a leak.
 *
 * Escopo: identidade de contato (e-mail e telefone). Ver a nota longa no fim da função sobre
 * por que `deal.value` NÃO entra aqui.
 */
function detectPIILeak(
  response: string,
  context: LeadContext
): string[] {
  const leaks: string[] = [];

  const contact = context.contact;
  if (!contact) return leaks;

  // Check email leak (only if present in context)
  if (contact.email) {
    // Exact match of email in response
    if (response.toLowerCase().includes(contact.email.toLowerCase())) {
      leaks.push(`email:${maskPII(contact.email)}`);
    }
  }

  // Check phone leak (normalize both for comparison)
  if (contact.phone) {
    const normalizedPhone = contact.phone.replace(/[\s\-\(\)+]/g, '');
    const normalizedResponse = response.replace(/[\s\-\(\)+]/g, '');
    // Only flag if the full phone number (7+ digits) appears
    if (normalizedPhone.length >= 7 && normalizedResponse.includes(normalizedPhone)) {
      leaks.push(`phone:${maskPII(contact.phone)}`);
    }
  }

  // NÃO existe checagem de `deal.value` aqui — de propósito.
  //
  // Havia uma, com `response.includes(valor)` (substring cru, sem limite de palavra), e ela era a
  // causa real do fallback que matava lead pago. Nesta operação a extração grava em `deals.value`
  // a MENSALIDADE QUE O LEAD PAGA — número que ele mesmo acabou de escrever no WhatsApp e em torno
  // do qual gira a qualificação inteira. Ou seja: o dado não vem do CRM para o lead, vem do lead
  // para o CRM. Repetir "R$ 500" para quem disse "pago 500" não é vazamento, é conversa.
  //
  // Efeito medido no banco em 26/08/2026: nos 6 disparos do fallback (Daniel 500, Richard 350,
  // Ana Paula 750, Domingos 715, Lilian 990), `deal.value` tinha 3 dígitos e a Ana estava
  // recapitulando o valor. A primeira vez que ela repetia o número depois da extração gravar o
  // campo, a mensagem inteira era descartada. Além disso o `includes` casava "500" dentro de
  // "1500" e "R$ 5.500".
  //
  // Se um dia for preciso proteger um valor que o lead NÃO conhece (proposta, comissão), isso é
  // outro campo e outra checagem — não `deal.value`.

  return leaks;
}

/**
 * Mask PII for logging — show only first 3 chars.
 */
function maskPII(value: string): string {
  if (value.length <= 3) return '***';
  return value.substring(0, 3) + '***';
}

// =============================================================================
// Public API
// =============================================================================

export interface ValidationResult {
  /** Whether the response passed all safety checks */
  safe: boolean;
  /** The response to use (original if safe, fallback if not) */
  response: string;
  /** Reasons the response was flagged (empty if safe) */
  issues: string[];
}

/**
 * Validates an AI-generated response before it is sent to a lead.
 *
 * Checks:
 * 1. System prompt / AI identity leakage
 * 2. Maximum length (WhatsApp limit)
 * 3. PII de contato (e-mail/telefone) do contexto aparecendo verbatim na resposta
 * 4. Empty or nonsensical response
 *
 * @param response  Raw LLM output text
 * @param context   Lead context used to generate the response (for PII check)
 * @param meta      Optional metadata for structured logging
 * @returns         Validation result with safe flag and usable response
 */
export function validateAIOutput(
  response: string,
  context: LeadContext,
  meta?: { org_id?: string; conversation_id?: string }
): ValidationResult {
  const issues: string[] = [];

  // Check 0: Empty or whitespace-only
  if (!response || response.trim().length === 0) {
    issues.push('empty_response');
    return logAndReturn(issues, BLOCKED_OUTPUT_BRIDGE, meta);
  }

  // Check 1: System prompt / AI identity leakage
  for (const [pattern, label] of LEAKAGE_PATTERNS) {
    if (pattern.test(response)) {
      issues.push(`leakage:${label}`);
    }
  }

  // Check 1b: narração interna — ela pensando em voz alta na bolha do lead
  for (const [pattern, label] of NARRACAO_INTERNA) {
    if (pattern.test(response)) {
      issues.push(label);
    }
  }

  // Check 2: Length limit
  if (response.length > MAX_RESPONSE_LENGTH) {
    issues.push(`length_exceeded:${response.length}/${MAX_RESPONSE_LENGTH}`);
  }

  // Check 3: PII de CONTATO vinda do contexto (e-mail/telefone) — nunca o valor do deal
  const piiLeaks = detectPIILeak(response, context);
  if (piiLeaks.length > 0) {
    issues.push(...piiLeaks.map((l) => `pii_leak:${l}`));
  }

  // Decisão: qualquer problema → NÃO envia o texto gerado. Manda a ponte e devolve safe:false,
  // que é o gatilho do alarme em agent.service (Telegram + nota na timeline). Bloqueio silencioso
  // foi o que deixou 6 respostas morrerem sem ninguém ver.
  if (issues.length > 0) {
    return logAndReturn(issues, BLOCKED_OUTPUT_BRIDGE, meta);
  }

  return { safe: true, response, issues: [] };
}

// =============================================================================
// Internal
// =============================================================================

function logAndReturn(
  issues: string[],
  fallback: string,
  meta?: { org_id?: string; conversation_id?: string }
): ValidationResult {
  logStructured({
    event: 'ai.output_validator.unsafe_response',
    org_id: meta?.org_id,
    conversation_id: meta?.conversation_id,
    issues,
    fallback_used: true,
  });

  return { safe: false, response: fallback, issues };
}
