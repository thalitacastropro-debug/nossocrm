import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RoadmapPage, { CartaoDoRoadmap } from './RoadmapPage';
import type { RoadmapItem } from '@/lib/roadmap/types';

/** O papel de quem está olhando a tela — cada teste ajusta antes de montar. */
let papelAtual: 'admin' | 'vendedor' = 'admin';
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: papelAtual } }),
}));

/**
 * O kanban do roadmap (01/09/2026) trocou o seletor por arrastar — e arrastar é
 * exatamente o gesto capaz de atropelar as duas travas do mural:
 *
 *   1. só admin muda de etapa;
 *   2. recusar exige motivo escrito.
 *
 * A RLS e a rota barram as duas de verdade; estes testes garantem que a TELA não
 * ofereça o caminho que terminaria em 403 nem um gesto que o servidor recusaria
 * depois — que é o que faria o admin achar que recusou quando não recusou.
 */

const itemBase: RoadmapItem = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Ver o histórico do cliente no card',
  description: null,
  area: 'card',
  status: 'sugerido',
  autor: 'Pedro Sellan',
  souOAutor: false,
  decididoPor: null,
  decididoEm: null,
  decisao: null,
  votos: 3,
  votei: false,
  criadoEm: '2026-08-31T12:00:00.000Z',
  atualizadoEm: '2026-08-31T12:00:00.000Z',
};

const acoes = {
  onArrastar: vi.fn(),
  onSoltar: vi.fn(),
  onVotar: vi.fn(),
  onMover: vi.fn(),
  onApagar: vi.fn(),
};

const montar = (item: RoadmapItem, ehAdmin: boolean, pedindoMotivo = false) =>
  render(
    <CartaoDoRoadmap
      item={item}
      ehAdmin={ehAdmin}
      sendoArrastado={false}
      pedindoMotivo={pedindoMotivo}
      {...acoes}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe('Cartão do roadmap — quem pode mover', () => {
  it('não deixa o colaborador arrastar nem escolher etapa', () => {
    montar(itemBase, false);

    expect(screen.getByRole('article').getAttribute('draggable')).toBe('false');
    expect(screen.queryByLabelText(/^Etapa de /)).toBeNull();
    // Votar continua sendo de todo mundo — é o que o mural pede do time.
    expect(screen.getByRole('button', { name: 'Votar nesta melhoria' })).toBeTruthy();
  });

  it('deixa o admin arrastar', () => {
    montar(itemBase, true);

    expect(screen.getByRole('article').getAttribute('draggable')).toBe('true');
    expect(screen.getByLabelText(/^Etapa de /)).toBeTruthy();
  });
});

describe('Cartão do roadmap — recusar exige motivo', () => {
  it('não recusa com o campo de motivo vazio', () => {
    montar(itemBase, true);

    fireEvent.change(screen.getByLabelText(/^Etapa de /), { target: { value: 'recusado' } });

    expect(acoes.onMover).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Escreva o motivo para poder recusar')).toBeTruthy();
  });

  it('recusa quando o motivo está escrito', () => {
    montar(itemBase, true);

    fireEvent.change(screen.getByLabelText(/^Decisão sobre /), {
      target: { value: 'Já resolvido pela visão 360 do cliente.' },
    });
    fireEvent.change(screen.getByLabelText(/^Etapa de /), { target: { value: 'recusado' } });

    expect(acoes.onMover).toHaveBeenCalledWith('recusado', 'Já resolvido pela visão 360 do cliente.');
  });

  it('oferece fechar a recusa que o arrastar deixou pela metade', () => {
    // A coluna "Não vai ser feito" recebeu o card e devolveu o pedido de motivo:
    // o admin escreve e conclui ali mesmo, sem voltar ao seletor.
    montar(itemBase, true, true);

    expect(screen.queryByRole('button', { name: 'Recusar com este motivo' })).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Decisão sobre /), {
      target: { value: 'Fora do escopo por enquanto.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Recusar com este motivo' }));

    expect(acoes.onMover).toHaveBeenCalledWith('recusado', 'Fora do escopo por enquanto.');
  });
});

