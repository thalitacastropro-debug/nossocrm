import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VoiceOutcomeCapture } from './VoiceOutcomeCapture';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

const review = {
  transcricao: 'fechei com a Valéria, 3 vidas, Amil',
  audioFilePath: `${DEAL_ID}/voice/a.webm`,
  desfecho: {
    desfecho: 'fechou' as const,
    nota_resumo: 'Fechou 3 vidas Amil',
    tarefas: [{ descricao: 'Enviar contrato', data: null }],
    dados_negocio: { operadora: 'Amil', vidas: 3, valor: 2100 },
    objecoes: [],
    motivo_perda: null,
    motivo_perda_detalhe: null,
    reabordar_em: null,
    confidence: 0.9,
  },
};

describe('VoiceOutcomeCapture', () => {
  it('estado ocioso: mostra o botão de gravar', () => {
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} />);
    expect(screen.getByRole('button', { name: /gravar desfecho/i })).toBeInTheDocument();
  });

  it('estado de revisão: campos editáveis + Confirmar + transcrição', () => {
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} __testInitialReview={review} />);
    expect(screen.getByText(/fechei com a Valéria/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Amil')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fechou 3 vidas Amil')).toBeInTheDocument();
    // tarefa ditada aparece na lista
    expect(screen.getByText(/Enviar contrato/)).toBeInTheDocument();
  });

  it('perdeu: expõe o campo de motivo da perda', () => {
    const perdeu = { ...review, desfecho: { ...review.desfecho, desfecho: 'perdeu' as const, motivo_perda: 'concorrente' as const } };
    wrap(<VoiceOutcomeCapture dealId={DEAL_ID} __testInitialReview={perdeu} />);
    expect(screen.getByText(/Motivo da perda/i)).toBeInTheDocument();
  });
});
