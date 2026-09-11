import React, { useState, useEffect, useId, useMemo } from 'react';
import { X, ThumbsUp, Pencil, AlertCircle } from 'lucide-react';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';
import { validarValorDaVenda, LIMITE_TAMANHO_OPERADORA } from '@/lib/deals/premioFechado';

interface ConfirmarValorVendaModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * `premioMensal` é o valor da venda confirmado; `operadora` é vazia quando a pessoa não
   * quis preencher agora (o selo âmbar do card continua cobrando).
   */
  onConfirm: (premioMensal: number, operadora: string) => void;
  dealTitle?: string;
  /** `deals.value` como está no card AGORA — é ele que a pergunta confirma. */
  valorDoCard?: number | null;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * ConfirmarValorVendaModal — "o valor do card é o valor da venda?", perguntado ANTES de mover.
 *
 * O FLUXO REAL, que o código não sabia (Thalita, 10/09/2026): *"o lead vem com o valor que ele
 * preenche no formulário e depois o consultor atualiza para o valor da venda"*. `deals.value`
 * tem DOIS significados ao longo da vida do mesmo card — a mensalidade do plano ANTIGO no
 * começo, o prêmio do plano COMPRADO no fim — e o CRM não tinha como saber em qual dos dois
 * estava. Por isso ele pedia o prêmio DE NOVO depois, no selo âmbar "Falta prêmio": o número
 * já estava na tela e ninguém podia afirmar que era o da venda.
 *
 * A pergunta resolve isso na única hora em que a resposta é conhecida — no fechamento, com o
 * consultor na frente da tela. Um clique em "Sim" grava `venda.premio_mensal = deals.value`;
 * "Não, corrigir" abre o campo e o novo número vai para os DOIS lugares (o card e o carimbo),
 * porque é exatamente isso que o consultor fazia na mão.
 *
 * ⚠️ POR QUE ISTO NÃO CONTRADIZ "a operação não trava" (niva-os-visao.md §1, o princípio que
 * fez o prêmio virar selo âmbar em vez de modal obrigatório): o caminho normal aqui é UM
 * CLIQUE numa pergunta de sim-ou-não, com a resposta já na tela. O que ficou de fora de
 * propósito é a OPERADORA — ela segue opcional, e o selo âmbar continua cobrando quem pulou.
 * Transformar o arrastar num formulário de três campos é o que a decisão de 26/08 barrou.
 *
 * Acessibilidade: role="dialog", foco preso, Escape fecha, erro com aria-live.
 */
