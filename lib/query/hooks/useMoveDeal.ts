/**
 * Unified hook for moving deals between stages
 * 
 * This is the SINGLE SOURCE OF TRUTH for deal movement logic.
 * Use this hook everywhere instead of calling updateDeal/updateDealStatus directly.
 * 
 * Features:
 * - Detects won/lost stages via linkedLifecycleStage
 * - Creates activity history entries
 * - Updates contact lifecycle stage (LinkedStage automation)
 * - MOVE o card para o próximo funil ao ganhar (NextBoard automation) — não copia, e por ROTA DE
 *   SERVIDOR (`/api/deals/[dealId]/proximo-funil`), porque o destino é um funil que quem vendeu
 *   normalmente NÃO enxerga pela RLS
 * - Optimistic updates for instant UI feedback
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys, DEALS_VIEW_KEY } from '../queryKeys';
import { dealsService } from '@/lib/supabase';
import { activitiesService } from '@/lib/supabase/activities';
import { contactsService } from '@/lib/supabase/contacts';
import type { Deal, DealView, Board, Activity } from '@/types';

interface MoveDealParams {
  dealId: string;
  targetStageId: string;
  lossReason?: string;
  // Context needed for automations
  deal: Deal | DealView;
  board: Board;
  lifecycleStages?: { id: string; name: string }[];
  explicitWin?: boolean;
  explicitLost?: boolean;
}

interface MoveDealResult {
  dealId: string;
  newStatus: string;
  isWon?: boolean;
  isLost?: boolean;
}

// Context type for optimistic updates
interface MoveDealContext {
  previousDeals: DealView[] | undefined;
}

/**
 * Registra na timeline que o envio para o próximo funil falhou.
 *
 * Falha silenciosa aqui recria exatamente o problema de 26/08: ninguém descobre que o card não
 * saiu do funil de origem até alguém sentir falta dele.
 */
function registrarFalhaNaTimeline(deal: Deal | DealView, titulo: string, mensagem: string): void {
  activitiesService.create({
    dealId: deal.id,
    dealTitle: deal.title,
    type: 'STATUS_CHANGE',
    title: titulo,
    description: mensagem,
    date: new Date().toISOString(),
    completed: true,
    user: { name: 'Sistema', avatar: '' },
  } as Omit<Activity, 'id' | 'createdAt'>).catch(console.error);
}

/** Aplica a mesma correção nos dois caches que desenham o card (lista do board e detalhe). */
function aplicarNoCache(queryClient: QueryClient, dealId: string, patch: Partial<Deal>): void {
  const updatedAt = new Date().toISOString();

  queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) =>
    old?.map((d) => (d.id === dealId ? { ...d, ...patch, updatedAt } : d)),
  );
  queryClient.setQueryData<Deal>(queryKeys.deals.detail(dealId), (old) =>
    old ? { ...old, ...patch, updatedAt } : old,
  );
}

interface EnviarParaProximoFunilParams {
  deal: Deal | DealView;
  /** Funil de origem — onde a venda foi fechada. Serve para desfazer o otimismo do cache. */
  board: Board;
  queryClient: QueryClient;
}

/** Corpo devolvido por `POST /api/deals/[dealId]/proximo-funil`. */
interface RespostaProximoFunil {
  movido?: boolean;
  /** 'sem_proximo_funil' | 'sem_funil_de_origem' | 'nao_e_etapa_de_ganho'. */
  motivo?: string;
  boardId?: string;
  boardNome?: string;
  stageId?: string | null;
  ownerId?: string | null;
  /** Mudou de funil, mas a venda NÃO foi carimbada — ela some da meta do mês. */
  carimboFalhou?: boolean;
  error?: string;
}

