/**
 * Mutations do fluxo áudio→CRM.
 * - useTranscribeCallOutcome: sobe o áudio (ou retoma um já salvo) + devolve a transcrição (F1).
 * - useApplyCallOutcome: aplica o desfecho confirmado (F2+).
 * - useGravacoesPendentes / useDescartarGravacao: gravações do card que ainda não viraram
 *   desfecho (ver app/api/deals/[dealId]/call-outcome/route.ts — caso Alan Ferreira, 08/10).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEALS_VIEW_KEY, queryKeys } from '../index';
import type { Desfecho } from '@/lib/ai/call-outcome/schemas';

export interface TranscribeResult {
  transcricao: string;
  audioFilePath: string;
  /** Preenchido a partir da F2.4 (extração estruturada do desfecho). */
  desfecho?: Desfecho;
}

export interface GravacaoPendente {
  audioFilePath: string;
  criadoEm: string;
  erro: string | null;
  erroEm: string | null;
  temTranscricao: boolean;
  audioUrl: string | null;
}

/**
 * Erro da transcrição que sabe se o áudio ficou salvo. Com `audioFilePath`, a gravação está no
 * card e aparece em "Retomar"; sem ele, o áudio não chegou ao servidor e só o navegador o tem.
 */
export class TranscribeError extends Error {
  constructor(message: string, readonly audioFilePath: string | null) {
    super(message);
    this.name = 'TranscribeError';
  }
}

export const gravacoesPendentesKey = (dealId: string) => ['call-outcome', 'pendentes', dealId] as const;

export function useGravacoesPendentes(dealId: string) {
  return useQuery<GravacaoPendente[]>({
    queryKey: gravacoesPendentesKey(dealId),
    queryFn: async () => {
      const res = await fetch(`/api/deals/${dealId}/call-outcome`);
      if (!res.ok) return [];
      const body = (await res.json()) as { pendentes?: GravacaoPendente[] };
      return body.pendentes ?? [];
    },
    staleTime: 30_000,
  });
}

type TranscribeInput = { dealId: string; audio: Blob } | { dealId: string; audioFilePath: string };

export function useTranscribeCallOutcome() {
  const queryClient = useQueryClient();
  return useMutation<TranscribeResult, Error, TranscribeInput>({
    mutationFn: async (input) => {
      const url = `/api/deals/${input.dealId}/call-outcome`;
      let res: Response;
      if ('audio' in input) {
        const form = new FormData();
        form.set('audio', input.audio, 'call.webm');
        res = await fetch(url, { method: 'POST', body: form });
      } else {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioFilePath: input.audioFilePath }),
        });
      }
      if (!res.ok) {
        let message = 'Falha ao transcrever o áudio';
        let audioFilePath: string | null = 'audioFilePath' in input ? input.audioFilePath : null;
        try {
          const e = (await res.json()) as { error?: string; audioFilePath?: string };
          if (e?.error) message = e.error;
          if (e?.audioFilePath) audioFilePath = e.audioFilePath;
        } catch { /* noop — ex.: o 504 da Vercel devolve HTML */ }
        throw new TranscribeError(message, audioFilePath);
      }
      return (await res.json()) as TranscribeResult;
    },
    // Deu certo ou não, a lista de pendentes mudou: a gravação nova entrou nela (e sai no apply).
    onSettled: (_d, _e, input) => {
      queryClient.invalidateQueries({ queryKey: gravacoesPendentesKey(input.dealId) });
    },
  });
}

export function useDescartarGravacao() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { dealId: string; audioFilePath: string }>({
    mutationFn: async ({ dealId, audioFilePath }) => {
      const res = await fetch(`/api/deals/${dealId}/call-outcome/discard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioFilePath }),
      });
      if (!res.ok) {
        let message = 'Falha ao descartar a gravação';
        try { const e = (await res.json()) as { error?: string }; if (e?.error) message = e.error; } catch { /* noop */ }
        throw new Error(message);
      }
    },
    onSettled: (_d, _e, input) => {
      queryClient.invalidateQueries({ queryKey: gravacoesPendentesKey(input.dealId) });
    },
  });
}

export interface ApplyCallOutcomeInput {
  dealId: string;
  /** Ausentes no preenchimento MANUAL — só o caminho por voz tem áudio e transcrição. */
  audioFilePath?: string;
  transcricao?: string;
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
    onSettled: (_d, _e, input) => {
      queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      queryClient.invalidateQueries({ queryKey: gravacoesPendentesKey(input.dealId) });
    },
  });
}
