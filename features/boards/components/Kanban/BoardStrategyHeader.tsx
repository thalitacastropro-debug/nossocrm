import React, { useState } from 'react';
import {
  Target,
  Bot,
  DoorOpen,
  Info,
  Edit2,
  Check,
  X,
  ChevronRight,
  MessageSquare,
} from 'lucide-react';
import { Board, Activity, DealView } from '@/types';
import { useUpdateBoard } from '@/lib/query/hooks/useBoardsQuery';
import { useDealsByBoard } from '@/lib/query/hooks/useDealsQuery';
import { useActivities } from '@/lib/query/hooks';
import { useVendasDoFunil, type VendasDoFunil } from '@/lib/query/hooks/useVendasDoFunilQuery';
import { getCurrentMonthRange, countScheduledMeetings } from '@/lib/boards/goalMetrics';
import { matchesOwnerFilter } from '@/features/boards/hooks/useBoardsController';
import { useAuth } from '@/context/AuthContext';
import { useUIState } from '@/store/uiState';

// Performance: reuse formatter instances.
const BRL_CURRENCY_FORMATTER = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
// Ref estável p/ fallback vazio: evita um novo [] por render (que derrotaria o memo do progresso).
const EMPTY_ACTIVITIES: Activity[] = [];
// Mesmo motivo do EMPTY_ACTIVITIES: enquanto as vendas carimbadas não chegam, o memo
// precisa de um objeto com identidade estável.
const SEM_VENDAS: VendasDoFunil = { vendas: [], contagem: 0, valorTotal: 0 };

interface BoardStrategyHeaderProps {
  board: Board;
  /**
   * Os MESMOS cards que estão desenhados nas colunas (já passaram por busca, dono e
   * status em useBoardsController). O header tem a query própria `useDealsByBoard`, que
   * ignora os filtros da tela — se o resumo de dinheiro saísse dela, o total do topo não
   * bateria com a soma das colunas assim que alguém filtrasse por consultor.
   */
  filteredDeals: DealView[];
  /** Filtro de dono ativo na tela ('all' | 'mine' | 'sem-dono' | id do membro). */
  ownerFilter: string;
}

