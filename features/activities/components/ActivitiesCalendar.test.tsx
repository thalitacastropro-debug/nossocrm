import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActivitiesCalendar } from './ActivitiesCalendar';
import type { Activity, Deal } from '@/types';

// Semana fixa para o teste não depender do dia em que roda.
const QUARTA = new Date(2026, 4, 6, 10, 0, 0); // 6 de maio de 2026, 10:00

const atividade = (over: Partial<Activity>): Activity => ({
  id: 'a1',
  dealId: 'deal-1',
  dealTitle: 'Lead Meta Ads',
  type: 'CALL',
  title: 'Ligação — João Almeida',
  description: '',
  date: new Date(2026, 4, 6, 9, 0, 0).toISOString(),
  user: { name: 'Pedro', avatar: '' },
  completed: false,
  ...over,
});

const deals = [{ id: 'deal-1', title: 'João Almeida — Lead Meta Ads' } as Deal];

const renderCalendario = (activities: Activity[], onEdit?: (a: Activity) => void) =>
  render(
    <ActivitiesCalendar
      activities={activities}
      deals={deals}
      currentDate={QUARTA}
      setCurrentDate={vi.fn()}
      onEdit={onEdit}
    />,
  );

describe('ActivitiesCalendar', () => {
  // O que identifica o compromisso de relance é COM QUEM ele é. O título costuma
  // ser o tipo ("Ligação diagnóstica"), igual em todos os cards da semana.
  it('põe o nome do lead em evidência, e o título junto do horário', () => {
    renderCalendario([atividade({ title: 'Ligação diagnóstica' })]);

    expect(screen.getByText('João Almeida')).toBeInTheDocument();
    const bloco = screen.getByTitle(/João Almeida/);
    expect(bloco.textContent).toContain('09:00');
    expect(bloco.textContent).toContain('Ligação diagnóstica');
  });

  it('sem negócio vinculado, cai no título da atividade', () => {
    renderCalendario([atividade({ dealId: '', dealTitle: '', title: 'Bloqueio — foco' })]);

    expect(screen.getByText('Bloqueio — foco')).toBeInTheDocument();
  });

  // O "delineado cinza" que a Thalita via: NOTE e STATUS_CHANGE não tinham cor no
  // switch e viravam caixas vazias de contorno. São 46 das 62 atividades da base —
  // e não são hora marcada, são histórico.
  it('não coloca nota nem mudança de etapa no calendário', () => {
    renderCalendario([
      atividade({ id: 'n1', type: 'NOTE', title: 'Carteira transferida — Denilson para Pedro' }),
      atividade({ id: 's1', type: 'STATUS_CHANGE', title: 'Movido para Qualificação' }),
      atividade({ id: 'c1', type: 'MEETING', title: 'Reunião — Briefing' }),
    ]);

    expect(screen.queryByTitle(/Carteira transferida/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Movido para Qualificação/)).not.toBeInTheDocument();
    expect(screen.getByTitle(/Reunião — Briefing/)).toBeInTheDocument();
  });

  it('avisa quantos registros de histórico existem na semana, para não sumirem calados', () => {
    renderCalendario([
      atividade({ id: 'n1', type: 'NOTE' }),
      atividade({ id: 'n2', type: 'STATUS_CHANGE' }),
    ]);

    expect(screen.getByText(/2 registros de histórico nesta semana/i)).toBeInTheDocument();
  });

  // A causa do "fica gigantesco e vai puxando a tela pra baixo": o bloco de
  // detalhes ficava no DOM com opacity-0, ocupando altura com a descrição inteira.
  it('não renderiza a descrição antes do clique', () => {
    const descricao = 'Repasse da etapa Qualificacao do funil Comercial, decisao da Thalita.';
    renderCalendario([atividade({ description: descricao })]);

    expect(screen.queryByText(descricao)).not.toBeInTheDocument();
  });

  it('clicar no compromisso abre o detalhe com descrição e negócio', () => {
    const descricao = 'Confirmar documentação antes da call.';
    renderCalendario([atividade({ description: descricao })]);

    fireEvent.click(screen.getByTitle(/Ligação — João Almeida/));

    expect(screen.getByText(descricao)).toBeInTheDocument();
    expect(screen.getByText('João Almeida — Lead Meta Ads')).toBeInTheDocument();
    expect(screen.getByText('Ligação')).toBeInTheDocument();
  });

  it('o botão Editar do detalhe entrega a atividade clicada', () => {
    const onEdit = vi.fn();
    renderCalendario([atividade({ id: 'alvo' })], onEdit);

    fireEvent.click(screen.getByTitle(/Ligação — João Almeida/));
    fireEvent.click(screen.getByRole('button', { name: /editar/i }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0].id).toBe('alvo');
  });

  it('compromisso fora da faixa do dia (madrugada) não quebra o grid', () => {
    renderCalendario([
      atividade({ id: 'madrugada', title: 'Disparo automático', date: new Date(2026, 4, 6, 3, 0, 0).toISOString() }),
    ]);

    expect(screen.queryByText('Disparo automático')).not.toBeInTheDocument();
  });

  it('mostra a semana do dia selecionado', () => {
    renderCalendario([]);

    expect(screen.getByText(/de maio 2026/i)).toBeInTheDocument();
  });
});