/**
 * Automação "ao ganhar, vai pro próximo funil": MOVE o card, não copia — e quem move é o SERVIDOR.
 *
 * Duas correções empilhadas, ambas de 26/08:
 *
 * 1. NÃO COPIA MAIS. Isto chamava `dealsService.create` e criava um card NOVO no destino. As
 *    atividades, notas e a conversa de WhatsApp continuavam presas ao card antigo — que ainda
 *    ficava no Comercial marcado como ganho — e a Implantação recebia card EM BRANCO (Richard
 *    Gois: 0 itens de timeline contra 3 no original; Mavie Ramunno: 1 contra 4). Movendo o MESMO
 *    deal, o histórico viaja junto: "não tem como o mesmo card estar aberto em vários funis"
 *    (Thalita).
 *
 * 2. NÃO ESCREVE MAIS PELO CLIENTE. Desde o acesso por funil (24/08) o Pedro só tem `board_access`
 *    do 'Comercial — Consultor': ler o funil 'Implantação — ADM' pelo cliente devolve NULL
 *    (`boards_select` = `pode_ver_board(id)`) e, mesmo que devolvesse, o WITH CHECK de
 *    `deals_update` é avaliado na LINHA NOVA e REJEITARIA o update que joga o card para lá. Ou
 *    seja: pelo cliente, quem vende nunca consegue entregar a venda. A rota confere a permissão no
 *    funil de ORIGEM com o cliente do usuário e só então escreve com service role.
 *
 * Nunca lança: o ganho já foi gravado antes desta chamada e não pode ser desfeito por causa da
 * automação. Todo caminho que não moveu devolve o card ao funil de origem no cache (ou ao funil que
 * a ROTA disser, quando ela sabe onde o card está de verdade) — sem isso ele some da tela de quem
 * só enxerga a origem, o "sumiço de card" que já assombrou a operação.
 */
