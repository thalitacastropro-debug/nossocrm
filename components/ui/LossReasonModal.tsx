import React, { useState, useEffect, useId } from 'react';
import { X, ThumbsDown, CalendarClock, AlertCircle } from 'lucide-react';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';
import { MOTIVO_TAGS, MOTIVO_LABELS, type MotivoTag } from '@/lib/ai/taxonomy/motivos';
import { geraReabordagem, reabordarEmFallback } from '@/lib/ai/call-outcome/routing';

interface LossReasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** `reason` é o texto legível (rótulo + detalhe) que já era gravado antes; `tag` é o motivo estruturado. */
  onConfirm: (reason: string, tag: MotivoTag) => void;
  dealTitle?: string;
}

/**
 * LossReasonModal — captura o motivo da perda.
 *
 * MUDANÇA 09/09/2026 (decisão da Thalita): o motivo virou **obrigatório e estruturado**.
 *
 * Antes eram 5 atalhos de TEXTO LIVRE ("Preço muito alto", "Perdeu para concorrente"…) mais um
 * botão "Pular esta etapa" que gravava "Não informado". O resultado medido em produção: **1 de 36
 * perdidos** tinha motivo. O relatório de perdas era cego em 35 casos, e ninguém na Niva conseguia
 * dizer por que a empresa perde.
 *
 * Agora o motivo vem da taxonomia única (`MOTIVO_TAGS`), a mesma que a Ana e o desfecho por áudio
 * já usam — então o relatório passa a agregar o funil inteiro, e não três vocabulários paralelos.
 * O "Pular" saiu: sem motivo não há como marcar perdido.
 *
 * O motivo também define QUANDO reabordar (`reabordarEmFallback`): concorrente 12 meses, ficou na
 * atual 11, timing 1 mês, decisor 2 semanas. Por isso a data aparece aqui — quem escolhe o motivo
 * vê na hora o compromisso que está criando.
 *
 * Acessibilidade: role="dialog", foco preso, Escape fecha, radiogroup nos motivos.
 */
export const LossReasonModal: React.FC<LossReasonModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  dealTitle,
}) => {
  const [tag, setTag] = useState<MotivoTag | null>(null);
  const [detalhe, setDetalhe] = useState('');

  const generatedId = useId();
  const titleId = `loss-reason-title-${generatedId}`;
  const descId = `loss-reason-desc-${generatedId}`;
  const detalheId = `loss-reason-detalhe-${generatedId}`;

  useFocusReturn({ enabled: isOpen });

  useEffect(() => {
    if (isOpen) {
      setTag(null);
      setDetalhe('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Prévia da data do lembrete. Calculada na hora só para EXIBIR — quem grava de verdade é o
  // useMoveDeal, com o mesmo par de funções, para não haver duas réguas divergentes.
  const dataReabordagem =
    tag && geraReabordagem(tag)
      ? new Date(reabordarEmFallback(tag, new Date())).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tag) return;
    const texto = detalhe.trim()
      ? `${MOTIVO_LABELS[tag]} — ${detalhe.trim()}`
      : MOTIVO_LABELS[tag];
    onConfirm(texto, tag);
    onClose();
  };

  return (
    <FocusTrap active={isOpen} onEscape={onClose} returnFocus={true}>
      <div
        className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                <ThumbsDown className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div className="min-w-0">
                <h3 id={titleId} className="font-bold text-slate-900 dark:text-white font-display">
                  Negócio Perdido
                </h3>
                {dealTitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{dealTitle}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar modal"
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring shrink-0"
            >
              <X className="w-5 h-5 text-slate-400" aria-hidden="true" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
            {/* Content */}
            <div className="p-6 overflow-y-auto min-h-0">
              <p id={descId} className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Escolha o motivo da perda. Ele define quando o lead volta pra sua agenda.
              </p>

              <div
                className="grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label="Motivo da perda"
                aria-required="true"
              >
                {MOTIVO_TAGS.map((t) => {
                  const selecionado = tag === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={selecionado}
                      onClick={() => setTag(t)}
                      className={`p-3 rounded-xl border text-left text-sm font-medium transition-all focus-visible-ring ${
                        selecionado
                          ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 ring-2 ring-red-500/30'
                          : 'border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-red-300 dark:hover:border-red-500/50 hover:bg-red-50 dark:hover:bg-red-900/10'
                      }`}
                    >
                      {MOTIVO_LABELS[t]}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4">
                <label
                  htmlFor={detalheId}
                  className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5"
                >
                  Detalhe (opcional) — o que o próximo a pegar esse lead precisa saber
                </label>
                <textarea
                  id={detalheId}
                  value={detalhe}
                  onChange={(e) => setDetalhe(e.target.value)}
                  rows={2}
                  placeholder="Ex.: fechou com a Amil por R$ 200 a menos; renova em março."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10
                             bg-slate-50 dark:bg-white/5 text-slate-900 dark:text-white text-sm
                             placeholder:text-slate-400 dark:placeholder:text-slate-500
                             focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500
                             transition-all resize-none"
                />
              </div>

              {/* Prévia do compromisso que a escolha cria */}
              <div className="mt-4 min-h-[2.5rem]" aria-live="polite">
                {dataReabordagem && (
                  <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-white/5 rounded-lg p-3">
                    <CalendarClock className="w-4 h-4 shrink-0 mt-px text-slate-400" aria-hidden="true" />
                    <span>
                      Vamos criar um lembrete pra reabordar em{' '}
                      <strong className="text-slate-800 dark:text-slate-200">{dataReabordagem}</strong>, com
                      esse motivo anotado.
                    </span>
                  </div>
                )}
                {tag && !geraReabordagem(tag) && (
                  <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-white/5 rounded-lg p-3">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-px text-slate-400" aria-hidden="true" />
                    <span>Sem lembrete de reabordagem — esse motivo não volta pra agenda.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 flex gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400
                           hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!tag}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-white
                           bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed
                           shadow-lg shadow-red-600/20 transition-all focus-visible-ring"
              >
                Confirmar perda
              </button>
            </div>
          </form>
        </div>
      </div>
    </FocusTrap>
  );
};

export default LossReasonModal;
