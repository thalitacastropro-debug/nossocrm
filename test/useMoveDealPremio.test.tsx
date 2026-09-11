import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * O VALOR DA VENDA saindo do card, no move para Ganho (11/09/2026).
 *
 * Palavra dela (10/09): *"o lead vem com o valor que ele preenche no formulário e depois o
 * consultor atualiza para o valor da venda"*. `deals.value` tem dois significados na vida do
 * mesmo card, e era por isso que o CRM pedia o prêmio de novo depois. Aqui se garante o que a
 * confirmação promete: o número confirmado vai para o CARD e para o CARIMBO, de uma vez.
 */

const updateSpy = vi.fn(async () => ({ error: null }));

vi.mock('@/lib/supabase', () => ({
  dealsService: { update: (...args: unknown[]) => updateSpy(...(args as [])) },
}));
vi.mock('@/lib/supabase/activities', () => ({
  activitiesService: { create: vi.fn(async () => ({})) },
}));
vi.mock('@/lib/supabase/contacts', () => ({
  contactsService: { update: vi.fn(async () => ({})) },
}));

import { useMoveDeal } from '@/lib/query/hooks/useMoveDeal';

const BOARD = {
  id: 'board-comercial',
  name: 'Comercial — Consultor',
  nextBoardId: 'board-implantacao',
  wonStageId: 'etapa-ganho',
  stages: [
    { id: 'etapa-qualificacao', label: 'Qualificação', linkedLifecycleStage: null },
    { id: 'etapa-ganho', label: 'Fechado/Ganho', linkedLifecycleStage: 'CUSTOMER' },
  ],
} as never;

const DEAL = {
  id: 'deal-1',
  title: 'Fulano',
  boardId: 'board-comercial',
  status: 'etapa-qualificacao',
  value: 2100,
  isWon: false,
  isLost: false,
  contactId: null,
  customFields: {},
} as never;

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useMoveDeal(), { wrapper });
}

/** O corpo JSON do POST para a rota do próximo funil. */
function corpoDoPost(fetchSpy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const chamada = fetchSpy.mock.calls.find((c) => String(c[0]).includes('/proximo-funil'));
  return JSON.parse(String((chamada?.[1] as { body?: string })?.body ?? '{}'));
}

describe('useMoveDeal — o prêmio confirmado no move para Ganho', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ movido: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('valor CORRIGIDO sobrescreve `deals.value` — a etapa manual do consultor vira consequência', async () => {
    const { result } = montar();
    result.current.mutate({
      dealId: 'deal-1',
      targetStageId: 'etapa-ganho',
      premioMensal: 1850,
      deal: DEAL,
      board: BOARD,
    });

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    const updates = updateSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(updates.isWon).toBe(true);
    expect(updates.value).toBe(1850);
    expect(corpoDoPost(fetchSpy)).toMatchObject({ premioMensal: 1850 });
  });

  it('valor CONFIRMADO (igual ao do card) não gera update de valor — só o carimbo', async () => {
    const { result } = montar();
    result.current.mutate({
      dealId: 'deal-1',
      targetStageId: 'etapa-ganho',
      premioMensal: 2100,
      operadoraDaVenda: 'Bradesco Saúde',
      deal: DEAL,
      board: BOARD,
    });

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    const updates = updateSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(updates.isWon).toBe(true);
    expect('value' in updates).toBe(false);
    expect(corpoDoPost(fetchSpy)).toEqual({ premioMensal: 2100, operadora: 'Bradesco Saúde' });
  });

  it('move comum não mexe no valor do card nem manda prêmio nenhum', async () => {
    const { result } = montar();
    result.current.mutate({
      dealId: 'deal-1',
      targetStageId: 'etapa-qualificacao',
      premioMensal: 1850,
      deal: DEAL,
      board: BOARD,
    });

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    const updates = updateSpy.mock.calls[0][1] as Record<string, unknown>;
    expect('value' in updates).toBe(false);
    // Etapa comum não chama a automação de ganho.
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('/proximo-funil'))).toBe(false);
  });

  it('ganho SEM confirmação continua funcionando — corpo vazio, venda sem prêmio', async () => {
    const { result } = montar();
    result.current.mutate({
      dealId: 'deal-1',
      targetStageId: 'etapa-ganho',
      deal: DEAL,
      board: BOARD,
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(corpoDoPost(fetchSpy)).toEqual({});
  });
});
