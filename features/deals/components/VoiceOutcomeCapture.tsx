'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, Loader2, Check, PencilLine } from 'lucide-react';
import AudioPlayer from '@/components/ui/AudioPlayer';
import { useTranscribeCallOutcome, useApplyCallOutcome, type TranscribeResult } from '@/lib/query/hooks/useCallOutcome';
import type { Desfecho } from '@/lib/ai/call-outcome/schemas';
import { MOTIVO_LABELS, MOTIVO_TAGS, type MotivoTag } from '@/lib/ai/taxonomy/motivos';
import { convertAudioToMp3 } from '@/lib/utils/audioToMp3';

interface VoiceOutcomeCaptureProps {
  dealId: string;
  /** Apenas para testes: entra direto no estado de revisão. */
  __testInitialReview?: TranscribeResult;
}

const PREFERRED_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];

/**
 * O desfecho vazio do preenchimento MANUAL (pedido dela em 09/09: *"tem que ter a versão manual
 * tb"*). O formulário completo já existia — a única porta para chegar nele era gravar um áudio.
 *
 * `desfecho: ''` é de propósito: o select abre SEM escolha e o Confirmar fica travado até alguém
 * dizer o que houve. Um default ("fechou", "vai_pensar") seria confirmado sem leitura — e este é o
 * campo que move o card de funil, marca a venda, dispara lembrete de reabordagem e carimba a
 * reunião como realizada. Default aqui é o caminho mais curto para dado ruim.
 *
 * `confidence: 1` porque não há extração: é uma pessoa afirmando o que aconteceu.
 */
const DESFECHO_EM_BRANCO: Desfecho = {
  desfecho: '' as unknown as Desfecho['desfecho'],
  nota_resumo: '',
  tarefas: [],
  dados_negocio: { operadora: null, vidas: null, valor: null },
  objecoes: [],
  motivo_perda: null,
  motivo_perda_detalhe: null,
  reabordar_em: null,
  confidence: 1,
};

