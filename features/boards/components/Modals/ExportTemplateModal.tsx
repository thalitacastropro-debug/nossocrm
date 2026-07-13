import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, ArrowUp, ArrowDown } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { Board, BoardStage, JourneyDefinition } from '@/types';
import { useToast } from '@/context/ToastContext';
import { z } from 'zod';

function slugify(input: string) {
  // NOTE: avoid Unicode property escapes (\p{L}) for broader browser compatibility (Safari).
  // Normalize accents → ASCII-ish, then keep [a-z0-9-].
  const ascii = (input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return ascii
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);

  // Note: some browsers (notably Safari) may cancel the download if the object URL
  // is revoked immediately after click. Keep it alive briefly.
  try {
    // Ensure the node is in the DOM before triggering the click (some browsers are picky).
    requestAnimationFrame(() => {
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
  } catch {
    // Fallback: open the blob URL (user can save manually).
    window.open(url, '_blank', 'noopener,noreferrer');
  } finally {
    a.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
  }
}

function buildJourneyFromBoards(
  opts: { schemaVersion: string; journeyName?: string; boards: Board[]; slugPrefix?: string }
): JourneyDefinition {
  const { schemaVersion, journeyName, boards, slugPrefix } = opts;

  const usedSlugs = new Set<string>();
  const mkSlug = (name: string) => {
    const base = slugify(`${slugPrefix ? `${slugPrefix}-` : ''}${name}`) || 'board';
    let s = base;
    let i = 2;
    while (usedSlugs.has(s)) {
      s = `${base}-${i}`;
      i += 1;
    }
    usedSlugs.add(s);
    return s;
  };

  return {
    schemaVersion,
    name: journeyName,
    boards: boards.map(b => ({
      slug: mkSlug(b.name),
      name: b.name,
      columns: b.stages.map(s => ({
        name: s.label,
        color: s.color,
        linkedLifecycleStage: s.linkedLifecycleStage,
      })),
      strategy: {
        agentPersona: b.agentPersona,
        goal: b.goal,
        entryTrigger: b.entryTrigger,
      },
    })),
  };
}

type Panel = 'export' | 'import';

function buildDefaultJourneyName(selectedBoards: Board[]) {
  if (selectedBoards.length <= 1) return selectedBoards[0]?.name || 'Jornada';
  const first = selectedBoards[0]?.name ?? 'Board 1';
  const last = selectedBoards[selectedBoards.length - 1]?.name ?? 'Board N';
  return `Jornada - ${first} → ${last}`;
}

const JourneySchema = z.object({
  schemaVersion: z.string().min(1),
  name: z.string().optional(),
  boards: z.array(z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    columns: z.array(z.object({
      name: z.string().min(1),
      color: z.string().optional(),
      linkedLifecycleStage: z.string().optional(),
    })).min(1),
    strategy: z.object({
      agentPersona: z.object({
        name: z.string().optional(),
        role: z.string().optional(),
        behavior: z.string().optional(),
      }).optional(),
      goal: z.object({
        description: z.string().optional(),
        kpi: z.string().optional(),
        targetValue: z.string().optional(),
        type: z.string().optional(),
      }).optional(),
      entryTrigger: z.string().optional(),
    }).optional(),
  })).min(1),
});

function guessWonLostStageIds(stages: BoardStage[]) {
  const won = stages.find(s => /\b(ganho|won|fechado ganho|conclu[ií]do)\b/i.test(s.label))?.id;
  const lost = stages.find(s => /\b(perdido|lost|churn|cancelad[oa])\b/i.test(s.label))?.id;
  return { wonStageId: won, lostStageId: lost };
}

