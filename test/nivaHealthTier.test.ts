import { describe, it, expect } from 'vitest';
import {
  classifyTier,
  cnpjFromLeadForm,
  idadesFromLeadForm,
  valorFromLeadForm,
  seedTierFromLeadForm,
  nivaHealthExtractor,
  type NivaHealthExtraction,
} from '@/lib/ai/extraction/domain/niva-health';

type ClassifyInput = Parameters<typeof classifyTier>[0];

// Perfil ouro de referência: PME, 3 vidas jovens, paga R$6.000.
const base: ClassifyInput = {
  tem_cnpj: 'pme',
  vidas: 3,
  idades: [30, 35, 40],
  valor_pago_exato: 6000,
  quer_so_cotacao: false,
};

describe('classifyTier (§10.1)', () => {
  // --- Gates → fora do ICP ---
  it('fora_icp: só quer cotação', () => {
    expect(classifyTier({ ...base, quer_so_cotacao: true }).tier).toBe('fora_icp');
  });
  it('fora_icp: sem CNPJ e não quer MEI', () => {
    expect(classifyTier({ ...base, tem_cnpj: 'nao_tem' }).tier).toBe('fora_icp');
  });
  it('fora_icp: 1 vida (individual)', () => {
    expect(classifyTier({ ...base, vidas: 1, idades: [30] }).tier).toBe('fora_icp');
  });
  it('gate de cotação tem precedência sobre os demais', () => {
    expect(
      classifyTier({ ...base, quer_so_cotacao: true, tem_cnpj: 'nao_tem', vidas: 1 }).tier,
    ).toBe('fora_icp');
  });

  // --- Indefinido (provisório) ---
  it('indefinido: CNPJ desconhecido', () => {
    const r = classifyTier({ ...base, tem_cnpj: 'desconhecido' });
    expect(r.tier).toBe('indefinido');
    expect(r.provisorio).toBe(true);
  });
  it('indefinido: número de vidas desconhecido', () => {
    expect(classifyTier({ ...base, vidas: null, idades: [] }).tier).toBe('indefinido');
  });

  // --- Ouro ---
  it('ouro: 3+ vidas, todos ≤67, valor exatamente 5000', () => {
    const r = classifyTier({ ...base, valor_pago_exato: 5000 });
    expect(r.tier).toBe('ouro');
    expect(r.provisorio).toBe(false);
  });
  it('ouro: valor bem acima de 5000', () => {
    expect(classifyTier({ ...base, valor_pago_exato: 12000 }).tier).toBe('ouro');
  });
  it('ouro: idade exatamente 67 conta como ≤67', () => {
    expect(classifyTier({ ...base, idades: [67, 40, 30], valor_pago_exato: 8000 }).tier).toBe('ouro');
  });
  it('MEI conta como CNPJ válido', () => {
    expect(classifyTier({ ...base, tem_cnpj: 'mei', valor_pago_exato: 7000 }).tier).toBe('ouro');
  });
  it('vai_abrir_mei conta como CNPJ válido', () => {
    expect(classifyTier({ ...base, tem_cnpj: 'vai_abrir_mei', valor_pago_exato: 7000 }).tier).toBe('ouro');
  });

  // --- Prata ---
  it('prata: 3+ vidas, valor 2000-4999', () => {
    expect(classifyTier({ ...base, valor_pago_exato: 3000 }).tier).toBe('prata');
  });
  it('prata: valor exatamente 2000', () => {
    expect(classifyTier({ ...base, valor_pago_exato: 2000 }).tier).toBe('prata');
  });
  it('prata: valor exatamente 4999', () => {
    expect(classifyTier({ ...base, valor_pago_exato: 4999 }).tier).toBe('prata');
  });
  it('prata: perfil ouro mas 1 vida >67 (não maioria)', () => {
    expect(classifyTier({ ...base, idades: [70, 40, 30], valor_pago_exato: 8000 }).tier).toBe('prata');
  });
  it('prata: primeiro plano (sem valor), 3+ vidas, todos ≤67 — provisório', () => {
    const r = classifyTier({ ...base, valor_pago_exato: null, idades: [30, 40, 50] });
    expect(r.tier).toBe('prata');
    expect(r.provisorio).toBe(true);
  });

  // --- Bronze ---
  it('bronze: 2 vidas mesmo pagando alto', () => {
    expect(classifyTier({ ...base, vidas: 2, idades: [30, 35], valor_pago_exato: 9000 }).tier).toBe('bronze');
  });
  it('bronze: 3+ vidas, valor < 2000', () => {
    expect(classifyTier({ ...base, valor_pago_exato: 1500 }).tier).toBe('bronze');
  });
  it('bronze: valor exatamente 1999', () => {
    expect(classifyTier({ ...base, valor_pago_exato: 1999 }).tier).toBe('bronze');
  });
  it('bronze: maioria das vidas >67 mesmo com valor alto', () => {
    expect(classifyTier({ ...base, idades: [70, 72, 40], valor_pago_exato: 8000 }).tier).toBe('bronze');
  });
  it('bronze: maioria >67 e primeiro plano (sem valor)', () => {
    expect(classifyTier({ ...base, idades: [70, 72, 68], valor_pago_exato: null }).tier).toBe('bronze');
  });

  // --- provisório ---
  it('ouro nunca é provisório', () => {
    expect(classifyTier({ ...base, valor_pago_exato: 6000 }).provisorio).toBe(false);
  });
  it('indefinido quando faltam idades e o valor não fixa o tier (decisão da dona)', () => {
    const r = classifyTier({ ...base, idades: [], valor_pago_exato: 8000 });
    expect(r.tier).toBe('indefinido');
    expect(r.provisorio).toBe(true);
  });
  it('bronze quando faltam idades mas o valor é baixo (idades não mudam o resultado)', () => {
    expect(classifyTier({ ...base, idades: [], valor_pago_exato: 1500 }).tier).toBe('bronze');
  });
});

