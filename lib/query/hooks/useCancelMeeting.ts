/**
 * Mutation: cancela a reunião marcada de um deal do board do Consultor.
 *
 * POST /api/deals/[dealId]/cancel-meeting → soft-delete da activity (CALL) +
 * reuniao_agendada.status='cancelada' + remove a tag. NÃO move o card nem marca
 * perdido. Invalida DEALS_VIEW_KEY para o card refletir o estado (some da agenda,
 * e a cadência 3 para de mandar lembrete porque a activity foi deletada).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEALS_VIEW_KEY } from '../index';

interface CancelMeetingInput {
  dealId: string;
}

interface CancelMeetingResult {
  dealId: string;
  cancelled?: boolean;
  already_cancelled?: boolean;
}

/**
 * Hook React `useCancelMeeting`.
 * @returns {UseMutationResult<CancelMeetingResult, Error, CancelMeetingInput>} mutation.
 */
export function useCancelMeeting() {
  const queryClient = useQueryClient();

  return useMutation<CancelMeetingResult, Error, CancelMeetingInput>({
    mutationFn: async ({ dealId }) => {
      const res = await fetch(`/api/deals/${dealId}/cancel-meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        let message = 'Falha ao cancelar a reunião';
        try {
          const err = (await res.json()) as { error?: string };
          if (err?.error) message = err.error;
        } catch {
          // resposta sem corpo JSON — mantém a mensagem padrão
        }
        throw new Error(message);
      }

      return (await res.json()) as CancelMeetingResult;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    },
  });
}