async function enviarParaProximoFunil({
  deal,
  board,
  queryClient,
}: EnviarParaProximoFunilParams): Promise<void> {
  const res = await fetch(`/api/deals/${deal.id}/proximo-funil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const corpo = (await res.json().catch(() => ({}))) as RespostaProximoFunil;

  if (!res.ok) {
    const mensagem =
      corpo.error ||
      `A automação de ganho não conseguiu enviar o card para o próximo funil. Ele continua em "${board.name}" e precisa ser movido na mão.`;
    console.error('[Automação próximo funil] a rota recusou o move:', res.status, mensagem);
    registrarFalhaNaTimeline(deal, 'Falha ao enviar para o próximo funil', mensagem);
    aplicarNoCache(queryClient, deal.id, { boardId: board.id });
    return;
  }

  if (!corpo.movido) {
    // Nada mudou no servidor, e isso não é erro: ou não há próximo funil configurado (o cache do
    // board estava adiantado), ou o servidor viu que aquela etapa não é de ganho — o guard de
    // re-entrada da rota, que impede uma segunda chamada de empurrar o card de novo. Quando a rota
    // informa onde o card está (`boardId`), a tela segue o servidor: devolvê-lo para a origem é
    // que seria a mentira.
    aplicarNoCache(queryClient, deal.id, {
      boardId: corpo.boardId ?? board.id,
      ...(corpo.stageId ? { status: corpo.stageId } : {}),
    });
    return;
  }

  // O card mudou de funil sem o carimbo: para a operação parece tudo certo, mas a venda não entra
  // na contagem do mês (a barra de meta lê `custom_fields.venda`, não `is_won`). Tem que ficar na
  // timeline, senão ninguém descobre — é o mesmo silêncio que fez a Thalita perder dois cards.
  if (corpo.carimboFalhou) {
    console.error('[Automação próximo funil] card movido SEM carimbo da venda:', deal.id);
    registrarFalhaNaTimeline(
      deal,
      'Venda sem carimbo',
      `O card foi para "${corpo.boardNome ?? 'o próximo funil'}", mas o carimbo da venda não foi gravado: ela não vai aparecer na meta do mês nem nos relatórios. Avise o administrador.`,
    );
  }

  aplicarNoCache(queryClient, deal.id, {
    boardId: corpo.boardId ?? board.id,
    ...(corpo.stageId ? { status: corpo.stageId } : {}),
    isWon: false,
    isLost: false,
    ...(corpo.ownerId ? { ownerId: corpo.ownerId } : {}),
  });
}

/**
 * Hook React `useMoveDeal` que encapsula uma lógica reutilizável.
 * @returns {UseMutationResult<MoveDealResult, Error, MoveDealParams, MoveDealContext>} Retorna um valor do tipo `UseMutationResult<MoveDealResult, Error, MoveDealParams, MoveDealContext>`.
 */
export const useMoveDeal = () => {
  const queryClient = useQueryClient();

  return useMutation<MoveDealResult, Error, MoveDealParams, MoveDealContext>({
    mutationFn: async ({ dealId, targetStageId, lossReason, deal, board, lifecycleStages, explicitWin, explicitLost }) => {
      const targetStage = board.stages.find(s => s.id === targetStageId);

      // Determine isWon/isLost based on params OR linkedLifecycleStage
      let isWon: boolean | undefined;
      let isLost: boolean | undefined;
      let closedAt: string | null | undefined;

      if (explicitWin) {
        isWon = true;
        isLost = false;
        closedAt = new Date().toISOString();
      } else if (explicitLost) {
        isLost = true;
        isWon = false;
        closedAt = new Date().toISOString();
      } else if (
        // Prefer explicit won/lost stages when configured on the board.
        // Fallback to lifecycle hints ONLY when the board doesn't define won/lost IDs.
        (
          board.wonStageId
            ? targetStageId === board.wonStageId
            : (board.linkedLifecycleStage !== 'CUSTOMER' && targetStage?.linkedLifecycleStage === 'CUSTOMER')
        )
      ) {
        isWon = true;
        isLost = false;
        closedAt = new Date().toISOString();
      } else if (
        (board.lostStageId ? targetStageId === board.lostStageId : targetStage?.linkedLifecycleStage === 'OTHER')
      ) {
        isLost = true;
        isWon = false;
        closedAt = new Date().toISOString();
      } else {
        // Moving to a regular stage - reopen if was closed
        if (deal.isWon || deal.isLost) {
          isWon = false;
          isLost = false;
          closedAt = null;
        }
      }

      // Build updates object
      const updates: Partial<Deal> = {
        status: targetStageId,
        lastStageChangeDate: new Date().toISOString(),
        ...(lossReason && { lossReason }),
        ...(isWon !== undefined && { isWon }),
        ...(isLost !== undefined && { isLost }),
        ...(closedAt !== undefined && { closedAt: closedAt as string }),
      };

      // 1. Update the deal
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        const logData = {
          dealId: dealId.slice(0, 8),
          targetStageId: targetStageId.slice(0, 8),
          updates: { status: targetStageId.slice(0, 8), isWon, isLost },
        };
        console.log(`[useMoveDeal] 📤 Sending update to server`, logData);
      }
      // #endregion
      
      const { error: dealError } = await dealsService.update(dealId, updates);
      if (dealError) {
        // #region agent log
        if (process.env.NODE_ENV !== 'production') {
          const logData = { dealId: dealId.slice(0, 8), error: String(dealError) };
          console.log(`[useMoveDeal] ❌ Server update failed`, logData);
        }
        // #endregion
        throw dealError;
      }
      
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        const logData = { dealId: dealId.slice(0, 8), targetStageId: targetStageId.slice(0, 8) };
        console.log(`[useMoveDeal] ✅ Server update confirmed`, logData);
      }
      // #endregion

      // 2. Create activity "Moveu para X" (fire and forget - don't block UI)
      const stageLabel = targetStage?.label || targetStageId;
      activitiesService.create({
        dealId,
        dealTitle: deal.title,
        type: 'STATUS_CHANGE',
        title: `Moveu para ${stageLabel}`,
        description: lossReason ? `Motivo da perda: ${lossReason}` : undefined,
        date: new Date().toISOString(),
        completed: true,
        user: { name: 'Sistema', avatar: '' },
      } as Omit<Activity, 'id' | 'createdAt'>).catch(console.error);

      // 3. LinkedStage: Update contact stage when moving to linked column
      if (targetStage?.linkedLifecycleStage && deal.contactId) {
        const lifecycleStageName =
          lifecycleStages?.find(ls => ls.id === targetStage.linkedLifecycleStage)?.name ||
          targetStage.linkedLifecycleStage;

        contactsService.update(deal.contactId, {
          stage: targetStage.linkedLifecycleStage
        }).catch(console.error);

        activitiesService.create({
          dealId,
          dealTitle: deal.title,
          type: 'STATUS_CHANGE',
          title: `Contato promovido para ${lifecycleStageName}`,
          description: `Automático via LinkedStage da etapa "${targetStage.label}"`,
          date: new Date().toISOString(),
          completed: true,
          user: { name: 'Sistema', avatar: '' },
        } as Omit<Activity, 'id' | 'createdAt'>).catch(console.error);
      }

      // 4. NextBoard Automation: ao ganhar, o card MUDA DE FUNIL (MOVE, não copia — ver
      //    `enviarParaProximoFunil`).
      const isSuccessStage =
        isWon ||
        targetStage?.linkedLifecycleStage === 'MQL' ||
        targetStage?.linkedLifecycleStage === 'SALES_QUALIFIED';

      // GANHO chama a rota SEMPRE, com ou sem próximo funil: em funil de ponta (Nutrição,
      // Clientes Ativos) a rota não move nada, mas CARIMBA a venda — sem o carimbo, o ganho
      // não existe para a barra de meta, para o "Já ganho no mês" nem para a pendência de
      // prêmio. Para promoção de lead (MQL/SALES_QUALIFIED), sem próximo funil não há nada a
      // fazer no servidor, e aí sim o gate economiza a request.
      if (isSuccessStage && (isWon || board.nextBoardId)) {
        // AGUARDA (antes era um `(async () => {...})()` solto): fire-and-forget morria junto com a
        // aba se a pessoa fechasse a tela logo depois do drag, e o card ficava preso no ganho do
        // funil de origem. O try/catch garante que uma falha aqui não derruba o drag — o deal já
        // foi marcado como ganho lá em cima e não pode voltar por causa da automação.
        //
        // Quem decide se há próximo funil de verdade é a ROTA (lê `boards.next_board_id` com
        // service role); o `board.nextBoardId` daqui é só para não gastar uma request à toa.
        try {
          await enviarParaProximoFunil({ deal, board, queryClient });
          // A barra de meta e o "Já ganho no mês" leem o CARIMBO da venda
          // (`custom_fields.venda`), não `is_won` — porque o card ganho sai deste funil. Sem esta
          // invalidação os dois números ficariam parados até o staleTime de 2 min ou um foco de
          // janela, e quem acabou de fechar veria a meta sem mexer.
          //
          // Ao contrário de DEALS_VIEW_KEY, esta chave pode ser invalidada sem medo: ela não é
          // alimentada por Realtime, então não existe a corrida com o update otimista que fez o
          // resto deste hook evitar invalidação.
          queryClient.invalidateQueries({ queryKey: queryKeys.vendasDoFunil.all });
        } catch (err) {
          // Só cai aqui em falha de REDE (a rota traduz os próprios erros e responde com corpo):
          // a request nem chegou, então o card ficou exatamente onde estava.
          console.error('[Automação próximo funil] erro inesperado:', err);
          registrarFalhaNaTimeline(
            deal,
            'Falha ao enviar para o próximo funil',
            `A automação de ganho não conseguiu mover o card para o próximo funil. Ele continua em "${board.name}" e precisa ser movido na mão.`,
          );
          // Devolve o `boardId` que o onMutate já tinha trocado, senão ele some da coluna de ganho
          // sem ter ido a lugar nenhum.
          aplicarNoCache(queryClient, dealId, { boardId: board.id });
        }
      }

      return { dealId, newStatus: targetStageId, isWon, isLost };
    },

    // Optimistic update: update UI instantly before server responds
    onMutate: async ({ dealId, targetStageId, deal, explicitWin, explicitLost, board }) => {
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        const logData = {
          dealId: dealId.slice(0, 8),
          targetStageId: targetStageId.slice(0, 8),
          currentStatus: deal.status?.slice(0, 8) || 'null',
        };
        console.log(`[useMoveDeal] 🚀 Starting optimistic update`, logData);
      }
      // #endregion
      
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.all });

      // Snapshot previous state - usa DEALS_VIEW_KEY (única fonte de verdade)
      const previousDeals = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY);

      // Determine new status
      const targetStage = board.stages.find(s => s.id === targetStageId);
      const isWon =
        explicitWin
        || (
          board.wonStageId
            ? targetStageId === board.wonStageId
            : (board.linkedLifecycleStage !== 'CUSTOMER' && targetStage?.linkedLifecycleStage === 'CUSTOMER')
        );
      const isLost =
        explicitLost
        || (board.lostStageId ? targetStageId === board.lostStageId : targetStage?.linkedLifecycleStage === 'OTHER');

      // O card não só muda de coluna: ganhando num funil com `nextBoardId` ele SAI deste funil e
      // entra no seguinte. Sem refletir isso no cache, ele fica desenhado na coluna de ganho do
      // funil antigo até alguém dar F5. A etapa de entrada do destino só é conhecida depois do
      // move (o mutationFn corrige o `status` quando ela chega).
      const vaiParaOutroFunil = Boolean(
        board.nextBoardId
        && (isWon
          || targetStage?.linkedLifecycleStage === 'MQL'
          || targetStage?.linkedLifecycleStage === 'SALES_QUALIFIED'),
      );
      const boardIdOtimista: string | undefined = vaiParaOutroFunil ? board.nextBoardId : undefined;

      // Optimistically update APENAS DEALS_VIEW_KEY (única fonte de verdade)
      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) => {
        if (!old) return old;
        
        const dealInCache = old.find(d => d.id === dealId);
        // #region agent log
        if (process.env.NODE_ENV !== 'production') {
          const logData = {
            cacheSize: old.length,
            dealFound: !!dealInCache,
            currentStatus: dealInCache?.status?.slice(0, 8) || 'null',
          };
          console.log(`[useMoveDeal] 📊 Processing DEALS_VIEW_KEY cache`, logData);
        }
        // #endregion
        
        return old.map(d => {
          if (d.id === dealId) {
            const newDeal = {
              ...d,
              status: targetStageId,
              lastStageChangeDate: new Date().toISOString(),
              isWon: isWon ?? d.isWon,
              isLost: isLost ?? d.isLost,
              updatedAt: new Date().toISOString(),
              boardId: boardIdOtimista ?? d.boardId,
            };
            // #region agent log
            if (process.env.NODE_ENV !== 'production') {
              const logData = {
                dealId: dealId.slice(0, 8),
                oldStatus: d.status?.slice(0, 8) || 'null',
                newStatus: targetStageId.slice(0, 8),
                updatedAt: newDeal.updatedAt,
              };
              console.log(`[useMoveDeal] ✅ Optimistic update applied`, logData);
            }
            // #endregion
            return newDeal;
          }
          return d;
        });
      });

      // Também atualizar o detail cache se existir
      queryClient.setQueryData<Deal>(queryKeys.deals.detail(dealId), (old) => {
        if (!old) return old;
        return {
          ...old,
          status: targetStageId,
          lastStageChangeDate: new Date().toISOString(),
          isWon: isWon ?? old.isWon,
          isLost: isLost ?? old.isLost,
          updatedAt: new Date().toISOString(),
          boardId: boardIdOtimista ?? old.boardId,
        };
      });

      return { previousDeals };
    },

    // Rollback on error
    onError: (_err, _variables, context) => {
      if (context?.previousDeals) {
        queryClient.setQueryData(DEALS_VIEW_KEY, context.previousDeals);
      }
    },

    // Only refetch deals on success (not contacts, not activities)
    // NOTE: We DON'T invalidate here to avoid race condition with Realtime.
    // The Realtime UPDATE event will handle synchronization.
    // Invalidating here causes the deal to "jump back" because:
    // 1. Optimistic update moves deal visually
    // 2. Server confirms update
    // 3. onSettled invalidates → refetch (may get stale data if timing is off)
    // 4. Realtime UPDATE arrives → invalidates again → refetch (may overwrite with old data)
    // By skipping invalidation here, we let Realtime handle sync naturally.
    onSettled: () => {
      // #region agent log
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[useMoveDeal] ⏸️ onSettled called (skipping invalidation, waiting for Realtime)`);
      }
      // #endregion
      // Let Realtime handle synchronization - it will invalidate when the UPDATE event arrives
    },
  });
};

