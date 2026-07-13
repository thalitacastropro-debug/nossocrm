/**
 * @fileoverview Funnel Report Query Hook
 *
 * Chama a RPC `get_funnel_report()` (grupos A-F do funil: volume, conversão,
 * receita, diagnóstico) agregada no servidor. Molde: useMessagingMetricsQuery.
 *
 * @module lib/query/hooks/useFunnelReportQuery
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { queryKeys } from '../queryKeys';
import { supabase } from '@/lib/supabase';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';
import { periodToDateRange } from '@/lib/utils/periodToDateRange';

// =============================================================================
// Types
// =============================================================================

export interface FunnelReport {
  volume: {
    agendadas: number;
    realizadas: number;
    vendas: number;
    perdidas: number;
  };
  conversao: {
    show_rate: number;
    close_rate: number;
  };
  receita: {
    total: number;
    vidas: number;
  };
  diagnostico: {
    motivos_perda: Array<{ motivo: string; n: number }>;
    objecoes: Array<{ categoria: string; n: number }>;
  };
}

// =============================================================================
// Hook
// =============================================================================

export function useFunnelReportQuery(period: PeriodFilter, userId?: string) {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useQuery({
    queryKey: queryKeys.funnelReport.byPeriod(orgId ?? '', period, userId),
    queryFn: async (): Promise<FunnelReport> => {
      const { start, end } = periodToDateRange(period);

      const { data, error } = await supabase.rpc('get_funnel_report', {
        p_org_id: orgId!,
        p_start: start,
        p_end: end,
        p_user_id: userId ?? null,
      });

      if (error) throw error;
      return data as FunnelReport;
    },
    enabled: !!orgId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
}
