import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmarValorVendaModal } from '@/components/ui/ConfirmarValorVendaModal';
import { LIMITE_PREMIO_MENSAL } from '@/lib/deals/premioFechado';

/**
 * A confirmação do valor da venda no move para "Fechado — Ganho" (11/09/2026).
 *
 * O buraco que ela fecha: `deals.value` tem DOIS significados na vida do mesmo card — nasce com a
 * mensalidade que o lead paga hoje (vem do formulário) e o consultor a sobrescreve com o valor da
 * venda ao fechar. O CRM não sabia em qual dos dois o número estava, e por isso pedia o prêmio de
 * novo depois, no selo âmbar. As 3 vendas de 09/09 foram fechadas assim.
 */
describe('ConfirmarValorVendaModal', () => {
  const base = {
    isOpen: true,
    onClose: () => {},
    onConfirm: () => {},
    dealTitle: 'Fulano — Lead Meta Ads',
    valorDoCard: 2100,
  };

  it('pergunta pelo valor QUE ESTÁ no card — é ele que a resposta confirma', () => {
    render(<ConfirmarValorVendaModal {...base} />);
    // O valor precisa estar escrito: "é esse o valor?" sem mostrar o número não é pergunta.
    expect(screen.getByRole('dialog').textContent).toContain('2.100,00');
  });

  it('"Sim" confirma com o valor do card, sem digitação nenhuma', () => {
    const onConfirm = vi.fn();
    render(<ConfirmarValorVendaModal {...base} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /Sim, é o valor da venda/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(2100, '');
  });

  it('"Não, corrigir" abre o campo, e o novo valor é o que vai para o carimbo', () => {
    const onConfirm = vi.fn();
    render(<ConfirmarValorVendaModal {...base} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /Não, corrigir/i }));

    const campo = screen.getByLabelText(/Valor mensal do plano vendido/i);
    // Formato brasileiro: é assim que a pessoa digita, e `Number('1.850,00')` é NaN.
    fireEvent.change(campo, { target: { value: '1.850,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar venda/i }));

    expect(onConfirm).toHaveBeenCalledWith(1850, '');
  });

  it('card SEM valor abre direto no campo — não há o que confirmar', () => {
    render(<ConfirmarValorVendaModal {...base} valorDoCard={null} />);
    expect(screen.getByLabelText(/Valor mensal do plano vendido/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sim, é o valor da venda/i })).toBeNull();
  });

  it('valor absurdo não passa: o teto é a rede contra o zero a mais', () => {
    const onConfirm = vi.fn();
    render(<ConfirmarValorVendaModal {...base} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /Não, corrigir/i }));
    fireEvent.change(screen.getByLabelText(/Valor mensal do plano vendido/i), {
      target: { value: String(LIMITE_PREMIO_MENSAL + 1) },
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar venda/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('alto demais');
  });

  it('a OPERADORA é opcional — é o que mantém a confirmação em um clique', () => {
    const onConfirm = vi.fn();
    render(<ConfirmarValorVendaModal {...base} onConfirm={onConfirm} />);

    fireEvent.change(screen.getByLabelText(/Operadora do plano vendido/i), {
      target: { value: '  Bradesco Saúde  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sim, é o valor da venda/i }));

    expect(onConfirm).toHaveBeenCalledWith(2100, 'Bradesco Saúde');
  });

  it('fechado não renderiza nada', () => {
    const { container } = render(<ConfirmarValorVendaModal {...base} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });
});
