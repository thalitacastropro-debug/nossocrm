import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QualificacaoSDRPanel, sdrPanelHasData } from '@/features/deals/components/QualificacaoSDRPanel';

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

// Dados reais do deal de teste 09026765 (Thalita) + lead_form real da Mavie (Meta Ads).
const QUAL = {
  vidas: 2,
  idades: [6],
  operadora: 'Porto',
  valor_pago_exato: 2100,
  coparticipacao: 'sem',
  tem_plano_atual: 'sim',
  tem_cnpj: 'pme',
  cidade_uf: 'sao paulo',
  hospital_preferencia: '9 de Julho',
};

describe('QualificacaoSDRPanel', () => {
  it('mostra a qualificação da Ana, o tier, a reunião e as pendências', () => {
    const out = html(
      <QualificacaoSDRPanel
        customFields={{
          qualificacao: QUAL,
          tier: { value: 'indefinido', motivos: ['Faltam dados essenciais'], provisorio: true },
          reuniao_agendada: { status: 'confirmada', label: 'segunda, 13/07, às 10h' },
        }}
      />,
    );
    expect(out).toContain('Qualificação (Ana)');
    expect(out).toContain('Porto');
    expect(out).toContain('2.100');
    expect(out).toContain('9 de Julho');
    expect(out).toContain('segunda, 13/07, às 10h'); // reunião confirmada no horário certo
    expect(out).toContain('pegar nº do CNPJ'); // tem CNPJ (pme)+cidade → falta o número
    expect(out).toContain('provisório'); // tier provisório sinalizado
  });

  it('mostra o formulário do Meta no modo completo e filtra campos técnicos', () => {
    const out = html(
      <QualificacaoSDRPanel
        customFields={{
          lead_form: {
            fields: {
              'Você possuí CNPJ': 'sim',
              'Quais as idades das pessoas': '27, 47, 69, 73',
              anuncio: '120245158337780451',
              campanha: '',
            },
          },
        }}
      />,
    );
    expect(out).toContain('Formulário do anúncio');
    expect(out).toContain('Você possuí CNPJ');
    expect(out).toContain('27, 47, 69, 73');
    // 'anuncio' é técnico → seu valor não deve aparecer
    expect(out).not.toContain('120245158337780451');
  });

  it('não renderiza nada sem dados', () => {
    expect(html(<QualificacaoSDRPanel customFields={{}} />)).toBe('');
  });

  /**
   * MUDOU EM 17/09/2026 (pedido dela). Antes o compact exigia qualificação e o formulário ficava
   * só na aba IA Insights — o que escondia o dado exatamente quando ele era a ÚNICA coisa que
   * existia. Caso da Sara Teles: lead do anúncio que chegou com CNPJ, vidas e valor respondidos, e
   * cujo primeiro toque falhou (WhatsApp caiu). Sem conversa não há `qualificacao`, então a coluna
   * do card ficava vazia e parecia que o formulário não tinha vindo. Tinha.
   */
  it('compact MOSTRA o formulário quando ainda não há qualificação', () => {
    const cf = { lead_form: { fields: { 'Você possuí CNPJ': 'sim' } } };
    const out = html(<QualificacaoSDRPanel customFields={cf} compact />);
    expect(out).not.toBe('');
    expect(out).toContain('Você possuí CNPJ');
    // Sem conversa, o título não pode dizer "Qualificação (Ana)" — ela não qualificou nada.
    expect(out).toContain('Respostas do anúncio');
    expect(sdrPanelHasData(cf, { compact: true })).toBe(true);
    expect(sdrPanelHasData(cf)).toBe(true);
  });

  it('com qualificação, o compact NÃO repete o formulário — a conversa é mais nova', () => {
    const cf = { qualificacao: QUAL, lead_form: { fields: { 'Você possuí CNPJ': 'sim' } } };
    const out = html(<QualificacaoSDRPanel customFields={cf} compact />);
    expect(out).toContain('Qualificação (Ana)');
    expect(out).not.toContain('Formulário do anúncio');
  });

  it('sdrPanelHasData: qualificação vazia não conta', () => {
    expect(sdrPanelHasData({ qualificacao: {} })).toBe(false);
    expect(sdrPanelHasData({ qualificacao: QUAL }, { compact: true })).toBe(true);
  });
});
