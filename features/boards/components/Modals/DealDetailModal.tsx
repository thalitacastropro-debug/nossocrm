import React, { useState, useRef, useEffect, useId, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useContacts,
  useActivities,
  useBoards,
  useLifecycleStages,
  useUpdateDeal,
  useDeleteDeal,
  useAddDealItem,
  useRemoveDealItem,
  useCreateActivity,
  useUpdateActivity,
  useDeleteActivity,
  useMoveDealToBoard,
} from '@/lib/query/hooks';
// Caminho DIRETO, não pelo barrel acima: os testes do modal mockam
// '@/lib/query/hooks' com factory (lista fixa de hooks), e todo hook novo pedido
// pelo barrel derruba a suíte com "No export is defined on the mock".
import { useOrgMembersQuery } from '@/lib/query/hooks/useOrgMembersQuery';
import { useUIState } from '@/store/uiState';
import { sortActivitiesTimeline } from '@/lib/utils/activitySort';
import { useActiveProducts } from '@/lib/query/hooks/useProductsQuery';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog as ConfirmModal } from '@/components/ui/confirm-dialog';
import { LossReasonModal } from '@/components/ui/LossReasonModal';
import { useMoveDealSimple } from '@/lib/query/hooks';
import { DEALS_VIEW_KEY, queryKeys } from '@/lib/query';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';
import { Activity, Board, DealView } from '@/types';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useResponsiveMode } from '@/hooks/useResponsiveMode';
import { DealSheet } from '../DealSheet';
import {
  analyzeLead,
  generateEmailDraft,
  generateObjectionResponse,
} from '@/lib/ai/tasksClient';
import {
  BrainCircuit,
  Mail,
  Phone,
  Calendar,
  Check,
  X,
  Trash2,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  Building2,
  User,
  Package,
  Sword,
  CheckCircle2,
  Bot,
  Tag as TagIcon,
  Plus,
  MessageSquare,
  FileText,
  CalendarCheck,
  CalendarX,
  ArrowRightLeft,
  UserCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { StageProgressBar } from '../StageProgressBar';
import { ActivityRow } from '@/features/activities/components/ActivityRow';
import { formatPriorityPtBr } from '@/lib/utils/priority';
import { BriefingDrawer } from '@/features/deals/components/BriefingDrawer';
import { AIExtractedFields } from '@/features/deals/components/AIExtractedFields';
import { QualificacaoSDRPanel, sdrPanelHasData } from '@/features/deals/components/QualificacaoSDRPanel';
import { VoiceOutcomeCapture } from '@/features/deals/components/VoiceOutcomeCapture';
import { DealOwnerSelect, podeTrocarResponsavel } from '@/features/deals/components/DealOwnerSelect';
import {
  OrigemDoLeadPanel,
  type OrigemComercial,
} from '@/features/deals/components/OrigemDoLeadPanel';
import { useMarkMeetingHeld } from '@/lib/query/hooks/useMarkMeetingHeld';
import { useCancelMeeting } from '@/lib/query/hooks/useCancelMeeting';
import { CONSULTOR_BOARD_ID } from '@/lib/config/boards';
import { missingForBoardMove } from '@/lib/deals/board-move-gate';

interface DealDetailModalProps {
  dealId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

// Performance: reuse date formatter instance.
const PT_BR_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR');

/**
 * Estilo único das ações secundárias do header (Reunião realizada, Cancelar
 * reunião, Mover, Preparar).
 *
 * Antes cada uma tinha o próprio fundo colorido — verde, rosa, cinza e azul lado
 * a lado, competindo com Ganho/Perdido, que são as decisões de verdade. A cor
 * ficou só no ÍCONE, que já basta para diferenciar (Thalita, 25/08/2026: "preciso
 * um aspecto clean, assim como ajustamos o calendário").
 */
const ACAO_SECUNDARIA =
  'px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50';

/**
 * Componente React `DealDetailModal`.
 *
 * @param {DealDetailModalProps} { dealId, isOpen, onClose } - Parâmetro `{ dealId, isOpen, onClose }`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export const DealDetailModal: React.FC<DealDetailModalProps> = ({ dealId, isOpen, onClose }) => {
  // Accessibility: Unique ID for ARIA labelling
  const headingId = useId();

  // Accessibility: Return focus to trigger element when modal closes
  useFocusReturn({ enabled: isOpen });

  const { mode } = useResponsiveMode();
  const isMobile = mode === 'mobile';

  const updateDealMutation = useUpdateDeal();
  const deleteDealMutation = useDeleteDeal();
  const addDealItemMutation = useAddDealItem();
  const removeDealItemMutation = useRemoveDealItem();
  const updateDeal = (id: string, updates: Partial<import('@/types').Deal>) => updateDealMutation.mutateAsync({ id, updates });
  const deleteDeal = (id: string) => deleteDealMutation.mutateAsync(id);
  const addItemToDeal = (dealId: string, item: Omit<import('@/types').DealItem, 'id'>) => addDealItemMutation.mutateAsync({ dealId, item });
  const removeItemFromDeal = (dealId: string, itemId: string) => removeDealItemMutation.mutateAsync({ dealId, itemId });

  const { data: contacts = [] } = useContacts();
  const { data: activities = [] } = useActivities();
  const { data: boards = [] } = useBoards();
  const { activeBoardId } = useUIState();
  const activeBoard = boards.find(b => b.id === activeBoardId) || boards.find(b => b.isDefault) || boards[0] || null;
  const { data: lifecycleStages = [] } = useLifecycleStages();

  const createActivityMutation = useCreateActivity();
  const markMeetingHeld = useMarkMeetingHeld();
  const cancelMeeting = useCancelMeeting();
  const moveDealToBoard = useMoveDealToBoard();
  const updateActivityMutation = useUpdateActivity();
  const deleteActivityMutation = useDeleteActivity();
  const addActivity = (activity: Omit<import('@/types').Activity, 'id' | 'createdAt'>) => createActivityMutation.mutateAsync({ activity });
  const updateActivity = (id: string, updates: Partial<import('@/types').Activity>) => updateActivityMutation.mutateAsync({ id, updates });
  const deleteActivity = (id: string) => deleteActivityMutation.mutateAsync(id);
  const { data: products = [] } = useActiveProducts();
  const customFieldDefinitions: import('@/types').CustomFieldDefinition[] = [];
  const { profile } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();
  // Time da org: dá nome ao dono do card para quem NÃO pode trocar (leitura).
  const { data: orgMembers = [], isLoading: carregandoTime } = useOrgMembersQuery();
  const queryClient = useQueryClient();

  // Subscribe to the same cache the Kanban uses (DEALS_VIEW_KEY).
  // This ensures newly-created deals (written there by the optimistic insert in CRMContext.addDeal)
  // are immediately visible to the modal, without waiting for Realtime to update ['deals', 'list'].
  const { data: allDeals = [] } = useQuery<DealView[]>({
    queryKey: DEALS_VIEW_KEY,
    queryFn: () => [] as DealView[], // never called — enabled: false; queryFn required by TanStack Query v5
    enabled: false, // don't trigger a new fetch — data is always hydrated by the Kanban's useDealsByBoard
  });

  // Performance: avoid repeated `find(...)` on large arrays.
  const dealsById = useMemo(() => new Map(allDeals.map((d) => [d.id, d])), [allDeals]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const boardsById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const lifecycleStageById = useMemo(() => new Map(lifecycleStages.map((s) => [s.id, s])), [lifecycleStages]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const activitiesById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);

  const deal = dealId ? dealsById.get(dealId) : undefined;
  const contact = deal ? (contactsById.get(deal.contactId) ?? null) : null;

  // Determine the correct board for this deal
  const dealBoard = deal ? (boardsById.get(deal.boardId) ?? activeBoard) : activeBoard;

  // Use unified TanStack Query hook for moving deals
  const { moveDeal } = useMoveDealSimple(dealBoard, lifecycleStages);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editValue, setEditValue] = useState('');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [aiResult, setAiResult] = useState<{ suggestion: string; score: number } | null>(null);
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  // Abre em "IA Insights": é o resumo do lead, o que se quer ver primeiro ao abrir
  // o card (decisão da Thalita, 25/08/2026).
  const [activeTab, setActiveTab] = useState<'timeline' | 'products' | 'info' | 'origem'>('info');
  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [objection, setObjection] = useState('');
  const [objectionResponses, setObjectionResponses] = useState<string[]>([]);
  const [isGeneratingObjections, setIsGeneratingObjections] = useState(false);

  const [selectedProductId, setSelectedProductId] = useState('');
  const [productQuantity, setProductQuantity] = useState(1);
  const [showCustomItem, setShowCustomItem] = useState(false);
  const [customItemName, setCustomItemName] = useState('');
  const [customItemPrice, setCustomItemPrice] = useState<string>('0');
  const [customItemQuantity, setCustomItemQuantity] = useState(1);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showLossReasonModal, setShowLossReasonModal] = useState(false);
  const [pendingLostStageId, setPendingLostStageId] = useState<string | null>(null);
  const [lossReasonOrigin, setLossReasonOrigin] = useState<'button' | 'stage'>('button');
  const [showBriefingDrawer, setShowBriefingDrawer] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Board | null>(null);

  // Tags suggestions (local for now; Settings UI writes to the same key)
  const [availableTags, setAvailableTags] = usePersistedState<string[]>('crm_tags', []);
  const [tagQuery, setTagQuery] = useState('');

  const normalizeTag = (value: string) => value.trim().replace(/\s+/g, ' ');
  const tagsLower = useMemo(() => new Set((deal?.tags || []).map(t => t.toLowerCase())), [deal?.tags]);
  const availableTagsLower = useMemo(() => new Set((availableTags || []).map(t => t.toLowerCase())), [availableTags]);

  // Helper functions removed as they are now handled by ActivityRow component

  // Reset state when deal changes or modal opens
  useEffect(() => {
    if (isOpen && deal) {
      setEditTitle(deal.title);
      setEditValue(deal.value.toString());
      setAiResult(null);
      setEmailDraft(null);
      setObjectionResponses([]);
      setObjection('');
      setActiveTab('timeline');
      setIsEditingTitle(false);
      setIsEditingValue(false);
      setShowLossReasonModal(false);
      setPendingLostStageId(null);
      setLossReasonOrigin('button');
      setTagQuery('');
      setShowBriefingDrawer(false);
      setShowMoveModal(false);
      setMoveTarget(null);
    }
  }, [isOpen, dealId]); // Depend on dealId to reset when switching deals

  // UX: preselect board's default product when opening the Products tab (non-invasive).
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab !== 'products') return;
    const defaultId = dealBoard?.defaultProductId;
    if (!defaultId) return;
    if (selectedProductId) return;
    // Only suggest if product exists & is active.
    const p = productsById.get(defaultId);
    if (!p || p.active === false) return;
    setSelectedProductId(defaultId);
    setProductQuantity(1);
  }, [activeTab, dealBoard?.defaultProductId, isOpen, productsById, selectedProductId]);

  // Pre-compute stage label once for tool prompts (avoid repeated stage lookup).
  const stageLabel = useMemo(() => {
    if (!dealBoard) return undefined;
    const stage = dealBoard.stages.find((s) => s.id === deal?.status);
    return stage?.label;
  }, [deal?.status, dealBoard]);

  // Performance: filter deal activities once per deal change (avoid filtering inside render).
  const dealActivities = useMemo(() => {
    if (!deal) return [] as Activity[];
    // Mais recente primeiro: a timeline do card se le de cima pra baixo, do que
    // acabou de acontecer para tras. A ordenacao global (sortActivitiesSmart) e
    // de LISTA DE TAREFAS e jogava a nota recem-escrita para o rodape.
    return sortActivitiesTimeline(activities.filter((a) => a.dealId === deal.id));
  }, [activities, deal]);

  if (!isOpen || !deal) return null;

  // Responsável do card. Quem enxerga a carteira do time troca; os demais leem.
  const podeTrocarDono = podeTrocarResponsavel(profile);
  // "Fora do time" só DEPOIS que a lista do time chegou: com o cache frio (abrir
  // o card pelo Inbox, por exemplo) o find não acha ninguém e o card acusaria,
  // falsamente, que o dono saiu da organização.
  const donoNome = !deal.ownerId
    ? 'Sem dono'
    : (orgMembers.find((m) => m.id === deal.ownerId)?.name
      ?? (carregandoTime ? 'Carregando...' : 'Fora do time'));

  /**
   * A troca de dono mexe em card, contato, conversa e timeline de uma vez — e
   * a rota escreve direto no banco, sem passar por mutation. Sem invalidar
   * tudo isto o card continua mostrando o dono antigo até o F5.
   */
  const handleOwnerChanged = () => {
    queryClient.invalidateQueries({ queryKey: DEALS_VIEW_KEY });
    queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.contacts.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.messagingConversations.all });
    addToast('Responsável atualizado.', 'success');
  };

  // Move entre funis (feature de move manual): nome de quem move + portão de dados.
  const moverName =
    profile?.nickname ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
    profile?.email?.split('@')[0] ||
    'Usuário';
  const moveMissing = moveTarget ? missingForBoardMove(moveTarget.id, deal.customFields) : [];
  const handleConfirmMove = () => {
    if (!moveTarget) return;
    const targetName = moveTarget.name;
    moveDealToBoard.mutate(
      { deal, targetBoard: moveTarget, moverName },
      {
        onSuccess: () => {
          addToast(`Card movido para ${targetName}.`, 'success');
          onClose();
        },
        onError: (e: unknown) =>
          addToast((e as Error)?.message || 'Falha ao mover o card.', 'warning'),
      },
    );
  };

  const addDealTag = (raw: string) => {
    const next = normalizeTag(raw);
    if (!next) return;
    if (tagsLower.has(next.toLowerCase())) return;

    const current = deal.tags || [];
    const nextTags = [...current, next];
    updateDeal(deal.id, { tags: nextTags });

    // Keep suggestions up-to-date (case-insensitive)
    if (!availableTagsLower.has(next.toLowerCase())) {
      setAvailableTags(prev => [...(prev || []), next]);
    }

    setTagQuery('');
  };

  const removeDealTag = (tag: string) => {
    const current = deal.tags || [];
    const nextTags = current.filter(t => t !== tag);
    updateDeal(deal.id, { tags: nextTags });
  };

  const tagSuggestions = (() => {
    const q = normalizeTag(tagQuery);
    if (!q) return [];
    const qLower = q.toLowerCase();
    return (availableTags || [])
      .filter(t => !tagsLower.has(t.toLowerCase()))
      .filter(t => t.toLowerCase().includes(qLower))
      .slice(0, 8);
  })();

  const handleAnalyzeDeal = async () => {
    setIsAnalyzing(true);
    try {
      // Performance: stageLabel memoized above.
      const result = await analyzeLead(deal, stageLabel);
      setAiResult({ suggestion: result.suggestion, score: result.probabilityScore });
      updateDeal(deal.id, { aiSummary: result.suggestion, probability: result.probabilityScore });
    } catch (error: any) {
      console.error('[DealDetailModal] analyzeLead failed:', error);
      addToast(
        error?.message || 'Falha ao analisar deal com IA. Verifique Configurações → Inteligência Artificial.',
        'warning'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDraftEmail = async () => {
    setIsDrafting(true);
    try {
      // Performance: stageLabel memoized above.
      const draft = await generateEmailDraft(deal, stageLabel);
      setEmailDraft(draft);
    } catch (error: any) {
      console.error('[DealDetailModal] generateEmailDraft failed:', error);
      addToast(
        error?.message || 'Falha ao gerar e-mail com IA. Verifique Configurações → Inteligência Artificial.',
        'warning'
      );
    } finally {
      setIsDrafting(false);
    }
  };


  const handleObjection = async () => {
    if (!objection.trim()) return;
    setIsGeneratingObjections(true);
    try {
      const responses = await generateObjectionResponse(deal, objection);
      setObjectionResponses(responses);
    } catch (error: any) {
      console.error('[DealDetailModal] generateObjectionResponse failed:', error);
      addToast(
        error?.message || 'Falha ao gerar respostas. Verifique Configurações → Inteligência Artificial.',
        'warning'
      );
    } finally {
      setIsGeneratingObjections(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;

    const noteActivity: Activity = {
      id: crypto.randomUUID(),
      dealId: deal.id,
      dealTitle: deal.title,
      type: 'NOTE',
      title: 'Nota Adicionada',
      description: newNote,
      date: new Date().toISOString(),
      user: { name: 'Eu', avatar: 'https://i.pravatar.cc/150?u=me' },
      completed: true,
    };

    // A escrita e otimista: a nota aparece na hora e some se o banco recusar.
    // Sem await + catch, essa remocao era silenciosa e o usuario so via a nota
    // sumir, sem erro nenhum. Falha tem que falar.
    const previousNote = newNote;
    setNewNote('');
    try {
      await addActivity(noteActivity);
    } catch (error: any) {
      console.error('[DealDetailModal] addActivity(NOTE) failed:', error);
      setNewNote(previousNote); // devolve o texto para nao perder o que a pessoa escreveu
      addToast(error?.message || 'Nao foi possivel salvar a nota. Tente de novo.', 'warning');
    }
  };

  const handleAddProduct = () => {
    if (!selectedProductId) return;
    // Performance: O(1) lookup instead of scanning all products.
    const product = productsById.get(selectedProductId);
    if (!product) return;

    addItemToDeal(deal.id, {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: productQuantity,
    });

    setSelectedProductId('');
    setProductQuantity(1);
  };

  const handleAddCustomItem = () => {
    const name = customItemName.trim();
    const price = Number(customItemPrice);
    const qty = Number(customItemQuantity);
    if (!name) {
      addToast('Digite o nome do item.', 'warning');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      addToast('Preço inválido.', 'warning');
      return;
    }
    if (!Number.isFinite(qty) || qty < 1) {
      addToast('Quantidade inválida.', 'warning');
      return;
    }

    // "Produto depende do cliente": item livre, sem product_id.
    addItemToDeal(deal.id, {
      productId: '', // deal_items.product_id é opcional no schema; sanitizeUUID('') => null
      name,
      price,
      quantity: qty,
    });

    setCustomItemName('');
    setCustomItemPrice('0');
    setCustomItemQuantity(1);
    setShowCustomItem(false);
  };

  const confirmDeleteDeal = () => {
    if (deleteId) {
      deleteDeal(deleteId);
      addToast('Negócio excluído com sucesso', 'success');
      setDeleteId(null);
      onClose();
    }
  };

  const saveTitle = () => {
    if (editTitle) {
      updateDeal(deal.id, { title: editTitle });
      setIsEditingTitle(false);
    }
  };

  const saveValue = () => {
    if (editValue) {
      updateDeal(deal.id, { value: Number(editValue) });
      setIsEditingValue(false);
    }
  };

  const updateCustomField = (key: string, value: string | number | boolean) => {
    const updatedFields = { ...deal.customFields, [key]: value };
    updateDeal(deal.id, { customFields: updatedFields });
  };

  /**
   * Origem comercial (tráfego pago x carteira própria) da aba "Origem".
   *
   * MESMO caminho de escrita dos campos customizados acima (updateCustomField):
   * merge em `deals.custom_fields` via useUpdateDeal. O valor aqui é um objeto,
   * por isso o merge é explícito em vez de reusar a função de campo escalar.
   */
  const salvarOrigemComercial = (valor: OrigemComercial) =>
    updateDeal(deal.id, { customFields: { ...deal.customFields, origem_comercial: valor } });

  // dealActivities memoized above.

  // Handle escape key to close modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isEditingTitle && !isEditingValue) {
      onClose();
    }
  };

  const inner = (
    <>
    <div
      className={
        isMobile
          ? 'bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 w-full h-[100dvh] flex flex-col overflow-hidden pb-[var(--app-safe-area-bottom,0px)]'
          : 'bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200'
      }
    >
          {/* HEADER (Stage Bar + Won/Lost) */}
          <div className="bg-slate-50 dark:bg-black/20 border-b border-slate-200 dark:border-white/10 p-6 shrink-0">
            <div className="flex justify-between items-start gap-4 mb-4">
              <div className="min-w-0 flex-1">
                {isEditingTitle ? (
                  <div className="flex gap-2 mb-1">
                    <input
                      autoFocus
                      type="text"
                      className="text-2xl font-bold text-slate-900 dark:text-white bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 w-full outline-none focus:ring-2 focus:ring-primary-500"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={e => e.key === 'Enter' && saveTitle()}
                    />
                    <button onClick={saveTitle} className="text-green-500 hover:text-green-400">
                      <Check size={24} />
                    </button>
                  </div>
                ) : (
                  <h2
                    id={headingId}
                    onClick={() => {
                      setEditTitle(deal.title);
                      setIsEditingTitle(true);
                    }}
                    className="text-xl font-semibold text-slate-900 dark:text-white font-display leading-tight cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 flex items-center gap-2 group transition-colors"
                    title="Clique para editar"
                  >
                    {deal.title}
                    <Pencil size={14} className="opacity-0 group-hover:opacity-50 text-slate-400 shrink-0" />
                  </h2>
                )}

                {isEditingValue ? (
                  <div className="flex gap-2 items-center">
                    <span className="text-lg font-mono font-bold text-slate-500">$</span>
                    <input
                      autoFocus
                      type="number"
                      className="text-lg font-mono font-bold text-primary-600 dark:text-primary-400 bg-white dark:bg-black/20 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 w-32 outline-none focus:ring-2 focus:ring-primary-500"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={saveValue}
                      onKeyDown={e => e.key === 'Enter' && saveValue()}
                    />
                    <button onClick={saveValue} className="text-green-500 hover:text-green-400">
                      <Check size={20} />
                    </button>
                  </div>
                ) : (
                  <p
                    onClick={() => {
                      setEditValue(deal.value.toString());
                      setIsEditingValue(true);
                    }}
                    className="text-sm text-slate-500 dark:text-slate-400 font-mono cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 hover:underline decoration-dashed underline-offset-4"
                    title="Clique para editar valor"
                  >
                    ${deal.value.toLocaleString()}
                  </p>
                )}
                {/* Responsável, ao lado do valor. O repasse de lead não existia na
                    interface até 26/08/2026 — só por UPDATE no banco. O Denilson
                    passa a receber todo lead novo e repassa daqui para o consultor. */}
                {podeTrocarDono ? (
                  <DealOwnerSelect
                    dealId={deal.id}
                    ownerId={deal.ownerId ?? null}
                    onChanged={handleOwnerChanged}
                  />
                ) : (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <UserCircle className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                    Responsável:{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">{donoNome}</span>
                  </p>
                )}
                {/* A data/hora da reunião aparece na PRÓPRIA atividade "Ligação diagnóstica"
                    da timeline (ActivityRow, tipo CALL) — não mais num banner solto aqui. */}
              </div>
              <button
                onClick={onClose}
                className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                aria-label="Fechar modal"
              >
                <X size={24} aria-hidden="true" />
              </button>
            </div>

            {/* Barra de ações — o nome ganha a linha inteira acima; as ações não espremem mais o título */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
                {/* Se fechado: mostra badge + botão Reabrir */}
                {(deal.isWon || deal.isLost) ? (
                  <>
                    <span className={`text-xs font-bold px-3 py-1.5 rounded-lg ${deal.isWon ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                      {deal.isWon ? '✓ GANHO' : '✗ PERDIDO'}
                    </span>
                    <button
                      onClick={() => {
                        // Find first non-won/lost stage to reopen to
                        const firstRegularStage = dealBoard?.stages.find(
                          s => s.linkedLifecycleStage !== 'CUSTOMER' && s.linkedLifecycleStage !== 'OTHER'
                        );
                        if (firstRegularStage) {
                          moveDeal(deal, firstRegularStage.id);
                        } else {
                          // Fallback: just clear the won/lost flags
                          updateDeal(deal.id, { isWon: false, isLost: false, closedAt: undefined });
                        }
                      }}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-bold text-sm flex items-center gap-2 transition-all"
                    >
                      ↩ Reabrir
                    </button>
                  </>
                ) : (
                  /* Se aberto: mostra botões Ganho e Perdido */
                  <>
                    <button
                      onClick={() => {
                        // Intelligent "Won" Logic:
                        // 0. Check for "Stay in Stage" flag (Archive/Close in place)
                        if (dealBoard?.wonStayInStage) {
                          moveDeal(deal, deal.status, undefined, true, false);
                          onClose();
                          return;
                        }

                        // 1. Check if board has explicit Won Stage configured
                        if (dealBoard?.wonStageId) {
                          moveDeal(deal, dealBoard.wonStageId);
                          onClose();
                          return;
                        }

                        // 2. Find the appropriate "Success Stage" for this board based on lifecycle
                        const successStage = dealBoard?.stages.find(
                          s => s.linkedLifecycleStage === 'CUSTOMER'
                        ) || dealBoard?.stages.find(
                          s => s.linkedLifecycleStage === 'MQL'
                        ) || dealBoard?.stages.find(
                          s => s.linkedLifecycleStage === 'SALES_QUALIFIED'
                        );

                        if (successStage) {
                          moveDeal(deal, successStage.id);
                        } else {
                          // Fallback: just mark as won without moving
                          updateDeal(deal.id, { isWon: true, isLost: false, closedAt: new Date().toISOString() });
                        }
                        onClose();
                      }}
                      className="px-3.5 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <ThumbsUp size={14} /> Ganho
                    </button>
                    <button
                      onClick={() => {
                        // 0. Check for "Stay in Stage" flag
                        if (dealBoard?.lostStayInStage) {
                          // We don't set pendingLostStageId because we aren't moving to a new stage ID
                          // But the modal logic relies on it? No, if pendingLostStageId is null, we might need another flag.
                          // Actually, let's keep it clean.
                          // setPendingLostStageId(deal.status); // Hack?
                          // Better: Just open modal, and handle logic in confirm.
                        }

                        // If board has explicit Lost Stage, queue it
                        if (dealBoard?.lostStageId) {
                          setPendingLostStageId(dealBoard.lostStageId);
                        }
                        setLossReasonOrigin('button');
                        setShowLossReasonModal(true);
                      }}
                      className="px-3.5 py-1.5 border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg font-medium text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <ThumbsDown size={14} /> Perdido
                    </button>
                  </>
                )}
                <span className="w-px h-6 bg-slate-200 dark:bg-white/10 mx-1 shrink-0" aria-hidden="true" />
                {deal.boardId === CONSULTOR_BOARD_ID && !(deal.customFields as Record<string, unknown> | undefined)?.reuniao_realizada && (
                  <button
                    onClick={() => {
                      if (window.confirm('Marcar reunião como realizada?')) {
                        markMeetingHeld.mutate({ dealId: deal.id });
                      }
                    }}
                    disabled={markMeetingHeld.isPending}
                    className={ACAO_SECUNDARIA}
                    title="Marcar reunião realizada (métrica Agendadas→Realizadas)"
                    aria-label="Marcar reunião realizada"
                  >
                    <CalendarCheck size={14} aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" />
                    <span className="hidden sm:inline">Reunião realizada</span>
                  </button>
                )}
                {deal.boardId === CONSULTOR_BOARD_ID && (() => {
                  const cf = deal.customFields as Record<string, unknown> | undefined;
                  const raStatus = (cf?.reuniao_agendada as { status?: string } | undefined)?.status;
                  // Some depois de "Reunião realizada" — cancelar o que já aconteceu corromperia a métrica.
                  const temReuniao =
                    (raStatus === 'confirmada' || raStatus === 'confirmed') && !cf?.reuniao_realizada;
                  return temReuniao ? (
                    <button
                      onClick={() => {
                        if (window.confirm('Cancelar a reunião marcada? A ligação sai da agenda do consultor e o lead para de receber lembretes.')) {
                          cancelMeeting.mutate({ dealId: deal.id });
                        }
                      }}
                      disabled={cancelMeeting.isPending}
                      className={ACAO_SECUNDARIA}
                      title="Cancelar a reunião marcada"
                      aria-label="Cancelar reunião"
                    >
                      <CalendarX size={14} aria-hidden="true" className="text-rose-600 dark:text-rose-400" />
                      <span className="hidden sm:inline">Cancelar reunião</span>
                    </button>
                  ) : null;
                })()}
                <button
                  onClick={() => setShowMoveModal(true)}
                  className={ACAO_SECUNDARIA}
                  title="Mover este card para outro funil"
                  aria-label="Mover para outro funil"
                >
                  <ArrowRightLeft size={14} aria-hidden="true" className="text-slate-400" />
                  <span className="hidden sm:inline">Mover</span>
                </button>
                <button
                  onClick={() => setShowBriefingDrawer(true)}
                  className={ACAO_SECUNDARIA}
                  title="Preparar para a conversa com este lead"
                  aria-label="Preparar conversa com este lead"
                >
                  <FileText size={14} aria-hidden="true" className="text-primary-500" />
                  <span className="hidden sm:inline">Preparar</span>
                </button>
                <button
                  onClick={() => setDeleteId(deal.id)}
                  className="ml-auto text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  title="Excluir Negócio"
                  aria-label="Excluir negócio"
                >
                  <Trash2 size={24} aria-hidden="true" />
                </button>
              </div>

            {dealBoard ? (
              <StageProgressBar
                stages={dealBoard.stages}
                currentStatus={deal.status}
                variant="timeline"
                onStageClick={stageId => {
                  // Check if clicking on a LOST stage
                  const targetStage = dealBoard.stages.find(s => s.id === stageId);
                  // Check if it matches configured Lost Stage OR explicitly linked 'OTHER' stage
                  const isLostStage =
                    dealBoard.lostStageId === stageId ||
                    targetStage?.linkedLifecycleStage === 'OTHER';

                  if (isLostStage) {
                    // Show loss reason modal
                    setPendingLostStageId(stageId);
                    setLossReasonOrigin('stage');
                    setShowLossReasonModal(true);
                  } else {
                    // Regular move
                    moveDeal(deal, stageId);
                  }
                }}
              />
            ) : (
              <div className="mt-4 rounded-lg border border-slate-200/60 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                Board não encontrado para este negócio. Algumas ações (mover estágio) podem ficar indisponíveis.
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
            {/* Left Sidebar (Static Info + Custom Fields) */}
            <div className="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-slate-200 dark:border-white/5 p-4 sm:p-6 overflow-y-auto bg-white dark:bg-dark-card max-h-[38vh] md:max-h-none">
              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                    <Building2 size={14} /> Empresa (Conta)
                  </h3>
                  <p className="text-slate-900 dark:text-white font-medium">{deal.companyName}</p>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                    <User size={14} /> Contato Principal
                  </h3>
                  {/* EMPILHADO, não em linha única.
                      A tentativa anterior (truncate + shrink-0) não resolveu porque
                      o problema não é só nome longo: esta coluna tem 1/3 do modal, e
                      avatar + selo + botão "Mensagem" já não cabem juntos nem com o
                      nome vazio. Com todos marcados para não encolher, o flex
                      transborda e o botão (fundo opaco, irmão posterior) pinta por
                      cima do selo — foi o que a Thalita viu de novo em 25/08.
                      Empilhar tira a disputa por espaço: nada precisa encolher. */}
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold">
                        {(deal.contactName || '?').charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-slate-900 dark:text-white font-medium text-sm truncate">
                          {deal.contactName || 'Sem contato'}
                        </p>
                        <p className="text-slate-500 text-xs truncate">{deal.contactEmail}</p>
                      </div>
                    </div>

                    {contact?.stage &&
                      (() => {
                        const stage = lifecycleStageById.get(contact.stage);
                        if (!stage) return null;

                        return (
                          <span
                            className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide text-white ${stage.color}`}
                          >
                            {stage.name}
                          </span>
                        );
                      })()}

                    {/* Send Message Button */}
                    {contact?.phone && (
                      <button
                        type="button"
                        onClick={() => {
                          // Navigate to messaging with contact info for new conversation
                          const params = new URLSearchParams({
                            newConversation: 'true',
                            contactId: contact.id,
                            contactName: contact.name || '',
                            contactPhone: contact.phone || '',
                          });
                          router.push(`/messaging?${params.toString()}`);
                          onClose();
                        }}
                        className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 rounded-lg transition-colors"
                        title="Enviar mensagem via WhatsApp"
                      >
                        <MessageSquare size={14} />
                        Mensagem
                      </button>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Detalhes</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Prioridade</span>
                      <span className="text-slate-900 dark:text-white">
                        {formatPriorityPtBr(deal.priority)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Criado em</span>
                      <span className="text-slate-900 dark:text-white">
                        {PT_BR_DATE_FORMATTER.format(new Date(deal.createdAt))}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Probabilidade</span>
                      <span className="text-slate-900 dark:text-white">{deal.probability}%</span>
                    </div>
                  </div>
                </div>

                {/* TAGS */}
                <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                  <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
                    <TagIcon size={14} /> Tags
                  </h3>

                  <div className="flex flex-wrap gap-2">
                    {(deal.tags || []).length === 0 ? (
                      <p className="text-xs text-slate-500 italic">Sem tags.</p>
                    ) : (
                      (deal.tags || []).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => removeDealTag(tag)}
                            className="ml-0.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                            aria-label={`Remover tag ${tag}`}
                            title="Remover tag"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="mt-3">
                    <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1">
                      Adicionar tag
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={tagQuery}
                        onChange={(e) => setTagQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addDealTag(tagQuery);
                          }
                        }}
                        placeholder="Ex: VIP, Urgente, Q4..."
                        className="min-w-0 flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                        aria-label="Adicionar tag"
                      />
                      <button
                        type="button"
                        onClick={() => addDealTag(tagQuery)}
                        disabled={!normalizeTag(tagQuery)}
                        className="shrink-0 h-10 w-10 inline-flex items-center justify-center rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                        aria-label="Adicionar tag"
                        title="Adicionar tag"
                      >
                        <Plus size={18} aria-hidden="true" />
                      </button>
                    </div>

                    {(normalizeTag(tagQuery) && tagSuggestions.length > 0) && (
                      <div className="mt-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
                        {tagSuggestions.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => addDealTag(t)}
                            className="w-full text-left px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* QUALIFICAÇÃO DA SDR (Ana) — resumo pro consultor (só aparece se houver dados) */}
                {sdrPanelHasData(deal.customFields, { compact: true }) && (
                  <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                    <QualificacaoSDRPanel customFields={deal.customFields} compact />
                  </div>
                )}

                {/* AI EXTRACTED FIELDS (Zero Config BANT) */}
                <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                  <AIExtractedFields
                    data={deal.aiExtracted as import('@/lib/ai/extraction/schemas').AIExtractedData | undefined}
                    compact
                  />
                </div>

                {/* DYNAMIC CUSTOM FIELDS INPUTS */}
                {customFieldDefinitions.length > 0 && (
                  <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">
                      Campos Personalizados
                    </h3>
                    <div className="space-y-4">
                      {customFieldDefinitions.map(field => (
                        <div key={field.id}>
                          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                            {field.label}
                          </label>
                          {field.type === 'select' ? (
                            <select
                              value={deal.customFields?.[field.key] || ''}
                              onChange={e => updateCustomField(field.key, e.target.value)}
                              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 text-sm dark:text-white focus:ring-1 focus:ring-primary-500 outline-none"
                            >
                              <option value="">Selecione...</option>
                              {field.options?.map(opt => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={field.type}
                              value={deal.customFields?.[field.key] || ''}
                              onChange={e => updateCustomField(field.key, e.target.value)}
                              className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded px-2 py-1.5 text-sm dark:text-white focus:ring-1 focus:ring-primary-500 outline-none"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Content (Tabs & Timeline) */}
            <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-dark-card">
              <div className="h-14 border-b border-slate-200 dark:border-white/5 flex items-center px-6 shrink-0">
                {/* Ordem pedida pela Thalita (25/08/2026): o que o consultor quer
                    ao abrir o card é o resumo da IA; a timeline vem depois, e
                    produtos por último (raramente usado nesta operação). */}
                <div className="flex gap-6">
                  {([
                    { id: 'info', rotulo: 'IA Insights' },
                    { id: 'origem', rotulo: 'Origem' },
                    { id: 'timeline', rotulo: 'Timeline' },
                    { id: 'products', rotulo: 'Produtos' },
                  ] as const).map(({ id, rotulo }) => (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id)}
                      className={`text-sm font-medium h-14 border-b-2 transition-colors ${activeTab === id ? 'border-primary-500 text-primary-600 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-white'}`}
                    >
                      {rotulo}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30 dark:bg-black/10">
                {activeTab === 'timeline' && (
                  <div className="space-y-6">
                    {/* Microfone em destaque: grava o desfecho da call por voz (áudio→IA→CRM). */}
                    <VoiceOutcomeCapture dealId={deal.id} />
                    {/* Caixa de nota compacta: a nota não FICA aqui, ela vai para a
                        timeline assim que enviada — o campo alto só ocupava a tela
                        (Thalita, 25/08/2026). Começa com uma linha e cresce até 5
                        conforme se escreve; o botão só aparece quando há texto. */}
                    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2">
                      <textarea
                        ref={noteTextareaRef}
                        rows={1}
                        className="w-full bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none resize-none max-h-32"
                        placeholder="Escreva uma nota..."
                        value={newNote}
                        onChange={(e) => {
                          setNewNote(e.target.value);
                          // Cresce com o conteúdo em vez de reservar altura fixa.
                          e.target.style.height = 'auto';
                          e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
                        }}
                      />
                      {newNote.trim() && (
                        <div className="flex justify-end mt-1.5 pt-1.5 border-t border-slate-100 dark:border-white/5">
                          <button
                            onClick={handleAddNote}
                            className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                          >
                            <Check size={13} /> Enviar
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 pl-4 border-l border-slate-200 dark:border-slate-800">
                      {dealActivities.length === 0 && (
                        <p className="text-sm text-slate-500 italic pl-4">
                          Nenhuma atividade registrada.
                        </p>
                      )}
                      {dealActivities.map(activity => (
                        <ActivityRow
                          key={activity.id}
                          activity={activity}
                          deal={deal}
                          onToggleComplete={id => {
                            // Performance: O(1) lookup instead of scanning all activities.
                            const act = activitiesById.get(id);
                            if (act) updateActivity(id, { completed: !act.completed });
                          }}
                          onEdit={() => { }} // Edit not implemented in modal yet
                          onDelete={id => deleteActivity(id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'products' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                    <div className="bg-slate-50 dark:bg-black/20 p-4 rounded-xl border border-slate-200 dark:border-white/10">
                      <h3 className="text-sm font-bold text-slate-700 dark:text-white mb-3 flex items-center gap-2">
                        <Package size={16} /> Adicionar Produto/Serviço
                      </h3>
                      <div className="flex gap-3">
                        <select
                          className="flex-1 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                          value={selectedProductId}
                          onChange={e => setSelectedProductId(e.target.value)}
                        >
                          <option value="">Selecione um item...</option>
                          {products.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name} - ${p.price}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          className="w-20 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                          value={productQuantity}
                          onChange={e => setProductQuantity(parseInt(e.target.value))}
                        />
                        <button
                          onClick={handleAddProduct}
                          disabled={!selectedProductId}
                          className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                        >
                          Adicionar
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Produto depende do cliente? Use um item personalizado (não precisa estar no catálogo).
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowCustomItem(v => !v)}
                          className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:underline"
                        >
                          {showCustomItem ? 'Fechar' : 'Adicionar item personalizado'}
                        </button>
                      </div>

                      {showCustomItem && (
                        <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 p-3">
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                            <div className="sm:col-span-6">
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Nome do item</label>
                              <input
                                value={customItemName}
                                onChange={e => setCustomItemName(e.target.value)}
                                placeholder="Ex.: Pacote personalizado, Procedimento X…"
                                className="w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Preço</label>
                              <input
                                value={customItemPrice}
                                onChange={e => setCustomItemPrice(e.target.value)}
                                inputMode="decimal"
                                className="w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Qtd</label>
                              <input
                                type="number"
                                min={1}
                                value={customItemQuantity}
                                onChange={e => setCustomItemQuantity(parseInt(e.target.value))}
                                className="w-full bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-white"
                              />
                            </div>
                            <div className="sm:col-span-1">
                              <button
                                type="button"
                                onClick={handleAddCustomItem}
                                className="w-full bg-primary-600 hover:bg-primary-500 text-white px-3 py-2 rounded-lg text-sm font-bold transition-colors"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 dark:bg-black/20 border-b border-slate-200 dark:border-white/5 text-slate-500 dark:text-slate-400 font-medium">
                          <tr>
                            <th className="px-4 py-3">Item</th>
                            <th className="px-4 py-3 w-20 text-center">Qtd</th>
                            <th className="px-4 py-3 w-32 text-right">Preço Unit.</th>
                            <th className="px-4 py-3 w-32 text-right">Total</th>
                            <th className="px-4 py-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {!deal.items || deal.items.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-8 text-center text-slate-500 italic">
                                Nenhum produto adicionado. O valor do negócio é manual.
                              </td>
                            </tr>
                          ) : (
                            deal.items.map(item => (
                              <tr key={item.id}>
                                <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">
                                  {item.name}
                                </td>
                                <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-300">
                                  {item.quantity}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                                  ${item.price.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                                  ${(item.price * item.quantity).toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <button
                                    onClick={() => removeItemFromDeal(deal.id, item.id)}
                                    className="text-slate-400 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                        <tfoot className="bg-slate-50 dark:bg-black/20 border-t border-slate-200 dark:border-white/5">
                          <tr>
                            <td
                              colSpan={3}
                              className="px-4 py-3 text-right font-bold text-slate-700 dark:text-slate-300 uppercase text-xs tracking-wider"
                            >
                              Total do Pedido
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-primary-600 dark:text-primary-400 text-lg">
                              ${deal.value.toLocaleString()}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'info' && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                    {sdrPanelHasData(deal.customFields) && (
                      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm">
                        <QualificacaoSDRPanel customFields={deal.customFields} />
                      </div>
                    )}
                    <div className="bg-linear-to-br from-primary-50 to-white dark:from-primary-900/10 dark:to-dark-card p-6 rounded-xl border border-primary-100 dark:border-primary-500/20">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-primary-100 dark:bg-primary-500/20 rounded-lg text-primary-600 dark:text-primary-400">
                          <BrainCircuit size={20} />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 dark:text-white font-display text-lg">
                            Insights Gemini
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Inteligência Artificial aplicada ao negócio
                          </p>
                        </div>
                      </div>

                      {/* STRATEGY CONTEXT BAR */}
                      {dealBoard?.agentPersona && (
                        <div className="mb-6 bg-slate-900/5 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg p-3 flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-linear-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
                            <Bot size={20} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 px-1.5 py-0.5 rounded">
                                Atuando como
                              </span>
                            </div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                              {dealBoard.agentPersona?.name}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {dealBoard.agentPersona?.role} • Foco: {dealBoard.goal?.kpi || 'Geral'}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="flex gap-3 mb-5">
                        <button
                          onClick={handleAnalyzeDeal}
                          disabled={isAnalyzing}
                          className="flex-1 py-2.5 bg-white dark:bg-white/5 text-slate-700 dark:text-white text-sm font-medium rounded-lg shadow-sm border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                        >
                          {isAnalyzing ? (
                            <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                          ) : (
                            <BrainCircuit size={16} />
                          )}
                          Analisar Negócio
                        </button>
                        <button
                          onClick={handleDraftEmail}
                          disabled={isDrafting}
                          className="flex-1 py-2.5 bg-white dark:bg-white/5 text-slate-700 dark:text-white text-sm font-medium rounded-lg shadow-sm border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                        >
                          {isDrafting ? (
                            <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                          ) : (
                            <Mail size={16} />
                          )}
                          Escrever Email
                        </button>
                      </div>
                      {aiResult && (
                        <div className="bg-white/80 dark:bg-black/40 backdrop-blur-md p-4 rounded-lg border border-primary-100 dark:border-primary-500/20 mb-4">
                          <div className="flex justify-between mb-2 border-b border-primary-100 dark:border-white/5 pb-2">
                            <span className="text-xs font-bold text-primary-700 dark:text-primary-300 uppercase tracking-wider">
                              Sugestão
                            </span>
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10 px-2 rounded">
                              {aiResult.score}% Chance
                            </span>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                            {aiResult.suggestion}
                          </p>
                        </div>
                      )}
                      {emailDraft && (
                        <div className="bg-white/80 dark:bg-black/40 backdrop-blur-md p-4 rounded-lg border border-primary-100 dark:border-primary-500/20">
                          <h4 className="text-xs font-bold text-primary-700 dark:text-primary-300 uppercase tracking-wider mb-2">
                            Rascunho de Email
                          </h4>
                          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed italic">
                            "{emailDraft}"
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="bg-rose-50 dark:bg-rose-900/10 p-6 rounded-xl border border-rose-100 dark:border-rose-500/20">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-rose-100 dark:bg-rose-500/20 rounded-lg text-rose-600 dark:text-rose-400">
                          <Sword size={20} />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-900 dark:text-white font-display text-lg">
                            Objection Killer
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            O cliente está difícil? A IA te ajuda a negociar.
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2 mb-4">
                        <input
                          type="text"
                          className="flex-1 bg-white dark:bg-white/5 border border-rose-200 dark:border-rose-500/20 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rose-500 dark:text-white"
                          placeholder="Ex: 'Achamos o preço muito alto' ou 'Preciso falar com meu sócio'"
                          value={objection}
                          onChange={e => setObjection(e.target.value)}
                        />
                        <button
                          onClick={handleObjection}
                          disabled={isGeneratingObjections || !objection.trim()}
                          className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                        >
                          {isGeneratingObjections ? (
                            <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                          ) : (
                            'Gerar Respostas'
                          )}
                        </button>
                      </div>

                      {objectionResponses.length > 0 && (
                        <div className="space-y-3">
                          {objectionResponses.map((resp, idx) => (
                            <div
                              key={idx}
                              className="bg-white dark:bg-white/5 p-3 rounded-lg border border-rose-100 dark:border-rose-500/10 flex gap-3"
                            >
                              <div className="shrink-0 w-6 h-6 bg-rose-100 dark:bg-rose-500/20 rounded-full flex items-center justify-center text-rose-600 dark:text-rose-400 font-bold text-xs">
                                {idx + 1}
                              </div>
                              <p className="text-sm text-slate-700 dark:text-slate-200">{resp}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ORIGEM: de onde o lead veio (anúncio + criativo + formulário) e
                    como ele chegou comercialmente (tráfego pago x carteira própria).
                    Nasceu em 26/08/2026, quando um lead falou do "vídeo do anúncio"
                    e o Pedro não sabia qual vídeo era nem o que ele prometia. */}
                {activeTab === 'origem' && (
                  <OrigemDoLeadPanel
                    dealId={deal.id}
                    customFields={deal.customFields}
                    onSalvarOrigemComercial={salvarOrigemComercial}
                  />
                )}

              </div>
            </div>
          </div>
        </div>

        <ConfirmModal
          isOpen={Boolean(deleteId)}
          onClose={() => setDeleteId(null)}
          onConfirm={confirmDeleteDeal}
          title="Excluir Negócio"
          message="Tem certeza que deseja excluir este negócio? Esta ação não pode ser desfeita."
          confirmText="Excluir"
          variant="danger"
        />

        <LossReasonModal
          isOpen={showLossReasonModal}
          onClose={() => {
            setShowLossReasonModal(false);
            setPendingLostStageId(null);
            setLossReasonOrigin('button');
          }}
          onConfirm={(reason) => {
            // Priority:
            // 0. Stay in stage flag (Archive)
            // 1. Pending Stage (if set via click or explicit button)
            // 2. Explicit Lost Stage on Board
            // 3. Stage linked to 'OTHER' lifecycle

            if (dealBoard?.lostStayInStage) {
              moveDeal(deal, deal.status, reason, false, true); // explicitLost = true
              setShowLossReasonModal(false);
              setPendingLostStageId(null);
              if (lossReasonOrigin === 'button') onClose();
              return;
            }

            let targetStageId = pendingLostStageId;

            if (!targetStageId && dealBoard?.lostStageId) {
              targetStageId = dealBoard.lostStageId;
            }

            if (!targetStageId) {
              targetStageId =
                dealBoard?.stages.find(s => s.linkedLifecycleStage === 'OTHER')?.id ?? null;
            }

            if (targetStageId) {
              moveDeal(deal, targetStageId, reason);
            } else {
              // Fallback: just mark as lost without moving
              updateDeal(deal.id, { isLost: true, isWon: false, closedAt: new Date().toISOString(), lossReason: reason });
            }
            setShowLossReasonModal(false);
            setPendingLostStageId(null);
            // Only close the deal modal if it was triggered via the "PERDIDO" button
            if (lossReasonOrigin === 'button') onClose();
          }}
          dealTitle={deal.title}
        />

        {/* Mover para outro funil — seleção do destino */}
        {showMoveModal && (
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Mover para outro funil"
            onClick={(e) => { if (e.target === e.currentTarget) setShowMoveModal(false); }}
          >
            <div className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-white/10 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display mb-1">Mover para outro funil</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                O card sai deste funil e entra na primeira etapa do funil escolhido.
              </p>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {boards.filter((b) => b.id !== deal.boardId).length === 0 ? (
                  <p className="text-sm text-slate-500 italic">Não há outro funil pra onde mover.</p>
                ) : (
                  boards
                    .filter((b) => b.id !== deal.boardId)
                    .map((b) => {
                      const missing = missingForBoardMove(b.id, deal.customFields);
                      return (
                        <button
                          key={b.id}
                          onClick={() => { setMoveTarget(b); setShowMoveModal(false); }}
                          className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 hover:border-primary-400 dark:hover:border-primary-500/50 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors flex items-center justify-between gap-3"
                        >
                          <span className="font-medium text-slate-900 dark:text-white truncate">{b.name}</span>
                          {missing.length > 0 && (
                            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20">
                              faltam {missing.length}
                            </span>
                          )}
                        </button>
                      );
                    })
                )}
              </div>
              <div className="mt-5 flex justify-end">
                <button
                  onClick={() => setShowMoveModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmação do move — com o aviso do portão (avisa e deixa mover) */}
        <ConfirmModal
          isOpen={!!moveTarget}
          onClose={() => setMoveTarget(null)}
          onConfirm={handleConfirmMove}
          title={moveTarget ? `Mover para ${moveTarget.name}` : ''}
          message={
            moveMissing.length > 0 ? (
              <div className="text-left">
                <p className="mb-2">Faltam dados obrigatórios pra entrar no funil do Consultor:</p>
                <ul className="list-disc list-inside text-sm text-amber-700 dark:text-amber-300 mb-3 space-y-0.5">
                  {moveMissing.map((m) => <li key={m}>{m}</li>)}
                </ul>
                <p>Mover <strong>{deal.title}</strong> mesmo assim?</p>
              </div>
            ) : (
              <p>Mover <strong>{deal.title}</strong> para <strong>{moveTarget?.name}</strong>?</p>
            )
          }
          confirmText="Mover"
          variant="primary"
        />

        <BriefingDrawer
          dealId={deal.id}
          dealTitle={deal.title}
          isOpen={showBriefingDrawer}
          onClose={() => setShowBriefingDrawer(false)}
        />
    </>
  );

  if (isMobile) {
    return (
      <DealSheet isOpen={isOpen} onClose={onClose} ariaLabel={`Negócio: ${deal.title}`}>
        <div onKeyDown={handleKeyDown}>{inner}</div>
      </DealSheet>
    );
  }

  return (
    <FocusTrap active={isOpen} onEscape={onClose}>
      <div
        // Backdrop + positioning wrapper. Clicking outside the panel should close the modal.
        // No desktop, este modal não deve cobrir a sidebar de navegação.
        // Em md+ deslocamos o overlay pela largura da sidebar via `--app-sidebar-width`.
        className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={handleKeyDown}
        onClick={(e) => {
          // Only close when clicking the backdrop, not when clicking inside the panel.
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {inner}
      </div>
    </FocusTrap>
  );
};
