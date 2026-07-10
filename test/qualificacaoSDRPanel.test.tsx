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

  it('compact não renderiza só com formulário (form fica na aba completa)', () => {
    const cf = { lead_form: { fields: { 'Você possuí CNPJ': 'sim' } } };
    expect(html(<QualificacaoSDRPanel customFields={cf} compact />)).toBe('');
    expect(sdrPanelHasData(cf, { compact: true })).toBe(false);
    expect(sdrPanelHasData(cf)).toBe(true);
  });

  it('sdrPanelHasData: qualificação vazia não conta', () => {
    expect(sdrPanelHasData({ qualificacao: {} })).toBe(false);
    expect(sdrPanelHasData({ qualificacao: QUAL }, { compact: true })).toBe(true);
  });
});
