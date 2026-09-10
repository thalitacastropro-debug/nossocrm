/**
 * QUALIFICAÇÃO É PRÉ-CONDIÇÃO DO AGENDAMENTO (decidido em 09/09/2026).
 *
 * Palavra dela: *"como ela vai marcar reunião sem arrancar os dados?"* + *"categorizado é ter a
 * medalha"*. Até aqui o único gate antes de oferecer horário era `fora_icp` — a Ana marcava reunião
 * com lead sem CNPJ conhecido, sem saber quantas vidas, e o consultor recebia um card sem medalha
 * para descobrir tudo na ligação.
 *
 * A régua NÃO é uma lista nova de campos: é o próprio `classifyTier`. Ele já devolve `indefinido`
 * exatamente quando falta dado para cravar a medalha — CNPJ desconhecido, vidas desconhecidas, ou
 * 3+ vidas com valor não-baixo e idades desconhecidas. Duplicar isso numa segunda lista criaria
 * duas verdades que divergem no primeiro ajuste. Medalha (ouro/prata/bronze) = pode agendar.
 *
 * ⚠️ O risco nº 1 aqui é a Ana REPETIR pergunta — o caso Isabella, 5x a mesma pergunta num lead
 * pago. Por isso o gate devolve UM alvo por turno, e o alvo nunca é algo que já se sabe.
 */
import { describe, it, expect } from 'vitest';
import { qualificacaoParaAgendar } from '@/lib/ai/scheduling/qualificacao-gate';

describe('qualificacaoParaAgendar — pode oferecer horário?', () => {
  it('lead recém-chegado, sem nada: bloqueia', () => {
    const r = qualificacaoParaAgendar({});
    expect(r.podeAgendar).toBe(false);
  });

  it('sem CNPJ conhecido: bloqueia e pergunta o CNPJ', () => {
    const r = qualificacaoParaAgendar({ vidas: 3, idades: [40, 38, 10], valor_pago_exato: 3000 });
    expect(r.podeAgendar).toBe(false);
    expect(r.alvo).toBe('tem_cnpj');
  });

  it('sem número de vidas: bloqueia e pergunta as vidas', () => {
    const r = qualificacaoParaAgendar({ tem_cnpj: 'pme' });
    expect(r.podeAgendar).toBe(false);
    expect(r.alvo).toBe('vidas');
  });

  it('3+ vidas e valor alto, mas sem idades: bloqueia e pergunta as idades', () => {
    const r = qualificacaoParaAgendar({ tem_cnpj: 'pme', vidas: 3, valor_pago_exato: 4000 });
    expect(r.podeAgendar).toBe(false);
    expect(r.alvo).toBe('idades');
  });

  it('com a medalha na mão, libera', () => {
    const r = qualificacaoParaAgendar({
      tem_cnpj: 'pme', vidas: 3, idades: [40, 38, 10], valor_pago_exato: 4000,
    });
    expect(r.podeAgendar).toBe(true);
    expect(r.alvo).toBeNull();
    expect(['ouro', 'prata', 'bronze']).toContain(r.tier);
  });

  // Estes dois são a diferença entre usar `classifyTier` e reinventar uma lista de campos.
  it('2 vidas basta para a medalha (bronze), sem exigir idades nem valor', () => {
    const r = qualificacaoParaAgendar({ tem_cnpj: 'pme', vidas: 2 });
    expect(r.podeAgendar).toBe(true);
    expect(r.tier).toBe('bronze');
  });

  it('primeiro plano (sem valor) não fica preso: idades conhecidas dão prata', () => {
    const r = qualificacaoParaAgendar({
      tem_cnpj: 'pme', vidas: 3, idades: [30, 28, 2], tem_plano_atual: 'nao',
    });
    expect(r.podeAgendar).toBe(true);
  });

  it('valor baixo dispensa idades (já é bronze pela régua)', () => {
    const r = qualificacaoParaAgendar({ tem_cnpj: 'pme', vidas: 4, valor_pago_exato: 1200 });
    expect(r.podeAgendar).toBe(true);
  });

  it('fora do ICP não vira pedido de dado — quem barra é o gate de ICP', () => {
    const r = qualificacaoParaAgendar({ tem_cnpj: 'nao_tem', vidas: 3 });
    expect(r.podeAgendar).toBe(false);
    expect(r.alvo).toBeNull();
    expect(r.tier).toBe('fora_icp');
  });
});

describe('o alvo é UM por turno e nunca é algo que já sabemos', () => {
  it('faltando CNPJ e vidas, pede só um dos dois', () => {
    const r = qualificacaoParaAgendar({});
    expect(r.alvo).not.toBeNull();
    expect(typeof r.alvo).toBe('string');
  });

  it('não pede de novo o que já foi respondido', () => {
    // Vidas já conhecidas: o alvo tem que ser outra coisa.
    const r = qualificacaoParaAgendar({ vidas: 3 });
    expect(r.alvo).not.toBe('vidas');
  });

  it('cada alvo vem com a pergunta pronta, em português', () => {
    const r = qualificacaoParaAgendar({ tem_cnpj: 'pme' });
    expect(r.comoPerguntar).toBeTruthy();
    expect(r.comoPerguntar!.length).toBeGreaterThan(10);
  });
});
