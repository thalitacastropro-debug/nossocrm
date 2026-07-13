/**
 * Mutation: marca "Reunião realizada" num deal (par positivo do No-show).
 *
 * POST /api/deals/[dealId]/meeting-held → completa a CALL agendada (ou cria
 * MEETING completed p/ lead sem agendamento da Ana) + grava
 * custom_fields.reuniao_realizada. NÃO move de board. Alimenta a métrica
 * Agendadas → Realizadas.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEALS_VIEW_KEY, queryKeys } from '../index';

interface MarkMeetingHeldInput {
  dealId: string;
}

interface MarkMeetingHeldResult {
  dealId: string;
  marked?: boolean;
  already_marked?: boolean;
}

/**
 * Hook React `useMarkMeetingHeld`.
 * @returns mutation que marca a reunião do deal como realizada.
 */
export function useMarkMeetingHeld() {
  const queryClient = useQueryClient();

  return useMutation<MarkMeetingHeldResult, Error, MarkMeetingHeldInput>({
    mutationFn: async ({ dealId }) => {
      const res = await fetch(`/api/deals/${dealId}/meeting-held`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      if (!res.ok) {
        let message = 'Falha ao marcar reunião realizada';
        try {
          const err = (await res.json()) as { error?: string };
          if (err?.error) message = err.error;
        } catch {
          // resposta sem corpo JSON — mantém a mensagem padrão
        }
        throw new Error(message);
      }

      return (await res.json()) as MarkMeetingHeldResult;
    },
    // Muda custom_fields do deal + completa activity → invalida os dois caches.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    },
  });
}
