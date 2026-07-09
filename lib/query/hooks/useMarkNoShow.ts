/**
 * Mutation: marca "no-show" num deal do board do Consultor.
 *
 * POST /api/deals/[dealId]/no-show → grava no_show, move o deal de volta pro
 * board da Ana (etapa "Resgate No-show"), reativa a IA e dispara UMA mensagem
 * de resgate. Invalida DEALS_VIEW_KEY para o card sumir do board do Consultor.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEALS_VIEW_KEY } from '../index';

interface MarkNoShowInput {
  dealId: string;
  /** Conversa de mensageria do contato (p/ enviar o resgate). Pode ser ausente. */
  conversationId?: string;
  /** Contato vinculado ao deal (p/ reativar a IA cross-channel). */
  contactId?: string;
}

interface MarkNoShowResult {
  dealId: string;
  moved?: boolean;
  messageSent?: boolean;
  already_marked?: boolean;
}

/**
 * Hook React `useMarkNoShow`.
 * @returns {UseMutationResult<MarkNoShowResult, Error, MarkNoShowInput>} mutation.
 */
export function useMarkNoShow() {
  const queryClient = useQueryClient();

  return useMutation<MarkNoShowResult, Error, MarkNoShowInput>({
    mutationFn: async ({ dealId, conversationId, contactId }) => {
      const res = await fetch(`/api/deals/${dealId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, contactId }),
      });

      if (!res.ok) {
        let message = 'Falha ao marcar no-show';
        try {
          const err = (await res.json()) as { error?: string };
          if (err?.error) message = err.error;
        } catch {
          // resposta sem corpo JSON — mantém a mensagem padrão
        }
        throw new Error(message);
      }

      return (await res.json()) as MarkNoShowResult;
    },
    // Deal muda de board → invalida a fonte única de verdade dos cards.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    },
  });
}
