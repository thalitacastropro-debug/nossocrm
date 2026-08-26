/**
 * @fileoverview Org Members Query Hook
 *
 * Lista membros da organização para uso em dropdowns/filtros.
 * staleTime alto (5min) pois profiles mudam raramente.
 *
 * @module lib/query/hooks/useOrgMembersQuery
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { queryKeys } from '../queryKeys';
import { supabase } from '@/lib/supabase';

export interface OrgMember {
  id: string;
  name: string;
  /** Avatar do perfil, quando houver — usado para mostrar o dono no card do funil. */
  avatar?: string;
  /**
   * Papel da pessoa ('admin' | 'vendedor' | 'trafego'). Quem lista PESSOAS PARA
   * RECEBER LEAD precisa filtrar: 'trafego' (a agência) nem abre /boards, então
   * atribuir um card a essa pessoa some com o lead sem ninguém perceber.
   */
  role?: string;
}

export function useOrgMembersQuery() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useQuery({
    queryKey: queryKeys.orgMembers.list(orgId ?? ''),
    queryFn: async (): Promise<OrgMember[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, first_name, nickname, avatar_url, role')
        .eq('organization_id', orgId!)
        .order('name');

      if (error) throw error;
      return (data ?? []).map((p) => ({
        id: p.id,
        // Ordem de preferência: como a pessoa se chama > nome completo.
        name: p.nickname || p.name || p.first_name || 'Sem nome',
        avatar: p.avatar_url || undefined,
        role: p.role || undefined,
      }));
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // 5 minutos
    gcTime: 30 * 60 * 1000, // 30 minutos
  });
}
