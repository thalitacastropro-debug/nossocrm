import React, { useState } from 'react';
import { ChevronDown, Plus, Settings, Trash2 } from 'lucide-react';
import { Board } from '@/types';

interface BoardSelectorProps {
  boards: Board[];
  activeBoard: Board;
  onSelectBoard: (id: string) => void;
  onCreateBoard: () => void;
  onEditBoard?: (board: Board) => void;
  onDeleteBoard?: (id: string) => void;
}

/**
 * Componente React `BoardSelector`.
 *
 * @param {BoardSelectorProps} {
  boards,
  activeBoard,
  onSelectBoard,
  onCreateBoard,
  onEditBoard,
  onDeleteBoard,
} - Parâmetro `{
  boards,
  activeBoard,
  onSelectBoard,
  onCreateBoard,
  onEditBoard,
  onDeleteBoard,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BoardSelector: React.FC<BoardSelectorProps> = ({
  boards,
  activeBoard,
  onSelectBoard,
  onCreateBoard,
  onEditBoard,
  onDeleteBoard,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary-500" />
          <span className="font-medium text-slate-900 dark:text-white">
            {activeBoard.name}
          </span>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 z-50 w-72 bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden">
            {/* Board List */}
            <div className="max-h-80 overflow-y-auto py-1">
              {boards.map(board => (
                <div
                  key={board.id}
                  className={`group flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer ${
                    board.id === activeBoard.id
                      ? 'bg-primary-50 dark:bg-primary-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-white/5'
                  }`}
                  onClick={() => { onSelectBoard(board.id); setIsOpen(false); }}
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    board.id === activeBoard.id ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${
                      board.id === activeBoard.id
                        ? 'text-primary-600 dark:text-primary-400'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}>
                      {board.name}
                    </p>
                    {board.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {board.description}
                      </p>
                    )}
                  </div>

                  {/* Action buttons - aparecem no hover */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onEditBoard && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditBoard(board);
                          setIsOpen(false);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                        title="Editar funil"
                      >
                        <Settings size={14} />
                      </button>
                    )}
                    {/* Pode deletar se não for o único board */}
                    {onDeleteBoard && boards.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteBoard(board.id);
                          setIsOpen(false);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        title="Excluir funil"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Create New Board */}
            <div className="border-t border-slate-200 dark:border-white/10">
              <button
                type="button"
                onClick={() => { onCreateBoard(); setIsOpen(false); }}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
              >
                <Plus size={16} />
                Criar novo funil
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
