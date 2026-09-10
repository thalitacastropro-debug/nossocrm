/**
 * @fileoverview O freio de praça sem comercialização, dos dois lados: a lista que reconhece a
 * cidade e o bloco que chega no prompt da Ana.
 *
 * Nasceu do caso Gabriel Fernandes (Ourinhos-SP): em 08/09/2026 a Ana qualificou, ofereceu
 * horário e marcou reunião; em 09/09 o consultor descartou o card com "Não há comercialização na
 * cidade do lead." Lead pago, agenda do consultor ocupada e uma promessa que a Niva não podia
 * cumprir. Não existia gate nenhum de cobertura: `classifyTier` olha CNPJ, vidas, idades e valor,
 * e a cidade só era coletada para INFORMAR o consultor.
 */
import { describe, it, expect } from 'vitest';
import { formatContextForPrompt } from '@/lib/ai/agent/context-builder';
import { pracaSemComercializacao } from '@/lib/config/pracas-sem-comercializacao';
import type { LeadContext } from '@/lib/ai/agent/types';

/** Contexto mínimo — só o que o formatador precisa para não quebrar. */
function contextoBase(): LeadContext {
  return {
    contact: { name: 'Gabriel Fernandes', email: null, phone: null, company: null, position: null },
    stage: { id: 's1', name: 'Em Qualificação', goal: null, advancement_criteria: [] },
    stats: { ai_messages_count: 1 },
    messages: [],
  } as unknown as LeadContext;
}

describe('praça sem comercialização chega no prompt da Ana', () => {
  it('sem praça bloqueada, nenhum aviso entra no prompt', () => {
    const texto = formatContextForPrompt(contextoBase());
    expect(texto).not.toContain('NÃO HÁ COMERCIALIZAÇÃO');
  });

  it('com praça bloqueada, a Ana é proibida de oferecer horário e recebe o que dizer', () => {
    const praca = pracaSemComercializacao('Ourinhos-SP')!;
    const ctx = {
      ...contextoBase(),
      praca_sem_comercializacao: { praca: praca.praca, uf: praca.uf, saida: praca.saida },
    };
    const texto = formatContextForPrompt(ctx);

    expect(texto).toContain('NÃO HÁ COMERCIALIZAÇÃO NA CIDADE DESTE LEAD');
    expect(texto).toContain('Ourinhos/SP');
    expect(texto).toContain('NÃO ofereça horário');
    // O consultor não tem o que fazer aqui: prometer retorno é adiar a mesma frustração.
    expect(texto).toContain('NÃO diga que um consultor vai retornar');
    // A saída REAL para o lead, vinda da configuração e não da imaginação do modelo.
    expect(texto).toContain('plano regional');
  });
});

/**
 * O bloco "O QUE AINDA FALTA" no prompt da Ana.
 *
 * Existe porque `classifyTier` sempre soube o que faltava (`motivos: ['faltam as idades para
 * classificar com segurança']`) e isso NUNCA era impresso — o contexto só tinha o espelho positivo,
 * "O QUE JÁ SABEMOS". A instrução para perguntar tudo já existia no `stage_ai_config`: o que faltava
 * não era instrução, era verificação.
 */
describe('bloco de qualificação pendente', () => {
  it('sem pendência, o prompt não ganha bloco nenhum', () => {
    const texto = formatContextForPrompt(contextoBase());
    expect(texto).not.toContain('O QUE AINDA FALTA');
  });

  it('com pendência, proíbe oferecer horário e pede UMA coisa', () => {
    const ctx = {
      ...contextoBase(),
      qualificacao_pendente: { alvo: 'idades', comoPerguntar: 'a idade de cada uma das pessoas que entram' },
    };
    const texto = formatContextForPrompt(ctx);
    expect(texto).toContain('O QUE AINDA FALTA');
    expect(texto).toContain('a idade de cada uma das pessoas que entram');
    expect(texto).toContain('NÃO ofereça horário');
    expect(texto).toMatch(/UMA coisa só|uma coisa só/i);
  });

  // A trava contra o caso Isabella: o pedido tem que vir DEPOIS do que já sabemos, para o modelo
  // ler primeiro a lista do que não pode reperguntar.
  it('o pedido vem depois do bloco "O QUE JÁ SABEMOS"', () => {
    const ctx = {
      ...contextoBase(),
      qualificacao: { vidas: 3, cidade_uf: 'São Paulo' },
      qualificacao_pendente: { alvo: 'idades', comoPerguntar: 'a idade de cada uma das pessoas que entram' },
    };
    const texto = formatContextForPrompt(ctx);
    expect(texto.indexOf('O QUE JÁ SABEMOS')).toBeLessThan(texto.indexOf('O QUE AINDA FALTA'));
    expect(texto).toContain('Vidas: 3');
  });
});
