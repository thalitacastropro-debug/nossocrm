import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * A porta de entrada do perdido que voltou a falar (dúvida do Pedro, 09/10): o card perdido some
 * do funil; esta faixa é por onde ele volta — abre o card (onde está o Reabrir) ou dispensa.
 */

const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
let retornos: unknown[] = [];
const dispensarMutate = vi.fn();

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'pedro' } }) }));
vi.mock('@/lib/query/hooks/usePerdidosQueVoltaram', () => ({
  usePerdidosQueVoltaram: () => ({ data: retornos }),
  useDispensarPerdidoQueVoltou: () => ({ mutate: dispensarMutate, isPending: false }),
}));

import { PerdidosQueVoltaramBar } from './PerdidosQueVoltaramBar';

const daniel = {
  id: 'r1',
  dealId: DEAL_ID,
  titulo: 'Daniel Luiz Borges — Lead Meta Ads',
  ultimaMsgEm: '2026-10-09T17:19:00Z', // 14:19 em Brasília
  ultimaPrevia: 'Oi, ainda tem aquele plano?',
  qtdMsgs: 2,
};

describe('PerdidosQueVoltaramBar', () => {
  beforeEach(() => { retornos = []; dispensarMutate.mockClear(); });

  it('sem retorno, não ocupa espaço no funil', () => {
    const { container } = render(<PerdidosQueVoltaramBar onAbrir={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mostra quem voltou, a última mensagem e o horário de Brasília', () => {
    retornos = [daniel];
    render(<PerdidosQueVoltaramBar onAbrir={vi.fn()} />);
    expect(screen.getByText('1 lead perdido voltou a falar')).toBeInTheDocument();
    expect(screen.getByText('Daniel Luiz Borges — Lead Meta Ads')).toBeInTheDocument();
    expect(screen.getByText(/Oi, ainda tem aquele plano\?/)).toBeInTheDocument();
    expect(screen.getByText(/09\/10 14:19/)).toBeInTheDocument();
  });

  it('clicar no lead abre o CARD dele (onde está o Reabrir)', async () => {
    retornos = [daniel];
    const onAbrir = vi.fn();
    render(<PerdidosQueVoltaramBar onAbrir={onAbrir} />);
    await userEvent.setup().click(screen.getByText('Daniel Luiz Borges — Lead Meta Ads'));
    expect(onAbrir).toHaveBeenCalledWith(DEAL_ID);
  });

  it('dispensar tira da faixa sem mexer no card', async () => {
    retornos = [daniel];
    render(<PerdidosQueVoltaramBar onAbrir={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /dispensar daniel/i }));
    expect(dispensarMutate).toHaveBeenCalledWith({ id: 'r1', userId: 'pedro' });
  });
});
