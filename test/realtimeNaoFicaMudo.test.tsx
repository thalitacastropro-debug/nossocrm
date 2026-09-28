import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * O CRM NÃO PODE FICAR DESATUALIZADO EM SILÊNCIO (28/09/2026).
 *
 * Queixa dos consultores: "toda hora preciso dar F5 pra saber se chegou mensagem". A causa eram
 * duas decisões que se anulavam:
 *
 *  1. `refetchOnWindowFocus: false` no queryClient, com o comentário "Realtime covers main
 *     entities — window focus refetch is redundant". Verdade só enquanto o realtime está vivo.
 *  2. O canal do realtime morria (notebook dorme, aba em segundo plano, wi-fi, token) e NINGUÉM
 *     o levantava: o hook registrava `CHANNEL_ERROR (will auto-retry)` e ficava nisso.
 *
 * Junto: a única fonte de frescor caía e não havia rede embaixo. A tela congelava sem avisar.
 */

let canaisCriados: FakeChannel[] = [];
let removidos: FakeChannel[] = [];

type Handler = (payload: Record<string, unknown>) => void;

interface FakeChannel {
  nome: string;
  state: string;
  /** Handlers registrados por tabela, para o teste conseguir disparar um evento. */
  handlers: Map<string, Handler>;
  on: (tipo: string, filtro: Record<string, unknown>, h: Handler) => FakeChannel;
  subscribe: (cb: (s: string) => void) => FakeChannel;
}

function criarCanal(nome: string): FakeChannel {
  const canal: FakeChannel = {
    nome,
    state: 'closed',
    handlers: new Map(),
    on: (_tipo, filtro, h) => {
      if (typeof filtro?.table === 'string') canal.handlers.set(filtro.table, h);
      return canal;
    },
    subscribe: (cb) => {
      canal.state = 'joined';
      cb('SUBSCRIBED');
      return canal;
    },
  };
  canaisCriados.push(canal);
  return canal;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (nome: string) => criarCanal(nome),
    removeChannel: (c: FakeChannel) => { removidos.push(c); },
  },
}));

import { useRealtimeSync } from '@/lib/realtime/useRealtimeSync';
import { queryClient as queryClientDoApp } from '@/lib/query';
import { DEALS_VIEW_KEY } from '@/lib/query/queryKeys';

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRealtimeSync(['messaging_messages']), { wrapper });
}

