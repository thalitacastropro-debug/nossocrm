import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ActivityRow } from './ActivityRow';
import type { Activity } from '@/types';

// ActivityRow consulta os boards só para traduzir UUID de etapa em label.
vi.mock('@/lib/query/hooks/useBoardsQuery', () => ({
  useBoards: () => ({ data: [] }),
}));

const noop = () => {};

function makeNote(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'act-1',
    title: 'Nota Adicionada',
    description: 'Cliente mora no Guaruja e usa a Casa de Saude na cidade.',
    type: 'NOTE',
    date: new Date().toISOString(),
    completed: true,
    dealId: 'deal-1',
    dealTitle: 'Josiane Nobre',
    user: { name: 'Eu', avatar: '' },
    ...overrides,
  } as Activity;
}

describe('ActivityRow — nota na timeline', () => {
  it('mostra o TEXTO da nota, não só o título "Nota Adicionada"', () => {
    render(
      <ActivityRow
        activity={makeNote()}
        onToggleComplete={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    // O que o Pedro escreveu precisa aparecer na tela.
    expect(
      screen.getByText(/Cliente mora no Guaruja/i),
    ).toBeTruthy();
  });

  it('não risca o título da nota (nota não é tarefa concluída)', () => {
    render(
      <ActivityRow
        activity={makeNote()}
        onToggleComplete={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    const titulo = screen.getByText('Nota Adicionada');
    expect(titulo.className).not.toContain('line-through');
  });

  it('mantém a descrição visível em atividades que não são nota', () => {
    render(
      <ActivityRow
        activity={makeNote({
          type: 'CALL',
          title: 'Ligar para o lead',
          description: 'Confirmar horario da reuniao',
          completed: false,
        })}
        onToggleComplete={noop}
        onEdit={noop}
        onDelete={noop}
      />,
    );

    expect(screen.getByText(/Confirmar horario da reuniao/i)).toBeTruthy();
  });
});