const fullExt: NivaHealthExtraction = {
  tem_cnpj: 'pme',
  vidas: 3,
  idades: [30, 35, 40],
  tem_plano_atual: 'sim',
  operadora: 'Amil',
  valor_pago_exato: 6000,
  coparticipacao: 'sem',
  hospital_preferencia: 'Sírio',
  cidade_uf: 'SP',
  reuniao_preferencia: 'terça de manhã',
  algo_a_destacar: null,
  objecoes: ['sem_oportunidade'],
  quer_so_cotacao: false,
  overallConfidence: 0.9,
};

describe('nivaHealthExtractor.apply', () => {
  it('grava tier ouro + priority high; NÃO gera tag de tier (o selo colorido já mostra); lossReason null', () => {
    const r = nivaHealthExtractor.apply({}, fullExt);
    expect(r.tier).toBe('ouro');
    // O tier é mostrado pelo SELO colorido do card (custom_fields.tier), não por tag de texto.
    expect(r.tags).toEqual([]);
    expect(r.priority).toBe('high');
    expect(r.lossReason).toBeNull();
    expect((r.customFields.tier as { value: string }).value).toBe('ouro');
    expect((r.customFields.qualificacao as { operadora: string }).operadora).toBe('Amil');
  });

  it('preserva dados anteriores quando a nova extração vem vazia', () => {
    const prev = { qualificacao: { vidas: 3, operadora: 'Amil' } };
    const sparse: NivaHealthExtraction = {
      ...fullExt,
      tem_cnpj: 'desconhecido',
      vidas: null,
      operadora: null,
      idades: [],
      valor_pago_exato: null,
      objecoes: [],
    };
    const r = nivaHealthExtractor.apply(prev, sparse);
    const qual = r.customFields.qualificacao as { vidas: number; operadora: string };
    expect(qual.vidas).toBe(3);
    expect(qual.operadora).toBe('Amil');
  });

  it('acumula e deduplica objeções por categoria (taxonomia estruturada)', () => {
    const prev = { objecoes: [{ categoria: 'sem_oportunidade', detalhe: null, origem: 'ana' }] };
    const r = nivaHealthExtractor.apply(prev, { ...fullExt, objecoes: ['sem_oportunidade', 'carencia'] });
    const cats = (r.customFields.objecoes as Array<{ categoria: string }>).map((o) => o.categoria);
    expect(cats).toEqual(['sem_oportunidade', 'carencia']); // sem_oportunidade não duplica
  });

  it('converte objeções antigas em string[] para o formato estruturado', () => {
    const r = nivaHealthExtractor.apply({ objecoes: ['achou caro'] }, { ...fullExt, objecoes: ['carencia'] });
    const list = r.customFields.objecoes as Array<{ categoria: string; detalhe: string | null }>;
    expect(list[0]).toMatchObject({ categoria: 'outro', detalhe: 'achou caro' });
    expect(list.some((o) => o.categoria === 'carencia')).toBe(true);
  });

  it('fora_icp grava loss_reason e priority null', () => {
    const r = nivaHealthExtractor.apply({}, { ...fullExt, quer_so_cotacao: true });
    expect(r.tier).toBe('fora_icp');
    expect(r.lossReason).toBeTruthy();
    expect(r.priority).toBeNull();
  });

  it('não apaga o lead_form que já existe nos custom_fields', () => {
    const prev = { lead_form: { mapped: { name: 'Maria' } } };
    const r = nivaHealthExtractor.apply(prev, fullExt);
    expect((r.customFields.lead_form as { mapped: { name: string } }).mapped.name).toBe('Maria');
  });
});