/** Simula o browser mudando a visibilidade da aba. */
function visibilidade(valor: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: valor, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** O canal que está de pé agora (o hook descarta canais antigos ao recriar). */
const canalVivo = () => canaisCriados.filter((c) => !removidos.includes(c)).at(-1);

/**
 * Espera o canal entrar no ar. O hook adia o `subscribe` em 100ms de propósito (comentário no
 * useRealtimeSync: evita corrida com a remoção do canal anterior), então logo depois de montar o
 * canal existe mas ainda está `closed` — foi nisso que este teste tropeçou primeiro.
 */
async function esperarNoAr() {
  await waitFor(() => expect(canalVivo()?.state).toBe('joined'), { timeout: 3000 });
  return canalVivo()!;
}

beforeEach(() => {
  canaisCriados = [];
  removidos = [];
  visibilidade('visible');
});

afterEach(() => vi.clearAllMocks());

describe('realtime: a tela não pode congelar calada', () => {
  it('o queryClient do app revalida ao voltar pra aba (a rede embaixo do realtime)', () => {
    // Guarda do item 1: se alguém puser `false` de novo "porque o realtime cobre", o CRM volta a
    // congelar quando o socket cair — que é sempre.
    expect(queryClientDoApp.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
  });

  it('canal MORTO + voltar pra aba => recria o canal', async () => {
    montar();
    const caido = await esperarNoAr();

    // O socket morreu enquanto a aba estava em segundo plano — é o caso real.
    caido.state = 'closed';
    act(() => { visibilidade('hidden'); });
    act(() => { visibilidade('visible'); });

    await waitFor(() => expect(canalVivo()).not.toBe(caido));
    expect((await esperarNoAr()).state).toBe('joined');
  });

  it('canal VIVO + voltar pra aba => não recria (não derruba conexão boa)', async () => {
    montar();
    const vivo = await esperarNoAr();
    const antes = canaisCriados.length;

    act(() => { visibilidade('visible'); });
    // Dá tempo de um resubscribe indevido acontecer.
    await new Promise((r) => setTimeout(r, 300));
    expect(canaisCriados).toHaveLength(antes);
    expect(canalVivo()).toBe(vivo);
  });

  it('aba ainda escondida => não tenta reconectar à toa', async () => {
    montar();
    const canal = await esperarNoAr();
    const antes = canaisCriados.length;

    canal.state = 'closed';
    act(() => { visibilidade('hidden'); });
    await new Promise((r) => setTimeout(r, 300));
    expect(canaisCriados).toHaveLength(antes);
  });

  it('volta da rede (evento online) com canal morto => recria', async () => {
    montar();
    const caido = await esperarNoAr();

    caido.state = 'errored';
    act(() => { window.dispatchEvent(new Event('online')); });

    await waitFor(() => expect(canalVivo()).not.toBe(caido));
  });

  /**
   * O CARD REPASSADO TEM QUE APARECER (28/09/2026, caso do Pedro).
   *
   * Passei 12 leads do Denilson para o Pedro e ele viu 4. A RLS entregava os 15 — o problema era
   * o cache: um repasse chega ao NOVO dono como UPDATE de uma linha que ele nunca teve. O handler
   * empurrava o payload cru do Postgres no cache (`[...old, newData]`), em snake_case, sem passar
   * pela normalização `stage_id` → `status` que só roda para card já existente. O Kanban agrupa
   * por `status`: o card ficava no cache e em coluna nenhuma.
   */
  it('UPDATE de card fora do cache => REFETCH, e não linha crua no cache', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidadas: unknown[] = [];
    vi.spyOn(qc, 'invalidateQueries').mockImplementation((args) => {
      invalidadas.push((args as { queryKey?: unknown })?.queryKey);
      return Promise.resolve();
    });
    // Cache com UM card — o que o Pedro já tinha antes do repasse.
    qc.setQueryData(DEALS_VIEW_KEY, [{ id: 'card-que-ja-era-dele', status: 'etapa-1' }]);

    renderHook(() => useRealtimeSync(['deals']), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    const canal = await esperarNoAr();

    act(() => {
      canal.handlers.get('deals')?.({
        eventType: 'UPDATE',
        new: { id: 'card-repassado', stage_id: 'etapa-qualificacao', owner_id: 'pedro', updated_at: '2026-09-28T17:00:00Z' },
        old: { id: 'card-repassado' },
      });
    });

    // Buscou de novo a lista inteira...
    await waitFor(() => expect(invalidadas).toContainEqual(DEALS_VIEW_KEY));
    // ...e NÃO forjou o card a partir do payload.
    const cache = qc.getQueryData<Array<{ id: string }>>(DEALS_VIEW_KEY) ?? [];
    expect(cache.map((d) => d.id)).toEqual(['card-que-ja-era-dele']);
  });

  it('quem usa o hook é NOTIFICADO quando a conexão muda (state, não ref)', async () => {
    // O ponto não é o valor — é o aviso. Com ref puro o valor até muda, mas ninguém re-renderiza
    // para ler, então a tela nunca teria como dizer "você pode estar vendo dado velho". Contamos
    // renders: tem que existir um DEPOIS da conexão subir.
    let renders = 0;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () => { renders += 1; return useRealtimeSync(['messaging_messages']); },
      { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> },
    );

    const rendersAntesDeConectar = renders;
    await waitFor(() => expect(result.current.isConnected).toBe(true));
    expect(renders).toBeGreaterThan(rendersAntesDeConectar);
  });
});