/**
 * Hook React `useMoveDealSimple` que encapsula uma lógica reutilizável.
 *
 * @param {Board | null} board - Parâmetro `board`.
 * @param {{ id: string; name: string; }[] | undefined} lifecycleStages - Parâmetro `lifecycleStages`.
 * @returns {{ moveDeal: (deal: Deal | DealView, targetStageId: string, lossReason?: string | undefined, explicitWin?: boolean | undefined, explicitLost?: boolean | undefined) => Promise<...>; isMoving: boolean; error: Error | null; }} Retorna um valor do tipo `{ moveDeal: (deal: Deal | DealView, targetStageId: string, lossReason?: string | undefined, explicitWin?: boolean | undefined, explicitLost?: boolean | undefined) => Promise<...>; isMoving: boolean; error: Error | null; }`.
 */
export const useMoveDealSimple = (
  board: Board | null,
  lifecycleStages?: { id: string; name: string }[]
) => {
  const moveDealMutation = useMoveDeal();

  const moveDeal = async (
    deal: Deal | DealView,
    targetStageId: string,
    lossReason?: string,
    explicitWin?: boolean,
    explicitLost?: boolean
  ) => {
    if (!board) {
      console.error('[useMoveDealSimple] No board provided');
      return;
    }

    return moveDealMutation.mutateAsync({
      dealId: deal.id,
      targetStageId,
      lossReason,
      deal,
      board,
      lifecycleStages,
      explicitWin,
      explicitLost,
    });
  };

  return {
    moveDeal,
    isMoving: moveDealMutation.isPending,
    error: moveDealMutation.error,
  };
};

