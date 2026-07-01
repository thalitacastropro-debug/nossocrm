/**
 * @fileoverview Carrega os intervalos ocupados do consultor no horizonte,
 * a partir das `activities` (reuniões e bloqueios) ativas.
 * @module lib/ai/scheduling/busy
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityConfig, BusyInterval } from './types';

export interface LoadBusyParams {
  supabase: SupabaseClient;
  organizationId: string;
  consultantUserId: string;
  now: Date;
  config: AvailabilityConfig;
}

export async function loadBusyIntervals(params: LoadBusyParams): Promise<BusyInterval[]> {
  const { supabase, organizationId, consultantUserId, now, config } = params;

  // Janela de busca: de agora até ~ (horizonte + 3) dias (folga p/ fim de semana).
  const fromIso = now.toISOString();
  const toMs = now.getTime() + (config.horizonBusinessDays + 3) * 24 * 60 * 60 * 1000;
  const toIso = new Date(toMs).toISOString();

  const { data, error } = await supabase
    .from('activities')
    .select('date')
    .eq('organization_id', organizationId)
    .eq('owner_id', consultantUserId)
    .is('deleted_at', null)
    .gte('date', fromIso)
    .lt('date', toIso);

  if (error) {
    console.error('[Busy] erro ao carregar activities (tratando como livre):', error);
    return [];
  }

  const slotMs = config.slotMinutes * 60 * 1000;
  return (data || []).map((a) => {
    const startMs = new Date(a.date as string).getTime();
    return { startMs, endMs: startMs + slotMs };
  });
}
