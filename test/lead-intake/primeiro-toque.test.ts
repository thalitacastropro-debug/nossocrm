/**
 * @fileoverview O 1º toque não pode se contradizer nem soar a robô.
 *
 * Casos REAIS de 31/08/2026, os dois em lead pago vindo de anúncio:
 *
 * - **Pablo** — a Ana escreveu "você informou que paga mais de R$ 3.500 hoje" e,
 *   na bolha seguinte, "primeiro, você já tem algum plano de saúde no momento?".
 *   Duas afirmações se contradizendo. A raiz: o campo explícito
 *   "Você possuí plano de saúde" chega VAZIO (o Make ainda manda os campos do
 *   formulário antigo em branco), então o modelo achou que faltava — quando quem
 *   respondia era o campo do VALOR.
 *
 * - **RoseMeiguins** — "me conta, você tem CNPJ ou seria pra abrir como MEI?".
 *   Travessão no texto (marca de IA) + oferta de abrir empresa na primeira
 *   mensagem, que a Thalita vetou: na abertura pergunta-se só SE tem CNPJ.
 */

import { describe, it, expect } from 'vitest';
import { proximaPergunta } from '@/lib/ai/lead-intake/first-touch';
import { temPlanoFromLeadForm } from '@/lib/ai/extraction/domain/niva-health';
import { stripDashTells } from '@/lib/ai/text/dashes';

/** Formulário do Pablo, como está no banco (campos antigos vazios). */
const FORM_PABLO = {
  lead_form: {
    fields: {
      anuncio: '120249748895100451',
      campanha: '',
      conjunto: '120249748895100451',
      'Você possuí CNPJ': '',
      'Qual o número do seu CNPJ': '',
      'Quais as idades das pessoas': '',
      'Você possuí plano de saúde': '',
      'Quanto você paga atualmente no seu plano': 'Mais de R$ 3500',
    },
  },
};

/** Formulário da RoseMeiguins — mesma estrutura, sem plano. */
const FORM_ROSE = {
  lead_form: {
    fields: {
      ...FORM_PABLO.lead_form.fields,
      'Quanto você paga atualmente no seu plano': 'Não possuo plano',
    },
  },
};

describe('temPlanoFromLeadForm', () => {
  it('deduz "sim" do valor pago, mesmo com o campo explícito vazio (caso Pablo)', () => {
    expect(temPlanoFromLeadForm(FORM_PABLO)).toBe('sim');
  });

  it('deduz "nao" de "Não possuo plano" (caso Rose)', () => {
    expect(temPlanoFromLeadForm(FORM_ROSE)).toBe('nao');
  });

  it('o campo explícito preenchido tem precedência sobre o do valor', () => {
    const form = {
      lead_form: {
        fields: {
          'Você possuí plano de saúde': 'Não possuo',
          'Quanto você paga atualmente no seu plano': '2500',
        },
      },
    };
    expect(temPlanoFromLeadForm(form)).toBe('nao');
  });

  it('não inventa resposta quando o formulário está mudo', () => {
    expect(temPlanoFromLeadForm({ lead_form: { fields: { anuncio: '123' } } })).toBeNull();
    expect(temPlanoFromLeadForm(null)).toBeNull();
  });

  it('negação com número no texto continua sendo "nao" (o número ali é desejo, não plano)', () => {
    const form = {
      lead_form: { fields: { 'Quanto você paga atualmente no seu plano': 'não tenho, queria pagar até 500' } },
    };
    expect(temPlanoFromLeadForm(form)).toBe('nao');
  });
});

describe('proximaPergunta', () => {
  it('quem paga R$3.500 NÃO é perguntado se tem plano — é perguntado QUAL é (caso Pablo)', () => {
    const p = proximaPergunta(FORM_PABLO);
    expect(p).toContain('operadora');
    expect(p).not.toMatch(/já tem plano/i);
  });

  it('sem plano, segue a escada: quantas pessoas entram', () => {
    expect(proximaPergunta(FORM_ROSE)).toContain('pessoas');
  });

  it('nunca manda oferecer MEI — nem na pergunta de CNPJ (caso Rose)', () => {
    const formSoFaltaCnpj = {
      lead_form: {
        fields: {
          'Quanto você paga atualmente no seu plano': 'Não possuo plano',
          'Quantas vidas você tem para adicionar no plano': '3_vidas',
        },
      },
    };
    const p = proximaPergunta(formSoFaltaCnpj);
    expect(p).toContain('CNPJ');
    // A instrução carrega a proibição explícita para o modelo.
    expect(p).toMatch(/NÃO fale em abrir MEI/);
  });

  it('formulário mudo abre pela primeira pergunta da escada', () => {
    expect(proximaPergunta({})).toMatch(/já tem plano/i);
  });
});

describe('stripDashTells no opener', () => {
  it('mata os travessões exatos que saíram para o Pablo e a Rose', () => {
    expect(stripDashTells('Você informou que paga mais de R$ 3.500 hoje — vamos ver se melhora'))
      .toBe('Você informou que paga mais de R$ 3.500 hoje, vamos ver se melhora');
    expect(stripDashTells('Pra eu adiantar seu caso pro consultor, me conta — você tem CNPJ?'))
      .toBe('Pra eu adiantar seu caso pro consultor, me conta, você tem CNPJ?');
  });

  it('não estraga hífen de data nem de palavra composta', () => {
    expect(stripDashTells('dia 13-07, bem-estar')).toBe('dia 13-07, bem-estar');
  });
});