/**
 * Componente React `ExportTemplateModal`.
 *
 * @param {{ isOpen: boolean; onClose: () => void; boards: Board[]; activeBoard: Board; onCreateBoardAsync?: ((board: Omit<Board, "id" | "createdAt">, order?: number | undefined) => Promise<...>) | undefined; }} props - Parâmetro `props`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export function ExportTemplateModal(props: {
  isOpen: boolean;
  onClose: () => void;
  boards: Board[];
  activeBoard: Board;
  onCreateBoardAsync?: (board: Omit<Board, 'id' | 'createdAt'>, order?: number) => Promise<Board>;
}) {
  const { isOpen, onClose, boards, activeBoard, onCreateBoardAsync } = props;
  const { addToast } = useToast();

  const [panel, setPanel] = useState<Panel>('export');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showPasteImport, setShowPasteImport] = useState(false);

  // Journey metadata
  const [schemaVersion, setSchemaVersion] = useState('1.0');
  const [journeyName, setJourneyName] = useState(() => `Jornada - ${activeBoard.name}`);
  const [journeyNameDirty, setJourneyNameDirty] = useState(false);
  const [slugPrefix, setSlugPrefix] = useState('');

  // Selected boards for journey (keep order)
  const [selectedBoardIds, setSelectedBoardIds] = useState<string[]>(() => [activeBoard.id]);

  useEffect(() => {
    if (!isOpen) return;
    // Reset to a predictable state on open.
    setPanel('export');
    setAdvancedOpen(false);
    setShowTechnicalDetails(false);
    setShowPasteImport(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    // UX: normalize persisted selection order on open to match the visible list order.
    // This prevents confusing exports where an older "selection order" lingers across opens.
    const orderIndex = new Map<string, number>();
    for (let i = 0; i < boards.length; i += 1) {
      orderIndex.set(boards[i].id, i);
    }
    const allowed = new Set<string>(boards.map(b => b.id));

    setSelectedBoardIds(prev => {
      const unique = Array.from(new Set([...prev, activeBoard.id]));
      return unique
        .filter(id => allowed.has(id))
        .sort((a, b) => (orderIndex.get(a) ?? Number.POSITIVE_INFINITY) - (orderIndex.get(b) ?? Number.POSITIVE_INFINITY));
    });
  }, [isOpen, boards, activeBoard.id]);

  const selectedBoards = useMemo(() => {
    const byId = new Map(boards.map(b => [b.id, b]));
    return selectedBoardIds.map(id => byId.get(id)).filter(Boolean) as Board[];
  }, [boards, selectedBoardIds]);

  // UX: keep a friendly default name, but never overwrite user edits.
  useEffect(() => {
    if (journeyNameDirty) return;
    setJourneyName(buildDefaultJourneyName(selectedBoards));
  }, [selectedBoards]);

  const journeyJson = useMemo(() => {
    return buildJourneyFromBoards({
      schemaVersion,
      journeyName: journeyName.trim() || undefined,
      boards: selectedBoards,
      slugPrefix: slugPrefix.trim() || undefined,
    });
  }, [schemaVersion, slugPrefix, journeyName, selectedBoards]);

  const journeyJsonText = useMemo(() => JSON.stringify(journeyJson, null, 2), [journeyJson]);

  const canExportJourney = selectedBoards.length > 0;

  const toggleBoard = (boardId: string) => {
    setSelectedBoardIds(prev => {
      if (prev.includes(boardId)) {
        // Keep at least 1 selected.
        const next = prev.filter(id => id !== boardId);
        return next.length === 0 ? prev : next;
      }
      // Insert following the visible boards order (not "selection order").
      // This avoids confusing exports where the active board (pre-selected) stays first forever.
      const idxInBoards = boards.findIndex(b => b.id === boardId);
      if (idxInBoards === -1) return [...prev, boardId];

      const orderIndex = new Map<string, number>();
      for (let i = 0; i < boards.length; i += 1) {
        orderIndex.set(boards[i].id, i);
      }

      const next = [...prev];
      let insertAt = next.length;
      for (let i = 0; i < next.length; i += 1) {
        const existingId = next[i];
        const existingIdx = orderIndex.get(existingId);
        if (existingIdx === undefined) continue;
        if (existingIdx > idxInBoards) {
          insertAt = i;
          break;
        }
      }
      next.splice(insertAt, 0, boardId);
      return next;
    });
  };

  const moveSelected = (boardId: string, dir: -1 | 1) => {
    setSelectedBoardIds(prev => {
      const idx = prev.indexOf(boardId);
      if (idx === -1) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const handleDownloadJourney = () => {
    try {
      if (!canExportJourney) {
        addToast('Selecione ao menos 1 funil para exportar a jornada.', 'error');
        return;
      }
      // If exporting a single board, the filename should be based on that board name.
      // Otherwise, use the journey name.
      const base = slugify((selectedBoards.length <= 1 ? activeBoard.name : (journeyName || 'journey')));
      const filename = `${base || 'journey'}.journey.json`;
      // Debug trace: helps diagnose user reports like "click does nothing".
      console.info('[ExportTemplateModal] download click', {
        filename,
        schemaVersion,
        selectedBoards: selectedBoards.map(b => ({ id: b.id, name: b.name, stages: b.stages.length })),
      });
      downloadJson(filename, journeyJson);
      addToast('Download iniciado.', 'success');
    } catch (err) {
      console.error('[ExportTemplateModal] download failed:', err);
      addToast('Falha ao iniciar download. Veja o console para detalhes.', 'error');
    }
  };

  const handleCopyJourneyJson = async () => {
    try {
      await navigator.clipboard.writeText(journeyJsonText);
      addToast('journey.json copiado!', 'success');
    } catch (err) {
      console.error('[ExportTemplateModal] copy failed:', err);
      addToast('Não consegui copiar (permissão do navegador).', 'error');
    }
  };

  // ============ IMPORT (LOCAL JSON) ============
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importJourney, setImportJourney] = useState<JourneyDefinition | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const parseImport = (raw: string) => {
    setImportText(raw);
    setImportError(null);
    setImportJourney(null);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      setImportError('JSON inválido (não consegui fazer parse).');
      return;
    }

    const result = JourneySchema.safeParse(parsedJson);
    if (!result.success) {
      setImportError('JSON não bate com o schema esperado de Journey (schemaVersion/boards/columns).');
      return;
    }

    setImportJourney(result.data as JourneyDefinition);
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      parseImport(text);
    } catch (e) {
      console.error('[ExportTemplateModal] import file read failed:', e);
      setImportError('Falha ao ler arquivo.');
    }
  };

  const handleInstallImportedJourney = async () => {
    if (!importJourney) {
      addToast('Selecione um journey.json válido.', 'error');
      return;
    }
    if (!onCreateBoardAsync) {
      addToast('Import indisponível nesta tela.', 'error');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    try {
      for (let i = 0; i < importJourney.boards.length; i += 1) {
        const b = importJourney.boards[i];
        const stages: BoardStage[] = b.columns.map((c) => ({
          id: crypto.randomUUID(),
          label: c.name,
          color: c.color || 'bg-slate-500',
          linkedLifecycleStage: c.linkedLifecycleStage,
        }));
        const guessed = guessWonLostStageIds(stages);

        await onCreateBoardAsync({
          name: b.name,
          description: `Parte da jornada: Sim`,
          linkedLifecycleStage: undefined,
          template: 'CUSTOM',
          stages,
          isDefault: false,
          wonStageId: guessed.wonStageId,
          lostStageId: guessed.lostStageId,
          agentPersona: b.strategy?.agentPersona,
          goal: b.strategy?.goal,
          entryTrigger: b.strategy?.entryTrigger,
        } as any);
      }

      addToast('Jornada importada com sucesso!', 'success');
      onClose();
      setImportText('');
      setImportError(null);
      setImportJourney(null);
      setPanel('export');
    } catch (e) {
      console.error('[ExportTemplateModal] install journey failed:', e);
      setImportError('Falha ao instalar a jornada. Veja o console/toasts.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Exportar template (comunidade)"
      size="xl"
      className="max-w-2xl"
      bodyClassName="space-y-6 max-h-[75vh] overflow-y-auto pr-1"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPanel('export')}
            className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${panel === 'export'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
              : 'bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}
          >
            Exportar
          </button>
          <button
            type="button"
            onClick={() => setPanel('import')}
            className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${panel === 'import'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
              : 'bg-white dark:bg-white/5 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10'
              }`}
          >
            Importar JSON
          </button>
        </div>
      </div>

      {panel === 'import' && (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 bg-slate-50/50 dark:bg-white/5 space-y-4">
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white">Importar template (arquivo JSON)</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Faça upload do arquivo exportado e clique em <b>Instalar</b>.
            </div>
          </div>

          <input
            type="file"
            accept=".json,application/json"
            onChange={e => void handleImportFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 dark:text-slate-300"
          />

          <button
            type="button"
            onClick={() => setShowPasteImport(v => !v)}
            className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors w-fit"
          >
            {showPasteImport ? 'Ocultar opção de colar JSON' : 'Colar JSON manualmente (avançado)'}
          </button>

          {showPasteImport && (
            <textarea
              value={importText}
              onChange={e => parseImport(e.target.value)}
              placeholder="Cole o conteúdo do arquivo JSON aqui…"
              className="w-full min-h-44 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/30 px-3 py-2 text-xs font-mono"
            />
          )}

          {importError && (
            <div className="text-sm text-red-600 dark:text-red-400">{importError}</div>
          )}

          {importJourney && (
            <div className="text-xs text-slate-600 dark:text-slate-300">
              <b>Detectado:</b> {importJourney.boards.length} board(s){importJourney.name ? ` • ${importJourney.name}` : ''}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleInstallImportedJourney()}
              disabled={!importJourney || isImporting}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 ${(!importJourney || isImporting)
                ? 'bg-slate-200 dark:bg-white/10 text-slate-400 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-700 text-white'
                }`}
            >
              <Download size={16} /> {isImporting ? 'Instalando…' : 'Instalar jornada'}
            </button>
          </div>
        </div>
      )}

      {panel === 'export' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            Exportar template
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Selecione 1 board (template simples) ou vários (jornada).
          </div>
        </div>
      )}

      {panel === 'export' && (
      <div className="grid grid-cols-1 gap-6">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-white/10 p-4 bg-slate-50/50 dark:bg-white/5">
            <div className="text-sm font-bold text-slate-900 dark:text-white">1) Baixar arquivo do template</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Esse arquivo é o que você vai guardar/publicar na comunidade.
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Nome (aparece na comunidade)
              </label>
              <input
                value={journeyName}
                onChange={e => { setJourneyName(e.target.value); setJourneyNameDirty(true); }}
                className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm"
              />
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">funis da jornada (ordem importa)</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                <b>Ordem que será exportada:</b> {selectedBoards.map(b => b.name).join(' → ') || '(nenhum)'}
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-2 max-h-64 overflow-auto space-y-1">
                {boards.map(b => {
                  const checked = selectedBoardIds.includes(b.id);
                  const isSelected = checked;
                  return (
                    <div key={b.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-slate-50 dark:hover:bg-white/10">
                      <label className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBoard(b.id)}
                        />
                        <span className="truncate">{b.name}</span>
                      </label>
                      {isSelected && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => moveSelected(b.id, -1)}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10"
                            aria-label="Mover para cima"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSelected(b.id, 1)}
                            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-white/10"
                            aria-label="Mover para baixo"
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadJourney}
                className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold flex items-center gap-2"
              >
                <Download size={16} /> Baixar arquivo
              </button>
              <button
                type="button"
                onClick={handleCopyJourneyJson}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold flex items-center gap-2"
              >
                <Copy size={16} /> Copiar arquivo (texto)
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowTechnicalDetails(v => !v)}
              className="mt-3 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              {showTechnicalDetails ? 'Ocultar detalhes técnicos' : 'Mostrar detalhes técnicos'}
            </button>

            {showTechnicalDetails && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">schemaVersion</label>
                    <input
                      value={schemaVersion}
                      onChange={e => setSchemaVersion(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">slug prefix (opcional)</label>
                    <input
                      value={slugPrefix}
                      onChange={e => setSlugPrefix(e.target.value)}
                      placeholder="ex: sales"
                      className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">Preview (JSON)</div>
                  <pre className="text-xs whitespace-pre-wrap rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/30 p-3 max-h-56 overflow-auto">
                    {journeyJsonText}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </Modal>
  );
}

