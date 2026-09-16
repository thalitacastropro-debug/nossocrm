import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * ESCOLHER UMA EMPRESA EXISTENTE NÃO PODE CRIAR UMA CÓPIA DELA (16/09/2026).
 *
 * O modal de novo negócio manda `companyName` mesmo quando a pessoa escolheu uma empresa já
 * cadastrada na busca — e o hook criava a empresa a partir desse nome, sem olhar o id que já
 * estava ali. Além da linha duplicada, o `finalCompanyId` sobrescrevia o `deal.companyId`, então o
 * negócio ficava preso à CÓPIA e a empresa original seguia sem ele. Nada disso dava erro na tela.
 */

const criarEmpresa = vi.fn(async () => ({ data: { id: 'empresa-nova' }, error: null }));
const criarContato = vi.fn(async () => ({ data: { id: 'contato-1' }, error: null }));
const criarDeal = vi.fn(async () => ({ data: { id: 'deal-1' }, error: null }));

vi.mock('@/lib/supabase', () => ({
  dealsService: { create: (...a: unknown[]) => criarDeal(...(a as [])) },
  contactsService: { create: (...a: unknown[]) => criarContato(...(a as [])) },
  companiesService: { create: (...a: unknown[]) => criarEmpresa(...(a as [])) },
}));

import { useCreateDealWithContact } from '@/lib/query/hooks/useDealsQuery';

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useCreateDealWithContact(), { wrapper });
}

const DEAL_BASE = {
  title: 'Indicação',
  boardId: 'board-1',
  status: 'etapa-1',
  ownerId: 'user-1',
  value: 0,
  items: [],
  contactId: '',
  companyId: '',
  isWon: false,
  isLost: false,
  customFields: {},
  updatedAt: '2026-09-16T00:00:00.000Z',
} as never;

describe('useCreateDealWithContact — empresa', () => {
  beforeEach(() => vi.clearAllMocks());

  it('empresa JÁ ESCOLHIDA: não cria nada, e o negócio aponta para a original', async () => {
    const { result } = montar();
    result.current.mutate({
      deal: { ...(DEAL_BASE as object), companyId: 'empresa-existente' } as never,
      relatedData: {
        // O modal manda o nome mesmo assim — é isso que criava a cópia.
        companyName: 'TEAM MONTEIRO TREINAMENTOS LTDA',
        contact: { name: 'Fulano' },
      },
    });

    await waitFor(() => expect(criarDeal).toHaveBeenCalled());
    expect(criarEmpresa).not.toHaveBeenCalled();
    expect((criarDeal.mock.calls[0][0] as { companyId: string }).companyId).toBe('empresa-existente');
  });

  it('empresa NOVA (nome digitado, sem id): cria e liga no negócio', async () => {
    const { result } = montar();
    result.current.mutate({
      deal: DEAL_BASE,
      relatedData: { companyName: 'Empresa Nova Ltda', contact: { name: 'Fulano' } },
    });

    await waitFor(() => expect(criarDeal).toHaveBeenCalled());
    expect(criarEmpresa).toHaveBeenCalledTimes(1);
    expect((criarDeal.mock.calls[0][0] as { companyId: string }).companyId).toBe('empresa-nova');
  });

  it('nome só de espaços não vira empresa', async () => {
    const { result } = montar();
    result.current.mutate({
      deal: DEAL_BASE,
      relatedData: { companyName: '   ', contact: { name: 'Fulano' } },
    });

    await waitFor(() => expect(criarDeal).toHaveBeenCalled());
    expect(criarEmpresa).not.toHaveBeenCalled();
  });
});
