/**
 * O RELÓGIO QUE NÃO SAI DA BOLHA (03/09/2026).
 *
 * A rota POST /api/messaging/messages responde na hora com a mensagem em 'pending' e só depois,
 * em background, envia ao provedor e grava 'sent'/'failed'. Quem tiraria o relógio da tela é o
 * evento UPDATE do realtime — que não chega (a policy `mensagens_select` é um EXISTS sobre
 * messaging_conversations, e o próprio código já registra que a avaliação de RLS no Realtime falha
 * com policy baseada em JOIN; foi por isso que o INSERT passou a ser injetado direto no cache).
 *
 * A rede de segurança de 26/08 fazia UM refetch aos 4s. Em 03/09 a Thalita mandou um PDF de 606 KB
 * no card TESTE: a UAZAPI só confirmou aos 6s. O refetch dos 4s encontrou 'pending', não tentou de
 * novo, e a bolha ficou no relógio até ela dar F5 — com a mensagem já entregue no WhatsApp.
 *
 * A espera tem que ser CONDICIONAL (até o status virar terminal), não um prazo fixo torcendo para
 * o provedor ser rápido.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { reconciliaTique } from '@/lib/messaging/reconciliaTique';

const CONVERSA = '4b02d1d8-24dd-4a73-92e4-2982f656f4e6';
const MENSAGEM = '0bd6bf69-a9d1-48c1-a8d7-93c4b677bdc5';

function chaveInfinita(conversationId: string) {
  return [...queryKeys.messagingMessages.byConversation(conversationId), 'infinite'] as const;
}

function clientComMensagem(status: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(chaveInfinita(CONVERSA), {
    pages: [{ messages: [{ id: MENSAGEM, status }], nextCursor: null }],
    pageParams: [undefined],
  });
  return queryClient;
}

function statusNoCacheVira(queryClient: QueryClient, status: string) {
  queryClient.setQueryData(chaveInfinita(CONVERSA), {
    pages: [{ messages: [{ id: MENSAGEM, status }], nextCursor: null }],
    pageParams: [undefined],
  });
}

describe('reconciliaTique — o relógio da bolha enviada', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('tenta de novo quando o provedor demora mais que a primeira janela', () => {
    // O caso do PDF de 606 KB: aos 2s o banco ainda diz 'pending'.
    const queryClient = clientComMensagem('pending');
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined as unknown as void);

    reconciliaTique({ queryClient, conversationId: CONVERSA, messageId: MENSAGEM });

    vi.advanceTimersByTime(2_000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // O refetch voltou e a mensagem SEGUE pending — o provedor ainda não confirmou.
    // A rede antiga desistia aqui. Esta não pode desistir.
    vi.advanceTimersByTime(4_000);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  test('para de tentar assim que a mensagem chega em status terminal', () => {
    const queryClient = clientComMensagem('pending');
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined as unknown as void);

    reconciliaTique({ queryClient, conversationId: CONVERSA, messageId: MENSAGEM });

    vi.advanceTimersByTime(2_000);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // O refetch trouxe 'sent' do banco.
    statusNoCacheVira(queryClient, 'sent');

    vi.advanceTimersByTime(120_000);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  test('não fica tentando para sempre quando o provedor nunca confirma', () => {
    const queryClient = clientComMensagem('pending');
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined as unknown as void);

    reconciliaTique({ queryClient, conversationId: CONVERSA, messageId: MENSAGEM });

    vi.advanceTimersByTime(600_000);

    const tentativas = invalidate.mock.calls.length;
    expect(tentativas).toBeGreaterThan(1);
    expect(tentativas).toBeLessThanOrEqual(6);
  });
});