describe('cnpjFromLeadForm (fallback do CNPJ pelo formulário)', () => {
  const withForm = (raw: Record<string, unknown>) => ({ lead_form: { raw } });

  it('"Você possuí CNPJ": "sim" → pme', () => {
    expect(cnpjFromLeadForm(withForm({ 'Você possuí CNPJ': 'sim' }))).toBe('pme');
  });
  it('número do CNPJ preenchido → pme', () => {
    expect(cnpjFromLeadForm(withForm({ 'Qual o número do seu CNPJ': '12.345.678/0001-99' }))).toBe('pme');
  });
  it('resposta "não" NÃO infere nao_tem (pode virar vai_abrir_mei na conversa) → null', () => {
    expect(cnpjFromLeadForm(withForm({ 'Você possuí CNPJ': 'não' }))).toBeNull();
  });
  it('sem form / sem chave de CNPJ → null', () => {
    expect(cnpjFromLeadForm(withForm({ 'Quanto você paga': '2250' }))).toBeNull();
    expect(cnpjFromLeadForm({})).toBeNull();
    expect(cnpjFromLeadForm(undefined)).toBeNull();
  });
  it('número em branco não conta (só "sim" explícito ou dígitos suficientes)', () => {
    expect(cnpjFromLeadForm(withForm({ 'Qual o número do seu CNPJ': '' }))).toBeNull();
  });
});

describe('apply: fallback do CNPJ pelo formulário (o buraco da Nathalia)', () => {
  // A Nathalia desviou da pergunta do CNPJ na conversa ("mando depois") → extração 'desconhecido',
  // MAS o formulário dela diz "Você possuí CNPJ: sim" e ela deu 2 vidas. Sem o fallback ela ficava
  // indefinida (= sem selo + borda colorida). Com o fallback → bronze (2 vidas).
  const nathaliaExt: NivaHealthExtraction = {
    ...fullExt,
    tem_cnpj: 'desconhecido',
    vidas: 2,
    idades: [40, 45],
    operadora: 'Alice',
    valor_pago_exato: 2250,
    objecoes: [],
  };

  it('conversa silenciosa sobre CNPJ + form "sim" + 2 vidas → bronze (não indefinido)', () => {
    const current = { lead_form: { raw: { 'Você possuí CNPJ': 'sim' } } };
    const r = nivaHealthExtractor.apply(current, nathaliaExt);
    expect((r.customFields.tier as { value: string }).value).toBe('bronze');
    expect((r.customFields.qualificacao as { tem_cnpj: string }).tem_cnpj).toBe('pme');
  });

  it('sem form e conversa silenciosa → segue indefinido (nada pra inferir)', () => {
    const r = nivaHealthExtractor.apply({}, nathaliaExt);
    expect((r.customFields.tier as { value: string }).value).toBe('indefinido');
  });

  it('a CONVERSA tem precedência: extração "vai_abrir_mei" NÃO é sobrescrita pelo form (caso Clara)', () => {
    const current = { lead_form: { raw: { 'Você possuí CNPJ': 'sim' } } };
    const claraExt: NivaHealthExtraction = { ...fullExt, tem_cnpj: 'vai_abrir_mei', vidas: 4, idades: [30, 35, 40, 45], valor_pago_exato: 3000 };
    const r = nivaHealthExtractor.apply(current, claraExt);
    expect((r.customFields.qualificacao as { tem_cnpj: string }).tem_cnpj).toBe('vai_abrir_mei');
    expect((r.customFields.tier as { value: string }).value).toBe('prata');
  });
});

// =============================================================================
// Semear tier na CRIAÇÃO do lead (só do formulário do Meta) — quick-win intake
// =============================================================================

// Forma real do lead_form.raw do Meta Lead Ads (ver deals de produção).
const rawMonica = {
  'Você possuí CNPJ': 'sim',
  'Qual o número do seu CNPJ': '',
  'Quais as idades das pessoas': '41,30,17,13 e 1 ano',
  'Você possuí plano de saúde': '',
  'Quanto você paga atualmente no seu plano': '1200 p 2 vidas',
};
const rawNathalia = {
  'Você possuí CNPJ': 'sim',
  'Quais as idades das pessoas': '40, 45',
  'Quanto você paga atualmente no seu plano': '2250',
};

