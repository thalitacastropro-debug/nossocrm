import React from 'react';
import { X, AlertTriangle, ChevronDown, Trash2, FolderOutput } from 'lucide-react';
import { Board } from '@/types';

interface DeleteBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  boardName: string;
  dealCount: number;
  availableBoards: Board[];
  selectedTargetBoardId?: string;
  onSelectTargetBoard: (boardId: string) => void;
}

/**
 * Componente React `DeleteBoardModal`.
 *
 * @param {DeleteBoardModalProps} {
  isOpen,
  onClose,
  onConfirm,
  boardName,
  dealCount,
  availableBoards,
  selectedTargetBoardId,
  onSelectTargetBoard,
} - Parâmetro `{
  isOpen,
  onClose,
  onConfirm,
  boardName,
  dealCount,
  availableBoards,
  selectedTargetBoardId,
  onSelectTargetBoard,
}`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export const DeleteBoardModal: React.FC<DeleteBoardModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  boardName,
  dealCount,
  availableBoards,
  selectedTargetBoardId,
  onSelectTargetBoard,
}) => {
  if (!isOpen) return null;

  const hasDeals = dealCount > 0;
  const hasOtherBoards = availableBoards.length > 0;
  const canDelete = !hasDeals || selectedTargetBoardId;

  return (
    <div
      className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onClick={(e) => {
        // Close only when clicking the backdrop (outside the panel).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-dark-card rounded-2xl max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-dark-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Excluir Funil
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-dark-hover rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {hasDeals ? (
            <>
              <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <p className="text-amber-800 dark:text-amber-200 text-sm">
                  O funil <strong>"{boardName}"</strong> possui{' '}
                  <strong>{dealCount} negócio{dealCount > 1 ? 's' : ''}</strong>.
                </p>
              </div>

              {hasOtherBoards ? (
                <>
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      O que fazer com os negócios?
                    </label>
                    
                    {/* Opções de destino */}
                    <div className="space-y-2">
                      {availableBoards.map((board) => (
                        <button
                          key={board.id}
                          onClick={() => onSelectTargetBoard(board.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                            selectedTargetBoardId === board.id
                              ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
                              : 'border-slate-200 dark:border-dark-border hover:border-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <FolderOutput className={`w-5 h-5 flex-shrink-0 ${
                            selectedTargetBoardId === board.id
                              ? 'text-primary-600 dark:text-primary-400'
                              : 'text-slate-400'
                          }`} />
                          <span className={`text-sm ${
                            selectedTargetBoardId === board.id
                              ? 'text-primary-700 dark:text-primary-300 font-medium'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}>
                            Mover para "{board.name}"
                          </span>
                        </button>
                      ))}
                      
                      {/* Opção de deletar */}
                      <button
                        onClick={() => onSelectTargetBoard('__DELETE__')}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                          selectedTargetBoardId === '__DELETE__'
                            ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                            : 'border-slate-200 dark:border-dark-border hover:border-red-300 dark:hover:border-red-800'
                        }`}
                      >
                        <Trash2 className={`w-5 h-5 flex-shrink-0 ${
                          selectedTargetBoardId === '__DELETE__'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-400'
                        }`} />
                        <span className={`text-sm ${
                          selectedTargetBoardId === '__DELETE__'
                            ? 'text-red-700 dark:text-red-300 font-medium'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}>
                          Excluir negócios também
                        </span>
                      </button>
                    </div>
                  </div>

                  {selectedTargetBoardId && selectedTargetBoardId !== '__DELETE__' && (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Os negócios serão movidos para o primeiro estágio do funil selecionado.
                    </p>
                  )}
                  
                  {selectedTargetBoardId === '__DELETE__' && (
                    <p className="text-sm text-red-600 dark:text-red-400">
                      ⚠️ Isso vai excluir permanentemente todos os negócios!
                    </p>
                  )}
                </>
              ) : (
                // Só tem 1 board - oferece apenas excluir os deals
                <>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Este é o único funil. Para excluí-lo, os negócios também serão removidos.
                  </p>
                  <button
                    onClick={() => onSelectTargetBoard('__DELETE__')}
                    className={`w-full p-3 rounded-xl border-2 transition-colors flex items-center justify-center gap-2 ${
                      selectedTargetBoardId === '__DELETE__'
                        ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                        : 'border-slate-200 dark:border-dark-border hover:border-red-300'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                    Excluir negócios junto com o funil
                  </button>
                </>
              )}
            </>
          ) : (
            <p className="text-slate-600 dark:text-slate-400">
              Tem certeza que deseja excluir o funil <strong>"{boardName}"</strong>?
              Esta ação não pode ser desfeita.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-slate-200 dark:border-dark-border">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-hover rounded-xl font-medium transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={!canDelete}
            className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-colors ${
              canDelete
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-slate-200 dark:bg-dark-hover text-slate-400 cursor-not-allowed'
            }`}
          >
            {selectedTargetBoardId === '__DELETE__' 
              ? 'Excluir Tudo' 
              : hasDeals && selectedTargetBoardId 
                ? 'Mover e Excluir' 
                : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
};