export const ConfirmarValorVendaModal: React.FC<ConfirmarValorVendaModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  dealTitle,
  valorDoCard,
}) => {
  // Card sem valor não tem o que confirmar: a pergunta não faria sentido e a única saída é
  // digitar. Entra direto no modo de edição.
  const temValor = typeof valorDoCard === 'number' && Number.isFinite(valorDoCard) && valorDoCard > 0;

  const [editando, setEditando] = useState(!temValor);
  const [texto, setTexto] = useState('');
  const [operadora, setOperadora] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const generatedId = useId();
  const titleId = `confirmar-venda-title-${generatedId}`;
  const descId = `confirmar-venda-desc-${generatedId}`;
  const valorId = `confirmar-venda-valor-${generatedId}`;
  const operadoraId = `confirmar-venda-operadora-${generatedId}`;
  const erroId = `confirmar-venda-erro-${generatedId}`;

  useFocusReturn({ enabled: isOpen });

  useEffect(() => {
    if (!isOpen) return;
    setEditando(!temValor);
    // Pré-preenche com o valor do card: corrigir costuma ser mexer no número que já está lá,
    // não digitar do zero.
    setTexto(temValor ? String(valorDoCard) : '');
    setOperadora('');
    setErro(null);
  }, [isOpen, temValor, valorDoCard]);

  const valorFormatado = useMemo(
    () => (temValor ? BRL.format(valorDoCard as number) : null),
    [temValor, valorDoCard],
  );

  if (!isOpen) return null;

  const operadoraLimpa = operadora.trim().slice(0, LIMITE_TAMANHO_OPERADORA);

  const confirmarComValorDoCard = () => {
    const checagem = validarValorDaVenda(valorDoCard);
    if (!checagem.ok) {
      // Valor do card fora de faixa (negativo, absurdo): a saída é corrigir, não gravar.
      setErro(checagem.erro);
      setEditando(true);
      return;
    }
    onConfirm(checagem.valor, operadoraLimpa);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const checagem = validarValorDaVenda(texto);
    if (!checagem.ok) {
      setErro(checagem.erro);
      return;
    }
    onConfirm(checagem.valor, operadoraLimpa);
    onClose();
  };

  const campoOperadora = (
    <div className="mt-4">
      <label
        htmlFor={operadoraId}
        className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5"
      >
        Operadora do plano vendido (opcional agora)
      </label>
      <input
        id={operadoraId}
        type="text"
        value={operadora}
        onChange={(e) => setOperadora(e.target.value)}
        maxLength={LIMITE_TAMANHO_OPERADORA}
        placeholder="Ex.: Bradesco Saúde"
        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10
                   bg-slate-50 dark:bg-white/5 text-slate-900 dark:text-white text-sm
                   placeholder:text-slate-400 dark:placeholder:text-slate-500
                   focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500
                   transition-all"
      />
      <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        Sem ela a venda entra no mês, mas fica sem comissão calculada — o card avisa depois.
      </p>
    </div>
  );

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
                className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0"
                aria-hidden="true"
              >
                <ThumbsUp className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="min-w-0">
                <h3 id={titleId} className="font-bold text-slate-900 dark:text-white font-display">
                  Valor da venda
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

          {!editando ? (
            <>
              <div className="p-6 overflow-y-auto min-h-0">
                <p id={descId} className="text-sm text-slate-600 dark:text-slate-400">
                  O valor do card é{' '}
                  <strong className="text-slate-900 dark:text-white">{valorFormatado}</strong>. É
                  esse o valor da venda?
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  É o número que vai para o fechamento do mês. O card nasce com o que o lead paga
                  hoje — confirme se ele já foi atualizado para o plano vendido.
                </p>
                {campoOperadora}
              </div>

              <div className="px-6 py-4 border-t border-slate-200 dark:border-white/10 flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setErro(null);
                    setEditando(true);
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300
                             border border-slate-200 dark:border-white/10
                             hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring
                             flex items-center justify-center gap-1.5"
                >
                  <Pencil size={14} aria-hidden="true" /> Não, corrigir
                </button>
                <button
                  type="button"
                  onClick={confirmarComValorDoCard}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-white
                             bg-green-600 hover:bg-green-500
                             shadow-lg shadow-green-600/20 transition-all focus-visible-ring"
                >
                  Sim, é o valor da venda
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
              <div className="p-6 overflow-y-auto min-h-0">
                <p id={descId} className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                  {temValor
                    ? 'Informe o valor mensal do plano vendido. Ele substitui o valor do card.'
                    : 'Este card está sem valor. Informe o valor mensal do plano vendido.'}
                </p>

                <label
                  htmlFor={valorId}
                  className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5"
                >
                  Valor mensal do plano vendido (R$)
                </label>
                <input
                  id={valorId}
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={texto}
                  onChange={(e) => {
                    setTexto(e.target.value);
                    if (erro) setErro(null);
                  }}
                  aria-invalid={erro ? true : undefined}
                  aria-describedby={erro ? erroId : undefined}
                  placeholder="Ex.: 1.850,00"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10
                             bg-slate-50 dark:bg-white/5 text-slate-900 dark:text-white text-sm
                             placeholder:text-slate-400 dark:placeholder:text-slate-500
                             focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500
                             transition-all"
                />

                {campoOperadora}

                <div className="mt-3 min-h-[1.5rem]" aria-live="polite">
                  {erro && (
                    <div
                      id={erroId}
                      className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
                      <span>{erro}</span>
                    </div>
                  )}
                </div>
              </div>

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
                  disabled={texto.trim() === ''}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold text-white
                             bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed
                             shadow-lg shadow-green-600/20 transition-all focus-visible-ring"
                >
                  Confirmar venda
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </FocusTrap>
  );
};

export default ConfirmarValorVendaModal;