describe('idadesFromLeadForm', () => {
  it('extrai todas as idades do campo, tolerando "e" e "ano"', () => {
    expect(idadesFromLeadForm({ lead_form: { raw: rawMonica } })).toEqual([41, 30, 17, 13, 1]);
  });
  it('lida com "40, 45" e "34 e 43"', () => {
    expect(idadesFromLeadForm({ lead_form: { raw: rawNathalia } })).toEqual([40, 45]);
    expect(idadesFromLeadForm({ lead_form: { raw: { 'Quais as idades das pessoas': '34 e 43' } } })).toEqual([34, 43]);
  });
  it('sem campo de idade → vazio', () => {
    expect(idadesFromLeadForm({ lead_form: { raw: { 'Você possuí CNPJ': 'sim' } } })).toEqual([]);
    expect(idadesFromLeadForm({})).toEqual([]);
  });
});

describe('valorFromLeadForm', () => {
  it('pega o primeiro número do campo "Quanto você paga" ("1200 p 2 vidas" → 1200)', () => {
    expect(valorFromLeadForm({ lead_form: { raw: rawMonica } })).toBe(1200);
  });
  it('valores simples e com separador de milhar/decimal', () => {
    expect(valorFromLeadForm({ lead_form: { raw: rawNathalia } })).toBe(2250);
    expect(valorFromLeadForm({ lead_form: { raw: { 'Quanto você paga atualmente no seu plano': 'R$ 2.500,00' } } })).toBe(2500);
    expect(valorFromLeadForm({ lead_form: { raw: { 'Quanto você paga atualmente no seu plano': '2.250' } } })).toBe(2250);
  });
  it('não casa "Você possuí plano de saúde" (sem quanto/paga) e retorna null sem número', () => {
    expect(valorFromLeadForm({ lead_form: { raw: { 'Você possuí plano de saúde': 'sim' } } })).toBeNull();
    expect(valorFromLeadForm({ lead_form: { raw: { 'Quanto você paga atualmente no seu plano': 'primeiro plano' } } })).toBeNull();
  });
});

describe('seedTierFromLeadForm (tier provisório na criação)', () => {
  it('Mônica (5 vidas, paga 1200) → bronze provisório (valor < 2.000)', () => {
    const seed = seedTierFromLeadForm({ lead_form: { raw: rawMonica } });
    expect(seed).not.toBeNull();
    expect(seed!.value).toBe('bronze');
    expect(seed!.provisorio).toBe(true);
  });
  it('Nathalia/Cleysson (2 vidas) → bronze provisório', () => {
    expect(seedTierFromLeadForm({ lead_form: { raw: rawNathalia } })!.value).toBe('bronze');
  });
  it('3 vidas jovens, paga 3000 → prata provisório', () => {
    const raw = { 'Você possuí CNPJ': 'sim', 'Quais as idades das pessoas': '30, 35, 40', 'Quanto você paga atualmente no seu plano': '3000' };
    expect(seedTierFromLeadForm({ lead_form: { raw } })!.value).toBe('prata');
  });
  it('3 vidas jovens, paga 6000 → ouro, mas provisório (form-only)', () => {
    const raw = { 'Você possuí CNPJ': 'sim', 'Quais as idades das pessoas': '30, 35, 40', 'Quanto você paga atualmente no seu plano': '6000' };
    const seed = seedTierFromLeadForm({ lead_form: { raw } });
    expect(seed!.value).toBe('ouro');
    expect(seed!.provisorio).toBe(true);
  });
  it('CNPJ sim mas SEM idades (vidas desconhecidas) → indefinido → NÃO semeia (null)', () => {
    expect(seedTierFromLeadForm({ lead_form: { raw: { 'Você possuí CNPJ': 'sim' } } })).toBeNull();
  });
  it('1 vida (individual) → fora_icp → NÃO semeia (prematuro pré-conversa)', () => {
    const raw = { 'Você possuí CNPJ': 'sim', 'Quais as idades das pessoas': '30', 'Quanto você paga atualmente no seu plano': '900' };
    expect(seedTierFromLeadForm({ lead_form: { raw } })).toBeNull();
  });
  it('form vazio / sem lead_form → null', () => {
    expect(seedTierFromLeadForm({ lead_form: { raw: {} } })).toBeNull();
    expect(seedTierFromLeadForm({})).toBeNull();
  });
});
