'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2, Loader2 } from 'lucide-react';
import AudioPlayer from '@/components/ui/AudioPlayer';
import { useTranscribeCallOutcome, type TranscribeResult } from '@/lib/query/hooks/useCallOutcome';

interface VoiceOutcomeCaptureProps {
  dealId: string;
  /** Apenas para testes: entra direto no estado de revisão. */
  __testInitialReview?: TranscribeResult;
}

const PREFERRED_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];

export function VoiceOutcomeCapture({ dealId, __testInitialReview }: VoiceOutcomeCaptureProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [review, setReview] = useState<TranscribeResult | null>(__testInitialReview ?? null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const transcribe = useTranscribeCallOutcome();

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
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      setLocalAudioUrl(URL.createObjectURL(blob));
      try {
        const result = await transcribe.mutateAsync({ dealId, audio: blob });
        setReview(result);
      } catch { /* erro exposto via transcribe.isError */ }
    };
    recorder.stop();
  }, [dealId, transcribe]);

  const discard = useCallback(() => {
    setReview(null);
    if (localAudioUrl) { URL.revokeObjectURL(localAudioUrl); setLocalAudioUrl(null); }
    setDuration(0);
  }, [localAudioUrl]);

  // Estado de revisão (F1: só transcrição + player; campos editáveis na F2)
  if (review) {
    return (
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-sm space-y-3">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Desfecho da call (revisão)</h4>
        {localAudioUrl && <AudioPlayer src={localAudioUrl} variant="preview" />}
        <p className="text-sm text-slate-900 dark:text-white whitespace-pre-wrap">{review.transcricao}</p>
        <div className="flex justify-end">
          <button
            onClick={discard}
            className="text-xs font-bold text-slate-500 hover:text-red-500 flex items-center gap-1.5"
          >
            <Trash2 size={14} /> Descartar
          </button>
        </div>
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
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {isRecording ? `Gravando… ${duration}s` : 'Gravar o desfecho da call'}
            </p>
            <p className="text-xs text-slate-400">
              {isRecording ? 'Toque pra parar e transcrever' : 'Fale o resultado: fechou, próximos passos, valores'}
            </p>
          </div>
        </div>
      )}
      {transcribe.isError && (
        <p className="mt-2 text-xs text-red-500">{transcribe.error.message}</p>
      )}
    </div>
  );
}
