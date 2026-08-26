import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PremioFechadoForm } from '@/features/deals/components/PremioFechadoForm';

/**
 * O formulário do prêmio fechado — o mesmo componente serve o modal do card (Implantação)
 * e a pendência do topo do funil (quem vendeu não vê mais o card, mas vê a pendência).
 */

const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

describe('PremioFechadoForm', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('envia prêmio, operadora e vigência para a rota e avisa quem chamou', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, venda: { premio_mensal: 1850, operadora: 'Bradesco', vigencia_em: '2026-09-01' } }),
    });
    const onSaved = vi.fn();
    render(<PremioFechadoForm dealId={DEAL_ID} onSaved={onSaved} />);

    await userEvent.type(screen.getByLabelText(/prêmio mensal/i), '1.850,00');
    await userEvent.type(screen.getByLabelText(/operadora/i), 'Bradesco');
    await userEvent.type(screen.getByLabelText(/vigência/i), '2026-09-01');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      premio_mensal: 1850,
      operadora: 'Bradesco',
      vigencia_em: '2026-09-01',
    }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/deals/${DEAL_ID}/venda`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toMatchObject({ premio_mensal: '1.850,00', operadora: 'Bradesco' });
  });

  it('barra o envio sem prêmio ou sem operadora, sem chamar a rota', async () => {
    render(<PremioFechadoForm dealId={DEAL_ID} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/prêmio mensal/i, { selector: '[role="alert"]' })).toBeTruthy();
  });

  it('mostra a mensagem da rota quando o servidor recusa', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Esta venda não é sua. Só quem fechou (ou o administrador) informa o prêmio.' }),
    });
    render(<PremioFechadoForm dealId={DEAL_ID} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/prêmio mensal/i), '2000');
    await userEvent.type(screen.getByLabelText(/operadora/i), 'AMIL');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByText(/não é sua/i)).toBeTruthy();
  });

  it('vem preenchido quando é correção de prêmio já informado', () => {
    render(
      <PremioFechadoForm
        dealId={DEAL_ID}
        onSaved={vi.fn()}
        premioAtual={{ premio_mensal: 1000, operadora: 'AMIL', vigencia_em: null }}
      />,
    );
    expect((screen.getByLabelText(/prêmio mensal/i) as HTMLInputElement).value).toBe('1000');
    expect((screen.getByLabelText(/operadora/i) as HTMLInputElement).value).toBe('AMIL');
  });

  it('não expõe percentual de comissão em lugar nenhum — dado confidencial', () => {
    const { container } = render(<PremioFechadoForm dealId={DEAL_ID} onSaved={vi.fn()} />);
    expect(container.innerHTML).not.toMatch(/2[256]0%|330%|262%|comiss/i);
  });
});
