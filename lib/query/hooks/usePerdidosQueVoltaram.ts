/**
 * Leads PERDIDOS que voltaram a falar — a porta de entrada para resgatá-los.
 *
 * O card perdido some do funil (o filtro abre em "Em Aberto", não é persistido, e o perdido pelo
 * áudio vai para OUTRO funil). Quem detecta o retorno é o trigger `zz_avisa_perdido_voltou_a_falar`
 * (migration 20261009200000), que grava em `lead_perdido_retornos` e avisa o dono no Telegram.
 * Aqui só lemos: retornos não dispensados de cards que CONTINUAM perdidos — reabriu, saiu da lista.
 * A RLS da tabela segue a de `deals`: vendedor vê os dele, admin vê todos.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface PerdidoQueVoltou {
  id: string;
  dealId: string;
  titulo: string;
  ultimaMsgEm: string;
  ultimaPrevia: string | null;
  qtdMsgs: number;
}

export const perdidosQueVoltaramKey = ['lead-perdido-retornos'] as const;

export function usePerdidosQueVoltaram() {
  return useQuery<PerdidoQueVoltou[]>({
    queryKey: perdidosQueVoltaramKey,
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('lead_perdido_retornos')
        .select('id, deal_id, ultima_msg_em, ultima_previa, qtd_msgs, deals!inner(title, is_lost, deleted_at)')
        .is('dispensado_em', null)
        .eq('deals.is_lost', true)
        .is('deals.deleted_at', null)
        .order('ultima_msg_em', { ascending: false })
        .limit(20);
      if (error) throw error;
      type Linha = {
        id: string; deal_id: string; ultima_msg_em: string; ultima_previa: string | null; qtd_msgs: number;
        deals: { title: string } | { title: string }[];
      };
      return ((data ?? []) as unknown as Linha[]).map((r) => {
        const deal = Array.isArray(r.deals) ? r.deals[0] : r.deals;
        return {
          id: r.id,
          dealId: r.deal_id,
          titulo: deal?.title ?? 'Lead',
          ultimaMsgEm: r.ultima_msg_em,
          ultimaPrevia: r.ultima_previa,
          qtdMsgs: r.qtd_msgs,
        };
      });
    },
    // Sem realtime nesta tabela: 1 minuto basta — o aviso NA HORA é o do Telegram.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** "Não vou retomar" — tira da faixa. O card continua perdido; nada mais muda. */
export function useDispensarPerdidoQueVoltou() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string; userId?: string | null }>({
    mutationFn: async ({ id, userId }) => {
      if (!supabase) return;
      const { error } = await supabase
        .from('lead_perdido_retornos')
        .update({ dispensado_em: new Date().toISOString(), dispensado_por: userId ?? null })
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: perdidosQueVoltaramKey });
    },
  });
}
