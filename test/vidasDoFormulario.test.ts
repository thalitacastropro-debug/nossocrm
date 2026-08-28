import { describe, it, expect } from 'vitest';
import { vidasFromLeadForm, seedTierFromLeadForm } from '@/lib/ai/extraction/domain/niva-health';

/**
 * O FORMULÁRIO MUDOU e o CRM não acompanhou (27/08/2026).
 *
 * O formulário antigo perguntava "Quais as idades das pessoas" — e o CRM derivava as
 * vidas contando as idades (`idadesFromLeadForm`). O formulário novo do Meta ("21.08 FORM
 * VIDEOS", que estreou em 21/08) pergunta **"Quantas vidas você tem para adicionar no
 * plano?"** e responde `4_vidas`. Nenhuma função lia isso, então `vidas` ficava null e o
 * tier caía em `indefinido` com o motivo "Faltam dados essenciais para classificar (CNPJ
 * e/ou número de vidas)" — foi exatamente o que aconteceu com o lead Bruce Mendes.
 *
 * Sem vidas não há categorização; sem categorização o consultor não sabe quem priorizar.
 */
describe('vidasFromLeadForm', () => {
  it('lê o formato do formulário novo ("4_vidas")', () => {
    expect(vidasFromLeadForm({
      lead_form: { fields: { 'Quantas vidas você tem para adicionar no plano?': '4_vidas' } },
    })).toBe(4);
  });

  it('lê variações de escrita ("2 vidas", "3")', () => {
    expect(vidasFromLeadForm({ lead_form: { fields: { 'quantas_vidas': '2 vidas' } } })).toBe(2);
    expect(vidasFromLeadForm({ lead_form: { fields: { 'Número de vidas': '3' } } })).toBe(3);
  });

  it('ignora campo vazio (é como o Make manda hoje) e campo sem número', () => {
    expect(vidasFromLeadForm({ lead_form: { fields: { 'Quantas vidas': '' } } })).toBeNull();
    expect(vidasFromLeadForm({ lead_form: { fields: { 'Quantas vidas': 'não sei' } } })).toBeNull();
  });

  it('NÃO confunde com o campo de idades nem com o de valor', () => {
    expect(vidasFromLeadForm({
      lead_form: { fields: { 'Quais as idades das pessoas': '49,48,26' } },
    })).toBeNull();
    expect(vidasFromLeadForm({
      lead_form: { fields: { 'Quanto você paga atualmente no seu plano': '3200' } },
    })).toBeNull();
  });

  it('recusa número absurdo (erro de digitação não vira 300 vidas)', () => {
    expect(vidasFromLeadForm({ lead_form: { fields: { 'Quantas vidas': '300' } } })).toBeNull();
    expect(vidasFromLeadForm({ lead_form: { fields: { 'Quantas vidas': '0' } } })).toBeNull();
  });

  it('sem formulário nenhum devolve null', () => {
    expect(vidasFromLeadForm(null)).toBeNull();
    expect(vidasFromLeadForm({})).toBeNull();
  });
});


/**
 * O tier PROVISÓRIO semeado na criação do lead — o selo que o card mostra antes de a Ana
 * conversar. Ele depende de vidas; sem ler "Quantas vidas" do formulário novo, todo lead
 * de 21/08 em diante nascia sem selo.
 */
describe('seedTierFromLeadForm — formulário novo (quantas vidas)', () => {
  it('semeia tier com CNPJ + vidas do formulário novo (2 vidas → bronze, sem depender de idade)', () => {
    const tier = seedTierFromLeadForm({
      lead_form: {
        fields: {
          'Você possuí CNPJ ou MEI?': 'sim',
          'Quantas vidas você tem para adicionar no plano?': '2_vidas',
          'Quanto você paga atualmente no seu plano?': '3200',
        },
      },
    });
    expect(tier).not.toBeNull();
    expect(tier!.value).toBe('bronze');
    expect(tier!.provisorio).toBe(true);
  });

  /**
   * LIMITE CONHECIDO, e é de PRODUTO, não de código: com 3+ vidas e valor >= R.000 a
   * régua manda 'indefinido' quando as IDADES são desconhecidas — decisão da dona, com
   * verificação adversarial (as idades é que separam ouro/prata/bronze, e cravar no escuro
   * seria pior). Só que o formulário NOVO do Meta parou de perguntar idade: enquanto ele
   * não voltar a perguntar (ou a régua não afrouxar), esses leads nascem sem selo mesmo
   * com o Make consertado.
   */
  it('3+ vidas sem idades continua indefinido — a régua exige idade (decisão da dona)', () => {
    const tier = seedTierFromLeadForm({
      lead_form: {
        fields: {
          'Você possuí CNPJ ou MEI?': 'sim',
          'Quantas vidas você tem para adicionar no plano?': '4_vidas',
          'Quanto você paga atualmente no seu plano?': '3200',
        },
      },
    });
    expect(tier).toBeNull();
  });

  it('idades continuam tendo precedência sobre o campo de vidas', () => {
    const comIdades = seedTierFromLeadForm({
      lead_form: {
        fields: {
          'Você possuí CNPJ': 'sim',
          'Quais as idades das pessoas': '49,48,26',
          'Quantas vidas': '10_vidas',
          'Quanto você paga': '3200',
        },
      },
    });
    // 3 idades mandam, não as 10 do outro campo — o tier de 10 vidas seria bem diferente.
    expect(comIdades).not.toBeNull();
    expect(comIdades!.motivos.join(' ')).toMatch(/3/);
  });

  it('formulário sem nenhum sinal continua não semeando nada', () => {
    expect(seedTierFromLeadForm({ lead_form: { fields: { 'Quantas vidas': '' } } })).toBeNull();
  });
});