interface MoveDealToBoardParams {
  deal: Deal | DealView;
  targetBoard: Board;
  /** Nome de quem está movendo (vai pra timeline). */
  moverName: string;
}

/**
 * MOVE (não copia) um deal para OUTRO funil.
 *
 * Atualiza `board_id` + etapa de entrada no MESMO deal — consistente com a decisão
 * do handoff Ana→Consultor (uma fonte de verdade: a CALL/`custom_fields` viajam com
 * o card, sem cópia congelada). Registra QUEM moveu na timeline.
 *
 * O portão de dados (quando destino = Consultor) é da UI (avisa e deixa mover) —
 * este hook só executa o move.
 */
export const useMoveDealToBoard = () => {
  const queryClient = useQueryClient();

  return useMutation<
    { dealId: string; boardId: string; status: string },
    Error,
    MoveDealToBoardParams,
    { previousDeals: DealView[] | undefined }
  >({
    mutationFn: async ({ deal, targetBoard, moverName }) => {
      const entryStageId = targetBoard.stages?.[0]?.id;
      if (!entryStageId) throw new Error(`O funil "${targetBoard.name}" não tem etapas.`);

      const updates: Partial<Deal> = {
        boardId: targetBoard.id,
        status: entryStageId,
        lastStageChangeDate: new Date().toISOString(),
        // Re-entra num funil novo → reabre (limpa ganho/perda do funil anterior).
        isWon: false,
        isLost: false,
        closedAt: null as unknown as string,
      };

      const { error } = await dealsService.update(deal.id, updates);
      if (error) throw error;

      // Timeline: registra o move E quem fez (pedido da Thalita).
      activitiesService.create({
        dealId: deal.id,
        dealTitle: deal.title,
        type: 'STATUS_CHANGE',
        title: `Movido para ${targetBoard.name}`,
        description: `Movido manualmente por ${moverName}`,
        date: new Date().toISOString(),
        completed: true,
        user: { name: moverName, avatar: '' },
      } as Omit<Activity, 'id' | 'createdAt'>).catch(console.error);

      return { dealId: deal.id, boardId: targetBoard.id, status: entryStageId };
    },

    onMutate: async ({ deal, targetBoard }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.deals.all });
      const previousDeals = queryClient.getQueryData<DealView[]>(DEALS_VIEW_KEY);
      const entryStageId = targetBoard.stages?.[0]?.id;

      queryClient.setQueryData<DealView[]>(DEALS_VIEW_KEY, (old) =>
        old?.map((d) =>
          d.id === deal.id
            ? { ...d, boardId: targetBoard.id, status: entryStageId ?? d.status, isWon: false, isLost: false, updatedAt: new Date().toISOString() }
            : d,
        ),
      );
      queryClient.setQueryData<Deal>(queryKeys.deals.detail(deal.id), (old) =>
        old ? { ...old, boardId: targetBoard.id, status: entryStageId ?? old.status, isWon: false, isLost: false, updatedAt: new Date().toISOString() } : old,
      );

      return { previousDeals };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.previousDeals) queryClient.setQueryData(DEALS_VIEW_KEY, ctx.previousDeals);
    },

    // Realtime sincroniza; não invalidar aqui (mesmo racional do useMoveDeal).
    onSettled: () => {},
  });
};
