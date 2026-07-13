import React, { useId } from 'react';
import { X, LayoutGrid } from 'lucide-react';
import { Board } from '@/types';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';

interface SelectBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (boardId: string) => void;
  boards: Board[];
  contactName: string;
}

/**
 * Componente React `SelectBoardModal`.
 *
 * @param {SelectBoardModalProps} {
  isOpen,
  onClose,
  onSelect,
  boards,
  contactName,
} - Parâmetro `{
  isOpen,
  onClose,
  onSelect,
  boards,
  contactName,
}`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export const SelectBoardModal: React.FC<SelectBoardModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  boards,
  contactName,
}) => {
  const headingId = useId();
  const descriptionId = useId();
  useFocusReturn({ enabled: isOpen });
  
  if (!isOpen) return null;

  return (
    <FocusTrap active={isOpen} onEscape={onClose}>
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        onClick={(e) => {
          // Close only when clicking the backdrop (outside the panel).
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-white/10">
            <div>
              <h2 id={headingId} className="text-xl font-bold text-slate-900 dark:text-white">
                Criar Deal
              </h2>
              <p id={descriptionId} className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Selecione o funil para <strong>{contactName}</strong>
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar modal"
              className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors focus-visible-ring"
            >
              <X size={20} className="text-slate-500" aria-hidden="true" />
            </button>
          </div>

        {/* Board List */}
        <div className="p-4 max-h-80 overflow-y-auto">
          <div className="space-y-2">
            {boards.map(board => (
              <button
                key={board.id}
                onClick={() => onSelect(board.id)}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10 hover:border-primary-500 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center group-hover:bg-primary-200 dark:group-hover:bg-primary-500/30 transition-colors">
                  <LayoutGrid size={20} className="text-primary-600 dark:text-primary-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-slate-900 dark:text-white">
                    {board.name}
                  </p>
                  {board.description && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                      {board.description}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    {board.stages?.length || 0} estágios
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
          <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
            O deal será criado no primeiro estágio do funil selecionado
          </p>
        </div>
        </div>
      </div>
    </FocusTrap>
  );
};