// ---------------------------------------------------------------- a tela toda
// O que os testes acima não pegam: o gesto de SOLTAR numa coluna. É ali que a
// tela decide se escreve, e é o caminho novo do kanban.

const APROVADO: RoadmapItem = {
  ...itemBase,
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Som de mensagem nova',
  status: 'aprovado',
  votos: 1,
};

/** Fingimos a rede: GET devolve os dois itens, PATCH responde OK. Guardamos as
 *  chamadas para poder afirmar que a recusa sem motivo NÃO chegou ao servidor. */
function fingirRede() {
  const chamadas: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    chamadas.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET') {
      return { ok: true, json: async () => ({ itens: [itemBase, APROVADO] }) } as Response;
    }
    return { ok: true, json: async () => ({ ok: true }) } as Response;
  });
  vi.stubGlobal('fetch', fetchFalso);
  return chamadas;
}

function montarTela() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoadmapPage />
    </QueryClientProvider>,
  );
}

/** Solta o card `id` na coluna cujo rótulo acessível começa por `titulo`. */
function soltarEm(titulo: string, id: string) {
  const coluna = screen.getByRole('listitem', { name: new RegExp(`^Coluna ${titulo}:`) });
  fireEvent.drop(coluna, { dataTransfer: { getData: () => id } });
}

const patches = (chamadas: Array<{ method: string }>) => chamadas.filter((c) => c.method === 'PATCH');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  papelAtual = 'admin';
});

describe('Roadmap em kanban — soltar o card na coluna', () => {
  it('mostra as cinco etapas como colunas, com a contagem de cada uma', async () => {
    fingirRede();
    montarTela();

    await screen.findByText('Ver o histórico do cliente no card');
    expect(screen.getByRole('listitem', { name: /^Coluna Sugerido: 1 item$/ })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: /^Coluna Aprovado: 1 item$/ })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: /^Coluna Em andamento: 0 itens$/ })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: /^Coluna Feito: 0 itens$/ })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: /^Coluna Não vai ser feito: 0 itens$/ })).toBeTruthy();
  });

  it('soltar em "Aprovado" muda a etapa', async () => {
    const chamadas = fingirRede();
    montarTela();
    await screen.findByText('Ver o histórico do cliente no card');

    soltarEm('Aprovado', itemBase.id);

    await waitFor(() => expect(patches(chamadas)).toHaveLength(1));
    expect(patches(chamadas)[0]).toMatchObject({
      url: `/api/roadmap/${itemBase.id}`,
      body: { status: 'aprovado' },
    });
  });

  it('soltar em "Não vai ser feito" sem motivo NÃO recusa — pede o motivo', async () => {
    const chamadas = fingirRede();
    montarTela();
    await screen.findByText('Ver o histórico do cliente no card');

    soltarEm('Não vai ser feito', itemBase.id);

    expect(await screen.findByRole('alert')).toHaveTextContent(/motivo antes de recusar/i);
    expect(patches(chamadas)).toHaveLength(0);
    // E o card continua onde estava.
    expect(screen.getByRole('listitem', { name: /^Coluna Sugerido: 1 item$/ })).toBeTruthy();
  });

  it('soltar na própria coluna não escreve nada', async () => {
    const chamadas = fingirRede();
    montarTela();
    await screen.findByText('Ver o histórico do cliente no card');

    soltarEm('Sugerido', itemBase.id);

    expect(patches(chamadas)).toHaveLength(0);
  });

  it('para o colaborador nenhum card é arrastável', async () => {
    papelAtual = 'vendedor';
    fingirRede();
    montarTela();
    await screen.findByText('Ver o histórico do cliente no card');

    for (const card of screen.getAllByRole('article')) {
      expect(card.getAttribute('draggable')).toBe('false');
    }
    expect(screen.queryByLabelText(/^Etapa de /)).toBeNull();
  });
});
