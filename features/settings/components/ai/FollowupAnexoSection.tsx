'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Trash2, Upload, Video, FileText, Image as ImageIcon, Music } from 'lucide-react';
import { useToast } from '@/context/ToastContext';

interface Anexo {
  url: string;
  caminho?: string;
  tipo: 'video' | 'image' | 'audio' | 'document';
  toqueIndex: number;
  fileName?: string;
  legenda?: string;
  comoGravacao?: boolean;
}

/**
 * Os quatro toques da cadência fria, com o prazo real de cada um
 * (`COLD_SCHEDULE_MS` em lib/ai/followup/schedule.ts). Mostrar o prazo evita a
 * pergunta "qual é o 3º mesmo?" na hora de escolher.
 */
const TOQUES = [
  { index: 0, rotulo: '1º toque — 3 horas depois' },
  { index: 1, rotulo: '2º toque — 1 dia' },
  { index: 2, rotulo: '3º toque — 4 dias' },
  { index: 3, rotulo: '4º toque — 10 dias (último)' },
];

const ICONE = {
  video: Video,
  image: ImageIcon,
  audio: Music,
  document: FileText,
};

/**
 * Anexo dos toques de follow-up.
 *
 * A Thalita grava um vídeo uma vez e ele passa a acompanhar o toque escolhido —
 * por padrão o **3º** (decisão dela em 25/08/2026). O 1º toque aparece com aviso:
 * mídia para quem nunca respondeu é o disparo que mais chama atenção do WhatsApp,
 * e a conta da Niva é nova.
 */
export const FollowupAnexoSection: React.FC = () => {
  const { addToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [anexo, setAnexo] = useState<Anexo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [toqueIndex, setToqueIndex] = useState(2);
  const [legenda, setLegenda] = useState('');
  const [comoGravacao, setComoGravacao] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/followup-anexo', { credentials: 'include' });
      const data = await res.json();
      if (data?.anexo) {
        setAnexo(data.anexo);
        setToqueIndex(data.anexo.toqueIndex ?? 2);
        setLegenda(data.anexo.legenda ?? '');
        setComoGravacao(!!data.anexo.comoGravacao);
      }
    } catch {
      /* silencioso: a seção só não mostra anexo */
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const enviar = async (file: File) => {
    setEnviando(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('toqueIndex', String(toqueIndex));
      form.append('legenda', legenda);
      form.append('comoGravacao', String(comoGravacao));

      const res = await fetch('/api/settings/followup-anexo', {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || 'Falha ao subir o arquivo');

      setAnexo(data.anexo);
      addToast('Anexo salvo — vai junto do toque escolhido', 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao subir o arquivo', 'error');
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remover = async () => {
    if (!window.confirm('Tirar o anexo da cadência? Os toques voltam a ser só texto.')) return;
    try {
      const res = await fetch('/api/settings/followup-anexo', { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error();
      setAnexo(null);
      addToast('Anexo removido', 'success');
    } catch {
      addToast('Não consegui remover', 'error');
    }
  };

  const Icone = anexo ? ICONE[anexo.tipo] : Upload;

  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Video className="w-4 h-4 text-slate-400" />
          Anexo do follow-up
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
          Um vídeo (ou arquivo) que a Ana envia junto de um dos toques, para todo lead que chegar
          nele. O arquivo sobe uma vez e vale para todos.
        </p>
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="space-y-4">
          {anexo && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
              <Icone className="w-5 h-5 text-primary-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {anexo.fileName || 'Arquivo'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {TOQUES.find((t) => t.index === anexo.toqueIndex)?.rotulo ?? `Toque ${anexo.toqueIndex + 1}`}
                  {anexo.comoGravacao && anexo.tipo === 'video' && ' · como vídeo bolinha'}
                </p>
              </div>
              <button
                onClick={remover}
                className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                title="Remover anexo"
                aria-label="Remover anexo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          <div>
            <label htmlFor="toque-anexo" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Em qual toque
            </label>
            <select
              id="toque-anexo"
              value={toqueIndex}
              onChange={(e) => setToqueIndex(Number(e.target.value))}
              className="w-full max-w-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
            >
              {TOQUES.map((t) => (
                <option key={t.index} value={t.index}>
                  {t.rotulo}
                </option>
              ))}
            </select>

            {toqueIndex === 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Mídia no primeiro contato é o disparo que mais chama atenção do WhatsApp, e a conta
                da Niva é nova. Do 2º toque em diante o risco é bem menor.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="legenda-anexo" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Legenda <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="legenda-anexo"
              value={legenda}
              onChange={(e) => setLegenda(e.target.value)}
              placeholder="Gravei esse vídeo rapidinho pra você"
              className="w-full max-w-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={comoGravacao}
              onChange={(e) => setComoGravacao(e.target.checked)}
              className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            Enviar vídeo como <strong>bolinha</strong> (redondo, igual gravação pela câmera)
          </label>

          <div className="pt-2">
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,image/jpeg,image/png,audio/mpeg,audio/ogg,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) enviar(file);
              }}
              className="hidden"
            />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={enviando}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 transition-colors"
            >
              {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {anexo ? 'Trocar arquivo' : 'Escolher arquivo'}
            </button>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              MP4, JPG, PNG, MP3 ou PDF, até 25 MB. Para vídeo bolinha o WhatsApp aceita só MP4 curto.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
