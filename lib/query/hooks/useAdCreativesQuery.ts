/**
 * @fileoverview TanStack Query hooks do cadastro de criativos de anúncio.
 *
 * Alimenta a tela Configurações → Anúncios, onde a Thalita liga o id que chega
 * do Meta ao nome do vídeo, ao link do criativo e à promessa que ele faz.
 * Nasceu do caso do Pedro (26/08/2026): o lead falou do "vídeo do anúncio" e o
 * consultor não sabia qual era.
 *
 * A lista é curta e muda pouco (só a dona cadastra), por isso o mesmo
 * `staleTime` folgado dos produtos e invalidação da árvore inteira da chave
 * depois de escrever.
 *
 * @module lib/query/hooks/useAdCreativesQuery
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { adCreativesService, type AdCreative, type AdCreativeInput } from '@/lib/supabase/adCreatives';
import { useAuth } from '@/context/AuthContext';

// ============ QUERY HOOKS ============

/** Criativos cadastrados da organização (tela de Configurações). */
export const useAdCreatives = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<AdCreative[]>({
    queryKey: queryKeys.adCreatives.lists(),
    queryFn: async () => {
      const { data, error } = await adCreativesService.getAll();
      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: (query) => query.state.dataUpdatedAt === 0 || query.state.isInvalidated,
    refetchOnReconnect: false,
    enabled: !authLoading && !!user && externalEnabled,
  });
};

// ============ MUTATION HOOKS ============

/**
 * Cadastra ou corrige um criativo.
 *
 * É upsert por (organization_id, ad_id): salvar o mesmo id de novo corrige o
 * cadastro em vez de criar uma segunda linha para o mesmo anúncio.
 */
export const useSaveAdCreative = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AdCreativeInput) => {
      const { data, error } = await adCreativesService.upsert(input);
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adCreatives.all });
    },
  });
};

/** Remove um cadastro. O `ad_id` continua gravado no lead_form do deal. */
export const useDeleteAdCreative = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await adCreativesService.remove(id);
      if (error) throw error;
      return id;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.adCreatives.all });
    },
  });
};
