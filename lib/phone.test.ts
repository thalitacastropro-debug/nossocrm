import { describe, expect, it } from 'vitest';
import { brPhoneVariants } from './phone';

/**
 * Regressão do bug do 9º dígito (leva 08-12, item P0.3 do roadmap).
 *
 * O JID do WhatsApp para DDD > 30 costuma vir SEM o 9 do celular, enquanto o
 * formulário do Meta traz COM. Como todo lookup de contato é igualdade exata de
 * `phone`, a mesma pessoa virava dois contatos / dois deals / duas conversas —
 * casos reais: Ruberleide Petry Odahara (DDD 66) e Robson Carlos Alves (DDD 65).
 */
describe('brPhoneVariants', () => {
  it('casa celular COM e SEM o 9 (caso Ruberleide, DDD 66)', () => {
    expect(brPhoneVariants('+5566999176761')).toEqual(
      expect.arrayContaining(['+5566999176761', '+556699176761'])
    );
    expect(brPhoneVariants('+556699176761')).toEqual(
      expect.arrayContaining(['+556699176761', '+5566999176761'])
    );
  });

  it('casa celular COM e SEM o 9 (caso Robson, DDD 65)', () => {
    expect(brPhoneVariants('+5565984271975')).toEqual(
      expect.arrayContaining(['+5565984271975', '+556584271975'])
    );
  });

  it('é simétrico: as duas pontas geram o mesmo conjunto', () => {
    const a = [...brPhoneVariants('+5511987654321')].sort();
    const b = [...brPhoneVariants('+551187654321')].sort();
    expect(a).toEqual(b);
  });

  it('sempre inclui o próprio número e nunca duplica', () => {
    const v = brPhoneVariants('+5566999176761');
    expect(v).toContain('+5566999176761');
    expect(new Set(v).size).toBe(v.length);
  });

  it('NÃO inventa variante para telefone FIXO (8 dígitos começando com 2-5)', () => {
    // +55 11 3010-3800 é fixo; virar "+5511930103800" seria um número diferente.
    expect(brPhoneVariants('+551130103800')).toEqual(['+551130103800']);
    expect(brPhoneVariants('+551220926642')).toEqual(['+551220926642']);
  });

  it('NÃO mexe em número de 9 dígitos que não começa com 9', () => {
    // Não existe celular BR de 9 dígitos começando com 8 — não tentar remover.
    expect(brPhoneVariants('+5511812345678')).toEqual(['+5511812345678']);
  });

  it('ignora números que não são +55', () => {
    expect(brPhoneVariants('+14155552671')).toEqual(['+14155552671']);
    expect(brPhoneVariants('+351912345678')).toEqual(['+351912345678']);
  });

  it('tolera entrada vazia/inválida sem quebrar', () => {
    expect(brPhoneVariants('')).toEqual([]);
    expect(brPhoneVariants(null)).toEqual([]);
    expect(brPhoneVariants(undefined)).toEqual([]);
    expect(brPhoneVariants('não é telefone')).toEqual([]);
  });

  it('normaliza entrada suja antes de comparar (espaço, hífen, parênteses)', () => {
    expect(brPhoneVariants('+55 (66) 99917-6761')).toEqual(
      expect.arrayContaining(['+5566999176761', '+556699176761'])
    );
  });
});
