import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Regra do produto: padronizar telefones em E.164.
 *
 * - Aceita entrada “solta” (com espaços, parênteses, hífen etc.)
 * - Tenta normalizar usando `defaultCountry` quando não houver prefixo +
 * - Retorna string E.164 (ex.: +5511999990000) ou '' quando vazio
 *
 * Observação:
 * - Se a string já estiver em E.164 válido, retorna como está.
 * - Se não for possível parsear/validar, retorna uma versão “sanitizada”
 *   (mantendo + e dígitos) apenas se parecer E.164; caso contrário, retorna o input trimado.
 */
export function normalizePhoneE164(
  input?: string | null,
  opts?: {
    defaultCountry?: CountryCode;
  }
): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';

  // Atalho: já está em E.164?
  const e164Candidate = raw.replace(/[\s\-()]/g, '');
  if (isE164(e164Candidate)) return e164Candidate;

  const defaultCountry = opts?.defaultCountry ?? 'BR';

  // Parse com fallback de país; funciona bem para inputs sem + (ex.: (11) 99999-0000)
  const phone = parsePhoneNumberFromString(raw, defaultCountry);
  if (phone?.isValid()) return phone.number; // E.164

  // Fallback: mantém somente + e dígitos. Se ficar com cara de E.164, retorna.
  const sanitized = raw.replace(/[^\d+]/g, '');
  if (isE164(sanitized)) return sanitized;

  // Último fallback: devolve o que o usuário tem (evita apagar dado), mas o objetivo
  // é que o sistema normalize na entrada e não chegue aqui com frequência.
  return raw;
}

/**
 * Função pública `isE164` do projeto.
 *
 * @param {string | null | undefined} input - Parâmetro `input`.
 * @returns {boolean} Retorna um valor do tipo `boolean`.
 */
export function isE164(input?: string | null): boolean {
  const value = (input ?? '').trim();
  return /^\+[1-9]\d{1,14}$/.test(value);
}

/**
 * Formas EQUIVALENTES de um celular brasileiro, por causa do 9º dígito.
 *
 * O Brasil acrescentou um 9 na frente dos celulares (2012–2016), mas o JID do
 * WhatsApp para DDD > 30 continua chegando SEM ele, enquanto o formulário do
 * Meta traz COM. Como todo lookup de contato é igualdade exata de `phone`, a
 * mesma pessoa virava DOIS contatos / DOIS deals / DUAS conversas — a Ana
 * atendia num card sem enxergar o formulário (que estava no outro) e a cadência
 * de follow-up rodava sozinha no card órfão. Casos reais: Ruberleide Petry
 * Odahara (DDD 66) e Robson Carlos Alves (DDD 65). Ver roadmap §P0.3.
 *
 * Use no LOOKUP (`.in('phone', brPhoneVariants(x))`), nunca na GRAVAÇÃO: o que
 * se persiste continua sendo o E.164 que chegou.
 *
 * Fixo NÃO ganha variante — 8 dígitos começando em 2–5 é linha fixa, e
 * acrescentar o 9 produziria um número de outra pessoa.
 *
 * @param input Telefone em qualquer formato (E.164, sujo, com máscara).
 * @returns Lista com o próprio número e a variante equivalente, quando existir.
 *          `[]` se a entrada não for um telefone reconhecível.
 */
export function brPhoneVariants(input?: string | null): string[] {
  const e164 = normalizePhoneE164(input);
  if (!isE164(e164)) return [];

  const variants = [e164];

  const br = e164.match(/^\+55(\d{2})(\d{8,9})$/);
  if (!br) return variants; // não é BR (ou tem tamanho fora do padrão): sem variante

  const [, ddd, subscriber] = br;

  if (subscriber.length === 9) {
    // Celular com o 9 → gera a forma antiga (como o WhatsApp costuma mandar).
    // Só remove um 9 de verdade: não existe celular de 9 dígitos começando com outro dígito.
    if (subscriber.startsWith('9')) variants.push(`+55${ddd}${subscriber.slice(1)}`);
  } else if (/^[6-9]/.test(subscriber)) {
    // 8 dígitos começando em 6–9 = celular no formato antigo → gera a forma com o 9.
    variants.push(`+55${ddd}9${subscriber}`);
  }

  return variants;
}

/**
 * Para WhatsApp (wa.me) normalmente usamos somente dígitos (sem '+').
 * Retorna '' se não houver número.
 */
export function toWhatsAppPhone(input?: string | null, opts?: { defaultCountry?: CountryCode }): string {
  const e164 = normalizePhoneE164(input, opts);
  if (!e164) return '';
  return e164.replace(/^\+/, '');
}
