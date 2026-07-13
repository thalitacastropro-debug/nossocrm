/**
 * Mutations do fluxo áudio→CRM.
 * - useTranscribeCallOutcome: sobe o áudio + devolve a transcrição (F1).
 * - useApplyCallOutcome: aplica o desfecho confirmado (F2+).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEALS_VIEW_KEY, queryKeys } from '../index';
import type { Desfecho } from '@/lib/ai/call-outcome/schemas';

export interface TranscribeResult {
  transcricao: string;
  audioFilePath: string;
  /** Preenchido a partir da F2.4 (extração estruturada do desfecho). */
  desfecho?: Desfecho;
}

export function useTranscribeCallOutcome() {
  return useMutation<TranscribeResult, Error, { dealId: string; audio: Blob }>({
    mutationFn: async ({ dealId, audio }) => {
      const form = new FormData();
      form.set('audio', audio, 'call.webm');
      const res = await fetch(`/api/deals/${dealId}/call-outcome`, { method: 'POST', body: form });
      if (!res.ok) {
        let message = 'Falha ao transcrever o áudio';
        try { const e = (await res.json()) as { error?: string }; if (e?.error) message = e.error; } catch { /* noop */ }
        throw new Error(message);
      }
      return (await res.json()) as TranscribeResult;
    },
  });
}

export interface ApplyCallOutcomeInput {
  dealId: string;
  audioFilePath: string;
  transcricao: string;
  desfecho: Record<string, unknown>;
  conversationId?: string;
  contactId?: string;
}

export function useApplyCallOutcome() {
  const queryClient = useQueryClient();
  return useMutation<{ dealId: string; applied: boolean }, Error, ApplyCallOutcomeInput>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/deals/${input.dealId}/call-outcome/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        let message = 'Falha ao aplicar o desfecho';
        try { const e = (await res.json()) as { error?: string }; if (e?.error) message = e.error; } catch { /* noop */ }
        throw new Error(message);
      }
      return (await res.json()) as { dealId: string; applied: boolean };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    },
  });
}
