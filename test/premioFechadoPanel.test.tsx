import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PremioFechadoPanel } from '@/features/deals/components/PremioFechadoPanel';

const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const CARIMBO = {
  vendedor_id: 'x',
  vendedor_nome: 'Denilson Silva',
  vendido_em: '2026-08-25T16:56:34.267Z',
  board_id_da_venda: 'b',
  valor_na_venda: 350,
};

function montar(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(cleanup);

describe('PremioFechadoPanel', () => {
  it('venda pendente de prêmio mostra o formulário', () => {
    montar(<PremioFechadoPanel dealId={DEAL_ID} customFields={{ venda: { ...CARIMBO } }} />);
    expect(screen.getByText(/falta informar o prêmio/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /salvar/i })).toBeTruthy();
  });

  it('venda DESFEITA (card perdido) mostra o aviso e NÃO cobra prêmio', () => {
    // Caso Richard 27/08: card com carimbo marcado perdido. Cobrar prêmio de venda que
    // caiu induziria alguém a "resolver a pendência" de uma venda que não existe.
    montar(
      <PremioFechadoPanel dealId={DEAL_ID} customFields={{ venda: { ...CARIMBO } }} vendaDesfeita />,
    );
    expect(screen.getByText(/venda desfeita/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /salvar/i })).toBeNull();
    expect(screen.queryByText(/falta informar/i)).toBeNull();
  });

  it('card sem carimbo não renderiza nada', () => {
    const { container } = montar(<PremioFechadoPanel dealId={DEAL_ID} customFields={{}} />);
    expect(container.innerHTML).toBe('');
  });
});