export function VoiceOutcomeCapture({ dealId, __testInitialReview }: VoiceOutcomeCaptureProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [review, setReview] = useState<TranscribeResult | null>(__testInitialReview ?? null);
  /** Entrou pelo caminho escrito: mesmo formulário, sem áudio nem transcrição. */
  const [modoManual, setModoManual] = useState(false);
  const [edited, setEdited] = useState<Desfecho | null>(__testInitialReview?.desfecho ?? null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const transcribe = useTranscribeCallOutcome();
  const apply = useApplyCallOutcome();

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    const r = mediaRecorderRef.current;
    if (r && r.state !== 'inactive') r.stream?.getTracks().forEach((t) => t.stop());
    if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
  }, [localAudioUrl]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(100);
      setIsRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch { /* mic negado — falha silenciosa */ }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    recorder.onstop = async () => {
      recorder.stream?.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
      const type = recorder.mimeType.split(';')[0] || 'audio/webm';
      let blob: Blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      setLocalAudioUrl(URL.createObjectURL(blob));
      // webm (Chrome/Edge) e mp4 (Safari) → mp3: o Gemini aceita mp3/ogg sem
      // ambiguidade; a docs de webm é contraditória. Best-effort: se a
      // conversão falhar (lamejs ausente), manda o original mesmo.
      if (type !== 'audio/ogg') {
        try { blob = await convertAudioToMp3(blob); } catch { /* usa o original */ }
      }
      try {
        const result = await transcribe.mutateAsync({ dealId, audio: blob });
        setReview(result);
        if (result.desfecho) setEdited(result.desfecho);
      } catch { /* erro exposto via transcribe.isError */ }
    };
    recorder.stop();
  }, [dealId, transcribe]);

  const discard = useCallback(() => {
    setReview(null);
    setEdited(null);
    setModoManual(false);
    if (localAudioUrl) { URL.revokeObjectURL(localAudioUrl); setLocalAudioUrl(null); }
    setDuration(0);
  }, [localAudioUrl]);

  const abrirManual = useCallback(() => {
    setModoManual(true);
    setEdited({ ...DESFECHO_EM_BRANCO });
  }, []);

  // Formulário do desfecho — o MESMO para quem ditou e para quem escreve. A única diferença é o
  // que veio pronto: no áudio, os campos chegam preenchidos pela transcrição; no manual, vazios.
  if ((review || modoManual) && edited) {
    const set = (patch: Partial<Desfecho>) => setEdited({ ...edited, ...patch });
    const setDados = (patch: Partial<Desfecho['dados_negocio']>) =>
      setEdited({ ...edited, dados_negocio: { ...edited.dados_negocio, ...patch } });
    return (
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm space-y-3">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          {review ? 'Desfecho da call (revisão)' : 'Desfecho da call'}
        </h4>
        {localAudioUrl && <AudioPlayer src={localAudioUrl} variant="preview" />}
        {review && (
          <p className="text-[11px] text-slate-400 whitespace-pre-wrap border-l-2 border-slate-200 dark:border-white/10 pl-2">{review.transcricao}</p>
        )}

        <label className="block text-xs">
          <span className="text-slate-400">Desfecho</span>
          <select
            aria-label="Desfecho"
            value={edited.desfecho}
            onChange={(e) => {
              const v = e.target.value as Desfecho['desfecho'];
              // Ao virar 'perdeu' sem motivo da IA, default 'outro' — garante
              // que o apply grave motivo_perda/loss_reason (o select exibe isso).
              set(v === 'perdeu' && !edited.motivo_perda ? { desfecho: v, motivo_perda: 'outro' } : { desfecho: v });
            }}
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
          >
            {/* Só existe enquanto ninguém escolheu — some depois de a pessoa decidir. */}
            {!edited.desfecho && <option value="">— o que aconteceu? —</option>}
            <option value="fechou">Fechou</option>
            <option value="vai_pensar">Vai pensar</option>
            <option value="perdeu">Perdeu</option>
            <option value="remarcar">Remarcar</option>
            <option value="nao_atendeu">Não atendeu</option>
          </select>
        </label>

        <label className="block text-xs">
          <span className="text-slate-400">Resumo</span>
          <textarea
            value={edited.nota_resumo}
            onChange={(e) => set({ nota_resumo: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm min-h-[60px]"
          />
        </label>

        {/* Motivo de perda: obrigatório expor quando o consultor marca Perdeu —
            senão o motivo some (achado da revisão adversarial). */}
        {edited.desfecho === 'perdeu' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">
              <span className="text-slate-400">Motivo da perda</span>
              <select
                value={edited.motivo_perda ?? 'outro'}
                onChange={(e) => set({ motivo_perda: e.target.value as MotivoTag })}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
              >
                {MOTIVO_TAGS.map((tag) => (
                  <option key={tag} value={tag}>{MOTIVO_LABELS[tag]}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="text-slate-400">Detalhe (opcional)</span>
              <input
                value={edited.motivo_perda_detalhe ?? ''}
                onChange={(e) => set({ motivo_perda_detalhe: e.target.value || null })}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <label className="block text-xs">
            <span className="text-slate-400">Operadora</span>
            <input
              value={edited.dados_negocio.operadora ?? ''}
              onChange={(e) => setDados({ operadora: e.target.value || null })}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-slate-400">Vidas</span>
            <input
              type="number" value={edited.dados_negocio.vidas ?? ''}
              onChange={(e) => setDados({ vidas: e.target.value ? Number(e.target.value) : null })}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
          {/* O MESMO campo significa coisas opostas conforme o desfecho, e o rótulo tem que dizer
              qual: em "fechou" é o PRÊMIO do plano comprado (vira `venda.premio_mensal`, o número
              que fecha o mês); nos outros é a mensalidade que o lead paga HOJE no plano antigo
              (vira `qualificacao.valor_pago_exato`, o gatilho da conversa). Um rótulo genérico
              "Valor" era o que fazia o prêmio ser digitado no campo errado. */}
          <label className="block text-xs">
            <span className="text-slate-400">
              {edited.desfecho === 'fechou' ? 'Prêmio (plano vendido)' : 'Valor que paga hoje'}
            </span>
            <input
              type="number" value={edited.dados_negocio.valor ?? ''}
              onChange={(e) => setDados({ valor: e.target.value ? Number(e.target.value) : null })}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        {edited.tarefas.length > 0 && (
          <div className="text-xs">
            <span className="text-slate-400">Tarefas ({edited.tarefas.length})</span>
            <ul className="mt-1 space-y-1">
              {edited.tarefas.map((t, i) => (
                <li key={i} className="text-slate-900 dark:text-white">• {t.descricao}{t.data ? ` — ${new Date(t.data).toLocaleString('pt-BR')}` : ''}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-between items-center pt-1">
          <button onClick={discard} className="text-xs font-bold text-slate-500 hover:text-red-500 flex items-center gap-1.5">
            <Trash2 size={14} /> Descartar
          </button>
          <button
            onClick={() => apply.mutate(
              {
                dealId,
                // No manual não há áudio nem transcrição — a rota já trata os dois como opcionais.
                audioFilePath: review?.audioFilePath,
                transcricao: review?.transcricao,
                desfecho: edited as unknown as Record<string, unknown>,
              },
              { onSuccess: discard },
            )}
            // Sem desfecho escolhido não há o que aplicar: é ele que move o card, marca a venda e
            // dispara o lembrete.
            disabled={apply.isPending || !edited.desfecho}
            className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2"
          >
            <Check size={14} /> {apply.isPending ? 'Salvando…' : 'Confirmar'}
          </button>
        </div>
        {apply.isError && <p className="text-xs text-red-500">{apply.error.message}</p>}
      </div>
    );
  }

  // Estado ocioso / gravando / transcrevendo
  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm">
      {transcribe.isPending ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Transcrevendo o áudio…
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            aria-label={isRecording ? 'Parar gravação' : 'Gravar desfecho da call'}
            className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 ${
              isRecording
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-primary-600 hover:bg-primary-500 text-white'
            }`}
          >
            {isRecording ? <Square size={18} fill="currentColor" /> : <Mic size={18} />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {isRecording ? `Gravando… ${duration}s` : 'Gravar o desfecho da call'}
            </p>
            <p className="text-xs text-slate-400">
              {isRecording ? 'Toque pra parar e transcrever' : 'Fale o resultado: fechou, próximos passos, valores'}
            </p>
            {/* A alternativa a ditar. Não é uma segunda tela: leva ao MESMO formulário, vazio.
                Quem está em escritório aberto, no ônibus ou só prefere escrever não tinha por
                onde registrar — e o desfecho não registrado é o que some dos índices. */}
            {!isRecording && (
              <button
                type="button"
                onClick={abrirManual}
                className="mt-1.5 text-xs font-bold text-primary-600 hover:text-primary-500 flex items-center gap-1.5"
              >
                <PencilLine size={13} /> Preencher à mão
              </button>
            )}
          </div>
        </div>
      )}
      {transcribe.isError && (
        <p className="mt-2 text-xs text-red-500">{transcribe.error.message}</p>
      )}
    </div>
  );
}
