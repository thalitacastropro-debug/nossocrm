import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DealCard } from './DealCard';
import type { DealView } from '@/types';

// next/image não roda no ambiente de teste sem o loader do Next. `unoptimized` é
// prop do Next, não atributo de DOM — sai fora para o React não reclamar.
vi.mock('next/image', () => ({
  default: ({ unoptimized: _unoptimized, ...props }: Record<string, unknown>) =>
    React.createElement('img', props as React.ImgHTMLAttributes<HTMLImageElement>),
}));

const baseDeal = {
  id: 'deal-1',
  title: 'Ana Paula Trivino — Lead Meta Ads',
  companyName: 'Niva',
  value: 5240,
  probability: 50,
  tags: [],
  customFields: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  items: [],
  isWon: false,
  isLost: false,
} as unknown as DealView;

const props = {
  isRotting: false,
  activityStatus: 'green',
  isDragging: false,
  onDragStart: vi.fn(),
  onSelect: vi.fn(),
  isMenuOpen: false,
  setOpenMenuId: vi.fn(),
  onQuickAddActivity: vi.fn(),
  setLastMouseDownDealId: vi.fn(),
};

const renderCard = (deal: DealView) => render(<DealCard deal={deal} {...props} />);

describe('DealCard — dono do lead', () => {
  // Com dois consultores na operação, saber de quem é o card precisa ser leitura
  // de relance: iniciais coloridas + primeiro nome, não só um tooltip.
  it('mostra o primeiro nome do dono, não só as iniciais', () => {
    renderCard({ ...baseDeal, owner: { name: 'Pedro Sellan', avatar: '' } } as DealView);

    expect(screen.getByText('Pedro')).toBeTruthy();
    expect(screen.getByText('PS')).toBeTruthy();
    expect(screen.getByTitle('Responsável: Pedro Sellan')).toBeTruthy();
  });

  it('dá cor diferente para pessoas diferentes', () => {
    const { unmount } = renderCard({ ...baseDeal, owner: { name: 'Pedro Sellan', avatar: '' } } as DealView);
    const corPedro = screen.getByText('PS').className;
    unmount();

    renderCard({ ...baseDeal, owner: { name: 'Denilson Silva', avatar: '' } } as DealView);
    const corDenilson = screen.getByText('DS').className;

    expect(corPedro).not.toBe(corDenilson);
  });

  it('a cor da pessoa não muda entre renders', () => {
    const { unmount } = renderCard({ ...baseDeal, owner: { name: 'Denilson Silva', avatar: '' } } as DealView);
    const primeira = screen.getByText('DS').className;
    unmount();

    renderCard({ ...baseDeal, id: 'deal-2', owner: { name: 'Denilson Silva', avatar: '' } } as DealView);
    expect(screen.getByText('DS').className).toBe(primeira);
  });

  // Card sem dono é o estado de risco (ninguém está cuidando do lead) — tem que
  // aparecer, não sumir em silêncio como acontecia antes.
  it('marca explicitamente o card sem dono', () => {
    renderCard({ ...baseDeal, owner: { name: 'Sem Dono', avatar: '' } } as DealView);

    expect(screen.getByText('sem dono')).toBeTruthy();
  });

  it('usa o avatar quando a pessoa tem foto', () => {
    renderCard({
      ...baseDeal,
      owner: { name: 'Thalita Castro', avatar: 'https://exemplo.test/foto.png' },
    } as DealView);

    expect(screen.getByAltText('Responsável: Thalita Castro')).toBeTruthy();
    expect(screen.getByText('Thalita')).toBeTruthy();
  });
});
