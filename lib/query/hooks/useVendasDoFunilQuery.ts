/**
 * @fileoverview Vendas CARIMBADAS de um funil, dentro de um período.
 *
 * Nasceu do estrago medido em 26/08/2026: a automação "ao ganhar, vai pro próximo
 * funil" CRIAVA um card novo no destino em vez de mover o original — a Implantação
 * recebia card em branco (Richard Gois chegou com 0 itens de timeline contra 3 no
 * original; Mavie Ramunno, 1 contra 4) e a conversa de WhatsApp continuava apontando
 * para o card de origem. Com o conserto, o card GANHO **sai** do funil onde a venda
 * foi fechada (regra da dona: "assim que é dado como ganho, o time de implantação é o
 * novo responsável" e "não tem como o mesmo card estar aberto em vários funis") e,
 * ao entrar na etapa de entrada do funil novo, volta a `is_won = false`.
 *
 * Consequência direta: contar venda por `is_won` no Comercial passaria a dar ZERO
 * para sempre. Por isso a fonte de verdade é o CARIMBO DA VENDA
 * (`deals.custom_fields.venda`), que viaja junto com o card para onde ele for e
 * guarda EM QUE funil a venda foi fechada, por quem e por quanto.
 *
 * POR QUE ESTE HOOK NÃO CONSULTA MAIS O SUPABASE DIRETO (mudou em 26/08/2026):
 * depois do move, o card ganho VIVE no funil de destino, e `deals_select` exige
 * `pode_ver_board(board_id)` (migração 20260824210000_acesso_por_funil.sql). O Pedro,
 * que só tem `board_access` do 'Comercial — Consultor', NÃO consegue ler pelo
 * navegador os próprios cards vendidos que foram para a Implantação: a consulta pelo
 * cliente devolveria ZERO vendas justamente para quem vendeu, e a barra de meta do
 * Comercial ficaria zerada na tela dele. Quem varre agora é
 * `GET /api/boards/[boardId]/vendas`, que confere o acesso ao funil com o cliente do
 * usuário e só então lê com service role — e que devolve ao consultor comum apenas as
 * vendas em que ele é o vendedor, preservando o espírito da RLS.
 *
 * @module lib/query/hooks/useVendasDoFunilQuery
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { useAuth } from '@/context/AuthContext';

/**
 * Recorte do carimbo (`deals.custom_fields.venda`) que a rota devolve.
 *
 * Contrato fechado com a dona em 26/08/2026. `vendedor_id`/`vendedor_nome` respondem
 * "quem fez a venda" depois que o card já trocou de dono na Implantação, que é o que
 * a dona pediu para os relatórios. O carimbo GRAVADO no banco tem mais campos
 * (`board_id_da_venda`, `funil_da_venda`, `etapa_da_venda` — ver a automação em
 * useMoveDeal); a rota não os repete porque o funil da venda é o próprio parâmetro da
 * chamada e o resto não é usado na tela.
 */
export interface CarimboDaVenda {
  /** Dono do card no momento do ganho (null quando o card estava sem dono). */
  vendedor_id: string | null;
  /** Nome de quem vendeu, para leitura humana no card e nos relatórios. */
  vendedor_nome: string | null;
  /** ISO de quando a venda foi dada como ganha. */
  vendido_em: string;
  /** `deals.value` no momento do ganho (o card pode mudar de valor depois). */
  valor_na_venda: number;
}

/** Uma venda do funil: o carimbo + o card que o carrega (que pode estar em outro funil). */
export interface VendaCarimbada {
  /** Id do deal que carrega o carimbo — hoje possivelmente já na Implantação. */
  dealId: string;
  carimbo: CarimboDaVenda;
}

/** Retorno do hook: já vem com a contagem e a soma prontas para a UI. */
export interface VendasDoFunil {
  /** Vendas do período, da mais recente para a mais antiga (a rota já ordena). */
  vendas: VendaCarimbada[];
  /** Quantas vendas — é o número da barra de meta "Fechamentos / mês". */
  contagem: number;
  /** Soma de `valor_na_venda` — é o "Já ganho no mês" do header do funil. */
  valorTotal: number;
}

/** Período de leitura (ISO). Normalmente o mês corrente (ver getCurrentMonthRange). */
export interface PeriodoDaVenda {
  inicio: string;
  fim: string;
}

/** Item da lista enxuta devolvida por `GET /api/boards/[boardId]/vendas`. */
interface ItemDaRota {
  deal_id?: unknown;
  vendedor_id?: unknown;
  vendedor_nome?: unknown;
  vendido_em?: unknown;
  valor_na_venda?: unknown;
}

/** Corpo da rota. Vem de `fetch`, então nada aqui é confiável antes de checar. */
interface CorpoDaRota {
  vendas?: ItemDaRota[] | null;
  contagem?: unknown;
  valorTotal?: unknown;
  /** 'todas' (admin/gestor) ou 'minhas' (consultor comum). Hoje a tela não usa. */
  escopo?: unknown;
}

/** Campo de texto do carimbo; devolve null quando veio vazio, nulo ou de outro tipo. */
const texto = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.trim() !== '' ? valor : null;

