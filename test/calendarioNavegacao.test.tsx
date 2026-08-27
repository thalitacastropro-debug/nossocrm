import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ActivitiesCalendar } from '@/features/activities/components/ActivitiesCalendar';

/**
 * Pular para uma data distante sem clicar 50x nas setinhas.
 *
 * Pedido da Thalita (27/08/2026): *"no calendário eu não consigo passar pra outro mês ou
 * escolher qualquer outra data se não criar outra atividade ou passar as setinhas que
 * mudam por semana. Eu queria ir lá pra julho do ano que vem pra ver se a tarefa do
 * Richard foi agendada."* — de agosto/2026 até julho/2027 são ~48 cliques na setinha.
 */
afterEach(cleanup);

const base = {
  activities: [],
  deals: [],
  onEdit: vi.fn(),
};

describe('ActivitiesCalendar — navegação por data', () => {
  it('tem um seletor de data para pular direto para qualquer semana', () => {
    render(
      <ActivitiesCalendar {...base} currentDate={new Date('2026-08-27T12:00:00')} setCurrentDate={vi.fn()} />,
    );
    expect(screen.getByLabelText(/ir para uma data/i)).toBeTruthy();
  });

  it('escolher 27/07/2027 leva o calendário para aquela semana', () => {
    const setCurrentDate = vi.fn();
    render(
      <ActivitiesCalendar {...base} currentDate={new Date('2026-08-27T12:00:00')} setCurrentDate={setCurrentDate} />,
    );

    fireEvent.change(screen.getByLabelText(/ir para uma data/i), { target: { value: '2027-07-27' } });

    expect(setCurrentDate).toHaveBeenCalledTimes(1);
    const escolhida = setCurrentDate.mock.calls[0][0] as Date;
    expect(escolhida.getFullYear()).toBe(2027);
    expect(escolhida.getMonth()).toBe(6); // julho
    expect(escolhida.getDate()).toBe(27);
  });

  it('os botões de mês pulam 4 semanas de uma vez', () => {
    const setCurrentDate = vi.fn();
    render(
      <ActivitiesCalendar {...base} currentDate={new Date('2026-08-27T12:00:00')} setCurrentDate={setCurrentDate} />,
    );

    fireEvent.click(screen.getByLabelText(/próximo mês/i));
    const depois = setCurrentDate.mock.calls[0][0] as Date;
    expect(depois.getMonth()).toBe(8); // setembro
  });

  it('data inválida não mexe no calendário (input vazio ao apagar)', () => {
    const setCurrentDate = vi.fn();
    render(
      <ActivitiesCalendar {...base} currentDate={new Date('2026-08-27T12:00:00')} setCurrentDate={setCurrentDate} />,
    );
    fireEvent.change(screen.getByLabelText(/ir para uma data/i), { target: { value: '' } });
    expect(setCurrentDate).not.toHaveBeenCalled();
  });
});