/**
 * Componente React `BoardStrategyHeader`.
 *
 * @param {BoardStrategyHeaderProps} { board, filteredDeals, ownerFilter } - Parâmetro `{ board, filteredDeals, ownerFilter }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const BoardStrategyHeader: React.FC<BoardStrategyHeaderProps> = ({
  board,
  filteredDeals,
  ownerFilter,
}) => {
  const updateBoardMutation = useUpdateBoard();
  const { data: deals = [] } = useDealsByBoard(board.id);
  const { profile } = useAuth();
  // Meta 'meetings_scheduled' (agendamentos/mês): conta atividades CALL do mês, igual ao
  // dashboard. Só busca quando o board usa essa meta (gate `enabled`) — não onera os demais.
  const isMeetingsGoal = board.goal?.type === 'meetings_scheduled';
  // nowTick avança de minuto em minuto (só no board de meta de agendamentos): sem isto o range do
  // mês congela no mount e a barra não rola pro mês novo enquanto o board fica aberto.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  React.useEffect(() => {
    if (!isMeetingsGoal) return;
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [isMeetingsGoal]);
  const monthRange = React.useMemo(() => getCurrentMonthRange(new Date(nowTick)), [nowTick]);
  const { data: monthActivitiesData } = useActivities(
    { dateFrom: monthRange.start, dateTo: monthRange.end },
    { enabled: isMeetingsGoal },
  );
  // Fallback com ref ESTÁVEL (não `= []` na destruturação) p/ preservar o memo nos outros boards.
  const monthActivities = monthActivitiesData ?? EMPTY_ACTIVITIES;
  /**
   * Vendas CARIMBADAS deste funil no mês — a nova fonte dos números de fechamento do topo.
   *
   * Desde o conserto de 26/08/2026, ganhar um card o MOVE para o próximo funil (a
   * Implantação) e o reabre lá (`is_won = false`): quem contasse `is_won` no Comercial
   * marcaria zero para sempre. O carimbo (`custom_fields.venda`) viaja com o card e diz
   * em que funil a venda foi fechada, por quem e por quanto. Ver useVendasDoFunilQuery.
   */
  const { data: vendasDoMesData } = useVendasDoFunil(board.id, {
    inicio: monthRange.start,
    fim: monthRange.end,
  });
  const vendasDoMes = vendasDoMesData ?? SEM_VENDAS;
  const { setIsGlobalAIOpen } = useUIState();
  const [isEditing, setIsEditing] = useState(false);
  const [editedBoard, setEditedBoard] = useState(board);

  // Calculate Progress Automatically
  const calculatedProgress = React.useMemo<{ value: number; display: string; label?: string }>(() => {
    const type = board.goal?.type || 'number';

    /**
     * Performance: avoid `deals.filter(...)` + extra passes over the boardDeals.
     * We scan once and compute the aggregates we need.
     */
    let dealCount = 0;
    let wonCount = 0;
    let totalValue = 0;
    for (const d of deals) {
      if (d.boardId !== board.id) continue;
      dealCount += 1;
      totalValue += d.value || 0;
      if (d.isWon) wonCount += 1;
    }

    // 'meetings_scheduled': agendamentos do mês (atividades CALL) — meta da SDR "39/mês".
    // Não deriva dos cards (que saem do board / podem estar em 'agendado' sem reunião real):
    // conta o evento de agendamento no mês, board-agnóstico. Ver lib/boards/goalMetrics.
    if (type === 'meetings_scheduled') {
      const count = countScheduledMeetings(monthActivities);
      return { value: count, display: count.toString(), label: 'este mês' };
    }

    if (type === 'currency') {
      return {
        value: totalValue,
        display: BRL_CURRENCY_FORMATTER.format(totalValue),
      };
    }

    if (type === 'percentage') {
      if (dealCount === 0) return { value: 0, display: '0%' };
      const percent = Math.round((wonCount / dealCount) * 100);
      return {
        value: percent,
        display: `${percent}%`,
      };
    }

    // 'count': metas de fechamento (ex. "Fechamentos / mês", alvo 7).
    //
    // FONTE NOVA = carimbo da venda (`custom_fields.venda`), NÃO `is_won`. Desde
    // 26/08/2026 o card ganho sai deste funil para a Implantação e volta a
    // `is_won = false` lá — contar `is_won` aqui zeraria a barra para sempre. O
    // número é do funil inteiro (não segue o filtro de consultor da tela), igual ao
    // que a barra sempre fez.
    //
    // PONTE (morre sozinha quando não sobrar ganho sem carimbo): ganho ANTERIOR ao
    // carimbo ainda vive como `is_won` parado neste funil. Ele SOMA ao carimbo, e só se
    // fechou DENTRO DO MÊS — o mesmo recorte do "Já ganho no mês" logo abaixo, para os
    // dois números do topo não estarem contando coisas diferentes.
    //
    // NÃO usar o `wonCount` acumulado como fallback de "mês sem carimbo": no dia 1º a
    // contagem carimbada é 0 e a barra passaria a mostrar o histórico inteiro do funil
    // (os ganhos velhos parados aqui viram, por exemplo, 12/7 = barra cheia num mês em
    // que ninguém vendeu nada) e depois CAIRIA para 1 na primeira venda carimbada do mês.
    // O KPI é "Fechamentos / MÊS": o número é sempre do mês, inclusive quando é zero.
    if (type === 'count') {
      const inicioMes = Date.parse(monthRange.start);
      const fimMes = Date.parse(monthRange.end);
      const jaContadosPeloCarimbo = new Set(vendasDoMes.vendas.map(v => v.dealId));

      let ganhosSemCarimbo = 0;
      for (const d of deals) {
        if (d.boardId !== board.id) continue;
        if (jaContadosPeloCarimbo.has(d.id)) continue;
        // Sem data de fechamento não dá para dizer que caiu neste mês — não conta (mesma
        // regra do resumo de dinheiro: melhor faltar do que inflar a meta).
        if (!d.isWon || !d.closedAt) continue;
        const fechadoEm = Date.parse(d.closedAt);
        if (Number.isNaN(fechadoEm) || fechadoEm < inicioMes || fechadoEm > fimMes) continue;
        ganhosSemCarimbo += 1;
      }

      const fechamentosNoMes = vendasDoMes.contagem + ganhosSemCarimbo;
      return {
        value: fechamentosNoMes,
        display: fechamentosNoMes.toString(),
        label: 'este mês',
      };
    }

    // 'conversion_rate': ex. "Taxa de agendamento sobre leads recebidos" (alvo 30).
    // Não dá para calcular de forma confiável hoje: os leads agendados saem deste
    // board para o board do consultor e não existe histórico de eventos
    // (agendados ÷ recebidos) para reconstruir a taxa. Em vez de exibir um número
    // falso — o default contava todos os cards e deixava a barra sempre cheia —
    // mostramos um placeholder e deixamos a barra VAZIA (value 0 → progress 0).
    // TODO: implementar a métrica real quando houver tracking histórico de leads
    // recebidos vs. agendados.
    if (type === 'conversion_rate') {
      return {
        value: 0,
        display: '—',
        label: 'a definir',
      };
    }

    // Default: Number (conta todos os cards do board)
    return {
      value: dealCount,
      display: dealCount.toString(),
    };
  }, [deals, board.id, board.goal?.type, monthActivities, vendasDoMes, monthRange]);

  // Performance: parse target once per goal change (instead of per render).
  // Hook must live before any early returns (rules-of-hooks).
  const targetValueNumber = React.useMemo(() => {
    if (!board.goal?.targetValue) return 0;

    // Parse Target
    const targetStr = board.goal.targetValue.replace(/[^0-9.]/g, '');
    const target = parseFloat(targetStr);
    return Number.isFinite(target) ? target : 0;
  }, [board.goal?.targetValue]);

  // Performance: compute progress as a derived value (and keep hooks order stable).
  const progress = React.useMemo(() => {
    if (targetValueNumber === 0) return 0;
    const current = calculatedProgress.value;
    return Math.min(100, Math.max(0, (current / targetValueNumber) * 100));
  }, [calculatedProgress.value, targetValueNumber]);

  /**
   * Resumo de dinheiro do funil (pedido da Thalita em 26/08/2026: "quero ver o total de
   * mensalidade que está em jogo e quanto já foi ganho, filtrando por vendedor").
   *
   * SEMÂNTICA (não mexer sem falar com a dona): na Niva, `deal.value` é A MENSALIDADE QUE O
   * LEAD PAGA HOJE no plano atual — vem de `custom_fields.qualificacao.valor_pago_exato`, é o
   * que a Ana apura na qualificação. NÃO é valor de proposta nem receita fechada. Por isso o
   * rótulo é "Mensalidades em jogo": chamar de "valor do pipeline" ou "receita prevista"
   * seria mentira em cima do mesmo número.
   *
   * COMISSÃO: NÃO existe número de comissão aqui, e o tooltip não pode prometer que este
   * valor "é" a comissão. Dois motivos, os dois checados no modelo financeiro da Niva
   * (HANDOFF): (1) a comissão é um percentual do prêmio do plano VENDIDO e varia por
   * operadora — Porto 250%, AMIL 260%, Sulamérica 250%, Alice 220%, Bradesco 330% (média
   * 262%) —, nunca 100%; (2) o prêmio do plano vendido não existe em campo nenhum do CRM
   * hoje, e `deal.value` é o que o lead paga na apólice ANTIGA. Derivar comissão daqui
   * seria inventar dinheiro na tela. Quando nascer o campo de prêmio FECHADO, a comissão
   * vira uma linha própria, calculada pelo percentual da operadora.
   *
   * DE ONDE VEM CADA NÚMERO:
   * - "em jogo" sai de `filteredDeals` (a mesma lista das colunas) para bater com o board na
   *   tela e respeitar o filtro por consultor de graça.
   * - "já ganho" NÃO pode sair de `filteredDeals` nem de `is_won`: o filtro de status da tela
   *   nasce em 'open' (esconde os ganhos) e, desde 26/08/2026, o card ganho SAI deste funil
   *   para a Implantação e é reaberto lá. Sai do CARIMBO DA VENDA (`vendasDoMes`), que fica
   *   com o card e guarda quanto e quem vendeu; o filtro por consultor da tela é aplicado à
   *   mão sobre `vendedor_id` do carimbo — não sobre o dono ATUAL do card, que na Implantação
   *   já é outra pessoa ("quando o card for pra implantação já tem que identificar quem fez a
   *   venda", pedido da dona em 26/08).
   */
  const resumoFinanceiro = React.useMemo<{ mensalidadesEmJogo: number; ganhoNoMes: number } | null>(() => {
    const inicioMes = Date.parse(monthRange.start);
    const fimMes = Date.parse(monthRange.end);

    // 1) Vendas carimbadas do mês: a fonte de verdade. Já vêm recortadas por funil da
    // venda e por período pelo hook; aqui só falta o filtro por consultor da tela.
    let ganhoNoMes = 0;
    const jaContadosPeloCarimbo = new Set<string>();
    for (const venda of vendasDoMes.vendas) {
      jaContadosPeloCarimbo.add(venda.dealId);
      if (!matchesOwnerFilter(venda.carimbo.vendedor_id ?? undefined, ownerFilter, profile?.id)) continue;
      ganhoNoMes += venda.carimbo.valor_na_venda;
    }

    // 2) MESMA PONTE TEMPORÁRIA da barra de meta: ganho ANTERIOR ao carimbo ainda vive
    // como `is_won` parado neste funil e não tem de onde ser reconstruído. Some também,
    // pulando quem já entrou pelo carimbo — senão a mesma venda contaria duas vezes no
    // mês da virada. Quando não sobrar ganho sem carimbo, este trecho morre.
    let funilTemValor = false;
    for (const d of deals) {
      if (d.boardId !== board.id) continue;
      if ((d.value || 0) > 0) funilTemValor = true;
      if (jaContadosPeloCarimbo.has(d.id)) continue;
      // Sem data de fechamento não dá para dizer que caiu neste mês — não conta (melhor
      // faltar do que inflar o "já ganho" com fechamento antigo sem carimbo).
      if (!d.isWon || !d.closedAt) continue;
      if (!matchesOwnerFilter(d.ownerId, ownerFilter, profile?.id)) continue;
      const fechadoEm = Date.parse(d.closedAt);
      if (Number.isNaN(fechadoEm) || fechadoEm < inicioMes || fechadoEm > fimMes) continue;
      ganhoNoMes += d.value || 0;
    }

    // Funil sem nenhum card com valor (SDR, nutrição...) não ganha o bloco: "R$ 0,00" só
    // ocuparia espaço no topo sem dizer nada. Com venda carimbada no mês o bloco aparece
    // mesmo que os cards ganhos já tenham saído daqui — é justamente o que se quer ver.
    if (!funilTemValor && vendasDoMes.contagem === 0) return null;

    let mensalidadesEmJogo = 0;
    for (const d of filteredDeals) {
      if (d.boardId !== board.id) continue;
      // "Em jogo" = aberto. Ganho já virou receita e perdido não volta; contar os dois aqui
      // dobraria o número quando a pessoa trocasse o filtro de status para "todos".
      if (d.isWon || d.isLost) continue;
      mensalidadesEmJogo += d.value || 0;
    }

    return { mensalidadesEmJogo, ganhoNoMes };
  }, [deals, filteredDeals, board.id, monthRange, ownerFilter, profile?.id, vendasDoMes]);

  const hasStrategy = board.goal || board.agentPersona || board.entryTrigger;

  if (!hasStrategy && !isEditing) {
    return (
      <div className="mb-4">
        <button
          onClick={() => setIsEditing(true)}
          className="w-full py-3 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl flex items-center justify-center gap-2 text-slate-500 dark:text-slate-400 hover:border-primary-500 dark:hover:border-primary-500 hover:text-primary-600 dark:hover:text-primary-400 transition-all group bg-slate-50/50 dark:bg-white/5"
        >
          <div className="p-1.5 bg-white dark:bg-slate-800 rounded-lg shadow-sm group-hover:scale-110 transition-transform">
            <Target size={16} className="text-primary-500" />
          </div>
          <span className="font-medium text-sm">
            Definir Estratégia do Funil (Meta, Agente e Gatilhos)
          </span>
        </button>
      </div>
    );
  }

  const handleSave = () => {
    updateBoardMutation.mutate({
      id: board.id,
      updates: {
        goal: editedBoard.goal,
        agentPersona: editedBoard.agentPersona,
        entryTrigger: editedBoard.entryTrigger,
        nextBoardId: editedBoard.nextBoardId,
      },
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedBoard(board);
    setIsEditing(false);
  };

  return (
    <div className="relative mb-4 group/header z-20">
      {/* Background Glow Effect (Subtle) */}
      <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/5 via-purple-500/5 to-orange-500/5 rounded-xl blur-xl opacity-50 group-hover/header:opacity-100 transition-opacity duration-700"></div>

      <div className="relative px-5 py-3 bg-white dark:bg-[#0B1120] rounded-lg border border-slate-100 dark:border-white/5 shadow-sm transition-all duration-300 hover:shadow-md">
        {/* Edit Button - Only visible on hover */}
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="absolute top-2 right-2 p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-full transition-all opacity-0 group-hover/header:opacity-100"
            title="Editar Estratégia"
          >
            <Edit2 size={12} />
          </button>
        )}

        {isEditing ? (
          // --- EDIT MODE (Functional & Clean) ---
          // --- EDIT MODE (Jobs Style: Clean, Focused, Minimal) ---
          // --- EDIT MODE (Polished & Unified) ---
          <div className="animate-in fade-in zoom-in-95 duration-300">
            {/* Header Actions */}
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 dark:border-white/5 pb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-slate-100 dark:bg-white/10 rounded-lg">
                  <Target size={16} className="text-slate-600 dark:text-slate-300" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white">
                    Estratégia do Funil
                  </h3>
                  <p className="text-[10px] text-slate-500 font-medium">
                    Defina como a IA deve trabalhar aqui
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 bg-slate-900 dark:bg-white text-white dark:text-black text-xs font-bold rounded-lg hover:shadow-lg hover:-translate-y-0.5 transition-all"
                >
                  Salvar Alterações
                </button>
              </div>
            </div>

            <div className="space-y-8">
              {/* TOP SECTION: RULES (The Brain) */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <DoorOpen size={12} /> Regras de Entrada (O Filtro)
                </label>
                <div className="relative">
                  <textarea
                    className="w-full h-24 bg-slate-50 dark:bg-white/5 rounded-xl p-4 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-500/20 resize-none leading-relaxed border border-slate-200 dark:border-white/5 transition-all"
                    placeholder="Descreva as regras para a IA: Quem deve entrar aqui? Quais critérios de qualidade? (ex: Apenas leads B2B com budget > 50k)"
                    value={editedBoard.entryTrigger || ''}
                    onChange={e => setEditedBoard({ ...editedBoard, entryTrigger: e.target.value })}
                  />
                  <div className="absolute bottom-3 right-3 text-[10px] text-slate-400 bg-white/50 dark:bg-black/20 px-2 py-1 rounded-full backdrop-blur-sm">
                    A IA usará isso para filtrar leads
                  </div>
                </div>
              </div>

              {/* BOTTOM SECTION: GOAL & AGENT (Side by Side) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* LEFT: GOAL (All Goal fields) */}
                <div className="space-y-4 border-r border-slate-100 dark:border-white/5 pr-8">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-100 dark:border-white/5 pb-2">
                    <Target size={12} /> Objetivo (O Alvo)
                  </label>

                  {/* KPI Inputs */}
                  <div className="flex gap-4">
                    <div className="flex-1 bg-slate-50 dark:bg-white/5 rounded-xl p-3 border border-slate-200 dark:border-white/5 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
                      <div className="flex items-center gap-2 mb-1">
                        <input
                          className="flex-1 bg-transparent text-xl font-bold text-slate-900 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 focus:outline-none"
                          placeholder="0"
                          value={editedBoard.goal?.targetValue || ''}
                          onChange={e =>
                            setEditedBoard({
                              ...editedBoard,
                              goal: { ...editedBoard.goal!, targetValue: e.target.value },
                            })
                          }
                        />
                        <select
                          className="bg-transparent text-[10px] font-bold uppercase text-slate-400 focus:text-blue-500 focus:outline-none cursor-pointer"
                          value={editedBoard.goal?.type || 'number'}
                          onChange={e =>
                            setEditedBoard({
                              ...editedBoard,
                              goal: {
                                ...editedBoard.goal!,
                                type: e.target.value as 'currency' | 'number' | 'percentage',
                              },
                            })
                          }
                        >
                          <option value="currency">R$ (Valor)</option>
                          <option value="number"># (Qtd)</option>
                          <option value="percentage">% (Taxa)</option>
                        </select>
                      </div>
                      <input
                        className="w-full bg-transparent text-xs font-medium text-slate-500 focus:text-blue-600 focus:outline-none transition-colors border-b border-transparent focus:border-blue-200 pb-0.5"
                        placeholder="Nome do KPI"
                        value={editedBoard.goal?.kpi || ''}
                        onChange={e =>
                          setEditedBoard({
                            ...editedBoard,
                            goal: { ...editedBoard.goal!, kpi: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div className="w-24 opacity-50 pointer-events-none grayscale">
                      <label className="text-[10px] text-slate-400 font-medium block mb-1">
                        Progresso (Auto)
                      </label>
                      <input
                        className="w-full bg-transparent border-b border-slate-200 dark:border-white/10 text-lg font-bold text-slate-700 dark:text-slate-300 focus:outline-none"
                        placeholder="-"
                        readOnly
                        value={calculatedProgress.display}
                      />
                    </div>
                  </div>

                  {/* Goal Context */}
                  <textarea
                    className="w-full h-24 bg-transparent border border-slate-200 dark:border-white/10 rounded-lg p-3 text-xs text-slate-600 dark:text-slate-300 focus:outline-none focus:border-blue-500/50 resize-none transition-all"
                    placeholder="Por que essa meta existe? Qual o contexto estratégico?"
                    value={editedBoard.goal?.description || ''}
                    onChange={e =>
                      setEditedBoard({
                        ...editedBoard,
                        goal: { ...editedBoard.goal!, description: e.target.value },
                      })
                    }
                  />
                </div>

                {/* RIGHT: AGENT (All Agent fields) */}
                <div className="space-y-4 pl-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-100 dark:border-white/5 pb-2">
                    <Bot size={12} /> Agente (O Executor)
                  </label>

                  {/* Agent Identity */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">Nome</label>
                      <input
                        className="w-full bg-transparent border-b border-slate-200 dark:border-white/10 py-1 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-300"
                        placeholder="Ex: Ana"
                        value={editedBoard.agentPersona?.name || ''}
                        onChange={e =>
                          setEditedBoard({
                            ...editedBoard,
                            agentPersona: { ...editedBoard.agentPersona!, name: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-medium">Cargo</label>
                      <input
                        className="w-full bg-transparent border-b border-slate-200 dark:border-white/10 py-1 text-xs text-slate-500 focus:outline-none focus:border-purple-500 transition-colors placeholder:text-slate-300"
                        placeholder="Ex: Vendedora"
                        value={editedBoard.agentPersona?.role || ''}
                        onChange={e =>
                          setEditedBoard({
                            ...editedBoard,
                            agentPersona: { ...editedBoard.agentPersona!, role: e.target.value },
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Agent Behavior */}
                  <textarea
                    className="w-full h-24 bg-transparent border border-slate-200 dark:border-white/10 rounded-lg p-3 text-xs text-slate-600 dark:text-slate-300 focus:outline-none focus:border-purple-500/50 resize-none transition-all"
                    placeholder="Como o agente deve agir? (Tom de voz, postura...)"
                    value={editedBoard.agentPersona?.behavior || ''}
                    onChange={e =>
                      setEditedBoard({
                        ...editedBoard,
                        agentPersona: { ...editedBoard.agentPersona!, behavior: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          // --- VIEW MODE (Compact & Premium) ---
          <>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              {/* GOAL (Hero Section) - Spans 4 cols */}
              <div className="md:col-span-4 flex flex-col justify-center border-r border-slate-100 dark:border-white/5 pr-6 relative">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Objetivo
                  </span>
                </div>

                <div className="flex flex-col mb-2">
                  <h2 className="text-lg md:text-xl font-display font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
                    {board.goal?.targetValue}
                  </h2>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">
                    {board.goal?.kpi}
                  </span>
                </div>

                {/* Sleek Progress Bar */}
                <div className="relative h-1 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-1">
                  <div
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.5)] transition-all duration-1000 ease-out"
                    style={{ width: `${progress}% ` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[9px] font-medium text-slate-400 uppercase tracking-wider">
                  <span>{calculatedProgress.display} {calculatedProgress.label ?? 'Concluído'}</span>
                  <div className="group/goal relative cursor-help">
                    <span className="border-b border-dotted border-slate-600 hover:text-blue-400 transition-colors">
                      Detalhes
                    </span>
                    {/* Tooltip for Goal Description */}
                    <div className="absolute left-0 top-full mt-2 hidden group-hover/goal:block w-80 p-4 bg-slate-900 text-slate-300 text-xs rounded-lg shadow-2xl z-[100] border border-slate-700 max-h-64 overflow-y-auto">
                      {board.goal?.description}
                    </div>
                  </div>
                </div>

                {/* Dinheiro do funil, logo abaixo da meta. Fica DENTRO da coluna do objetivo
                    de propósito: acrescenta uma linha sem mexer no grid 4/3/5 do header. Só
                    renderiza nos funis que têm valor nos cards (ver resumoFinanceiro). */}
                {resumoFinanceiro && (
                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-white/5 flex items-center gap-5">
                    <div
                      className="min-w-0 cursor-help"
                      title="Soma da mensalidade que os leads pagam hoje no plano atual, somando só os cards ABERTOS deste funil. Segue os filtros da tela (busca, consultor e situação) — por isso zera se você filtrar por Ganhos ou Perdidos. Não é receita prevista nem comissão: a comissão é um percentual do prêmio do plano vendido, que o CRM ainda não guarda."
                    >
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap">
                        Mensalidades em jogo
                      </div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {BRL_CURRENCY_FORMATTER.format(resumoFinanceiro.mensalidadesEmJogo)}
                      </div>
                    </div>
                    <div
                      className="min-w-0 cursor-help"
                      title="Soma das vendas fechadas NESTE funil dentro do mês corrente, pelo carimbo da venda: a venda continua contando aqui mesmo depois de o card ir para a Implantação. Segue o filtro por consultor comparando QUEM VENDEU (não o dono atual do card), mas ignora a busca e o filtro de situação: é o total do mês, não o que está desenhado nas colunas. Ganhos antigos, anteriores ao carimbo, ainda entram pela data de fechamento do card."
                    >
                      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap">
                        Já ganho no mês
                      </div>
                      <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 truncate">
                        {BRL_CURRENCY_FORMATTER.format(resumoFinanceiro.ganhoNoMes)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* AGENT - Spans 3 cols */}
              <div className="md:col-span-3 flex flex-col justify-center px-4 border-r border-slate-100 dark:border-white/5 relative">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Bot size={12} className="text-purple-500" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      Agente
                    </span>
                  </div>
                  {board.agentPersona && (
                    <button
                      onClick={() => setIsGlobalAIOpen(true)}
                      className="text-[10px] font-bold text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 px-2 py-0.5 rounded flex items-center gap-1 transition-colors"
                    >
                      <MessageSquare size={12} /> Falar
                    </button>
                  )}
                </div>

                <div className="group/agent relative">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-0.5 group-hover/agent:text-purple-400 transition-colors cursor-default truncate">
                    {board.agentPersona?.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">
                    {board.agentPersona?.role}
                  </p>

                  {/* Tooltip for Agent Behavior */}
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 hidden group-hover/agent:block w-80 p-4 bg-slate-900 text-slate-300 text-xs rounded-lg shadow-2xl z-[100] border border-slate-700 max-h-64 overflow-y-auto">
                    <p className="font-semibold text-purple-300 mb-1">Comportamento</p>"
                    {board.agentPersona?.behavior}"
                  </div>
                </div>
              </div>

              {/* TRIGGER - Spans 5 cols */}
              <div className="md:col-span-5 flex flex-col justify-center pl-4 relative">
                <div className="flex items-center gap-2 mb-1">
                  <DoorOpen size={12} className="text-orange-500" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    Entrada
                  </span>
                </div>

                <div className="group/trigger relative cursor-help">
                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                    {board.entryTrigger}
                  </p>
                  {/* Tooltip for Full Trigger */}
                  <div className="absolute right-0 top-full mt-2 hidden group-hover/trigger:block w-80 p-4 bg-slate-900 text-slate-300 text-xs rounded-lg shadow-2xl z-[100] border border-slate-700 max-h-64 overflow-y-auto">
                    {board.entryTrigger}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