/**
 * Erro da rota carregando o status HTTP junto.
 *
 * O status é o que decide se vale tentar de novo. O QueryClient da casa
 * (lib/query/index.tsx) tenta 3x com backoff exponencial por padrão, e 401/403/400 aqui
 * são respostas DEFINITIVAS: sessão caiu, funil não liberado para essa pessoa
 * (o Pedro só tem `board_access` do Comercial e da Nutrição) ou período malformado.
 * Sem esta informação, um "Você não tem acesso a este funil" custaria ~7s de espera e
 * quatro checagens de permissão no servidor para dar exatamente o mesmo resultado.
 */
class ErroDaRotaDeVendas extends Error {
  readonly status: number;

  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.name = 'ErroDaRotaDeVendas';
    this.status = status;
  }
}

/**
 * Vendas fechadas NAQUELE funil dentro do período, independentemente de onde o card
 * está hoje.
 *
 * @param boardId - Funil onde a venda foi fechada (`board_id_da_venda` do carimbo).
 * @param periodo - Recorte ISO (normalmente o mês corrente).
 * @param options - `enabled` para desligar a busca em telas que não usam o número.
 */
export const useVendasDoFunil = (
  boardId: string | undefined,
  periodo: PeriodoDaVenda,
  options?: { enabled?: boolean },
) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<VendasDoFunil>({
    queryKey: queryKeys.vendasDoFunil.byBoard(boardId ?? '', periodo.inicio, periodo.fim),
    queryFn: async () => {
      const busca = new URLSearchParams({ inicio: periodo.inicio, fim: periodo.fim });
      const resposta = await fetch(
        `/api/boards/${encodeURIComponent(boardId!)}/vendas?${busca.toString()}`,
      );

      if (!resposta.ok) {
        // A mensagem da rota é em português e é acionável ("peça a liberação ao
        // administrador", "período inválido"): mostrar ela vale mais do que um
        // "Failed to fetch" genérico.
        let mensagem = 'Não foi possível carregar as vendas do funil.';
        try {
          const erro = (await resposta.json()) as { error?: string };
          if (erro?.error) mensagem = erro.error;
        } catch {
          /* corpo não-JSON: fica a mensagem padrão */
        }
        throw new ErroDaRotaDeVendas(mensagem, resposta.status);
      }

      const corpo = (await resposta.json()) as CorpoDaRota;
      const itens = Array.isArray(corpo.vendas) ? corpo.vendas : [];

      const vendas: VendaCarimbada[] = [];
      let valorTotal = 0;

      for (const item of itens) {
        const dealId = texto(item.deal_id);
        const vendidoEm = texto(item.vendido_em);
        // Item sem id ou sem data não tem como ser deduplicado contra os cards da tela
        // (o header casa por `dealId` para não contar a mesma venda duas vezes) — fora.
        if (!dealId || !vendidoEm) continue;

        const valorBruto = Number(item.valor_na_venda ?? NaN);
        const valor = Number.isFinite(valorBruto) ? valorBruto : 0;

        vendas.push({
          dealId,
          carimbo: {
            vendedor_id: texto(item.vendedor_id),
            vendedor_nome: texto(item.vendedor_nome),
            vendido_em: vendidoEm,
            valor_na_venda: valor,
          },
        });
        valorTotal += valor;
      }

      // Contagem e soma saem da lista VALIDADA, não dos agregados que a rota mandou: se
      // um item cair na peneira acima, o número do topo tem que continuar batendo com a
      // lista que a tela usa. Número que não fecha com o que está na tela é o tipo de
      // coisa que faz a dona perder a confiança no CRM inteiro.
      return { vendas, contagem: vendas.length, valorTotal };
    },
    // Mesmo fôlego dos deals: o número muda quando alguém dá um card como ganho.
    staleTime: 2 * 60 * 1000,
    // 4xx da rota é definitivo: repetir só atrasa o erro e refaz a checagem de permissão
    // à toa. Queda de rede e 5xx continuam com o mesmo fôlego de retry da casa (3x).
    retry: (tentativas, erro) =>
      erro instanceof ErroDaRotaDeVendas && erro.status >= 400 && erro.status < 500
        ? false
        : tentativas < 3,
    // OVERRIDE consciente do padrão global. Em lib/query/index.tsx o QueryClient já vem
    // com `refetchOnWindowFocus: false` ("Realtime cobre as entidades principais"), e esta
    // key é justamente a exceção: o Realtime dos deals escreve DIRETO no DEALS_VIEW_KEY
    // (useRealtimeSync) e nunca invalida `vendasDoFunil`. Omitir a linha não deixaria o
    // padrão "ligado" — deixaria DESLIGADO, e o "já ganho no mês" ficaria congelado até
    // alguém remontar o header. Com `true`, voltar para a aba é a chance de o número
    // alcançar uma venda que outra pessoa fechou.
    refetchOnWindowFocus: true,
    enabled:
      !authLoading && !!user && !!boardId && !boardId.startsWith('temp-') && externalEnabled,
  });
};
