/**
 * @fileoverview Reconciliação do "tique" da mensagem enviada.
 *
 * POR QUE ISTO EXISTE (03/09/2026)
 *
 * A rota `POST /api/messaging/messages` grava a mensagem com `status:'pending'` e **responde na
 * hora** com essa linha, antes de falar com o provedor. O envio real acontece depois, em
 * `waitUntil()`, e atualiza `queued` → `sent`/`failed`; o webhook depois marca `delivered`/`read`.
 * Nada disso volta na resposta HTTP, então quem tiraria o relógio da bolha seria o evento UPDATE
 * do realtime.
 *
 * Só que esse evento não chega. A policy `mensagens_select` é um
 * `EXISTS (SELECT 1 FROM messaging_conversations ...)`, e `useRealtimeSync.ts` já registra que a
 * avaliação de RLS no Supabase Realtime falha com policy baseada em JOIN — foi exatamente por isso
 * que o **INSERT** passou a ser injetado direto no cache. O **UPDATE** nunca ganhou esse contorno.
 *
 * A rede de segurança de 26/08 fazia UM refetch aos 4s, apostando que o provedor responde em 1-2s.
 * Em 03/09 um PDF de 606 KB no card TESTE levou **6s** para ser confirmado: o refetch dos 4s
 * encontrou `pending`, não tentou de novo, e a bolha ficou no relógio até um F5 — com a mensagem
 * já entregue no WhatsApp.
 *
 * Por isso a espera aqui é CONDICIONAL (até o status virar terminal) e não um prazo fixo torcendo
 * para o provedor ser rápido. Continua barato: para no primeiro refetch que traz o status final,
 * que no caso típico é o primeiro de todos.
 *
 * @module lib/messaging/reconciliaTique
 */
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';

/**
 * Escalada de esperas. Cobre o envio típico da UAZAPI (1-2s) no primeiro passo e ainda alcança
 * mídia grande, sem virar polling: são no máximo 5 consultas por mensagem enviada, e a série
 * inteira dura ~1 minuto.
 */
export const ATRASOS_DO_TIQUE_MS = [2_000, 4_000, 8_000, 16_000, 32_000];

/** Status a partir dos quais não há mais o que reconciliar — o provedor já respondeu. */
const STATUS_TERMINAIS = new Set(['sent', 'delivered', 'read', 'failed']);

export function ehStatusTerminal(status: unknown): boolean {
  return typeof status === 'string' && STATUS_TERMINAIS.has(status);
}

type MensagemEmCache = { id?: unknown; status?: unknown };
type PaginaEmCache = { messages?: MensagemEmCache[] };
type CacheInfinito = { pages?: PaginaEmCache[] };

/**
 * Lê o status que a tela está exibindo agora. Olha o cache infinito (usado pelo MessageThread) e,
 * como reserva, o cache plano — a bolha pode estar em qualquer um dos dois.
 */
function statusEmCache(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string
): unknown {
  const chave = queryKeys.messagingMessages.byConversation(conversationId);

  const infinito = queryClient.getQueryData<CacheInfinito>([...chave, 'infinite']);
  for (const pagina of infinito?.pages ?? []) {
    const achada = pagina.messages?.find((m) => m?.id === messageId);
    if (achada) return achada.status;
  }

  const plano = queryClient.getQueryData<MensagemEmCache[]>(chave);
  return plano?.find((m) => m?.id === messageId)?.status;
}

/**
 * Agenda refetches até a mensagem enviada sair de `pending`/`queued`.
 *
 * Para assim que o status vira terminal (ou quando a escalada acaba), então uma mensagem normal
 * custa exatamente uma consulta.
 */
export function reconciliaTique(params: {
  queryClient: QueryClient;
  conversationId: string;
  messageId: string;
  atrasosMs?: number[];
}): void {
  const { queryClient, conversationId, messageId, atrasosMs = ATRASOS_DO_TIQUE_MS } = params;
  const chave = queryKeys.messagingMessages.byConversation(conversationId);

  let tentativa = 0;

  const agendaProxima = () => {
    if (tentativa >= atrasosMs.length) return;
    const atraso = atrasosMs[tentativa];
    tentativa += 1;

    setTimeout(() => {
      // O refetch anterior (ou o realtime, quando funciona) já pode ter resolvido.
      if (ehStatusTerminal(statusEmCache(queryClient, conversationId, messageId))) return;

      queryClient.invalidateQueries({ queryKey: chave, refetchType: 'all' });
      agendaProxima();
    }, atraso);
  };

  agendaProxima();
}
