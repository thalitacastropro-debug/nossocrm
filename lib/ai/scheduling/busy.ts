/**
 * @fileoverview Carrega os intervalos ocupados do consultor no horizonte,
 * a partir das `activities` (reuniões e bloqueios) ativas.
 * @module lib/ai/scheduling/busy
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityConfig, BusyInterval } from './types';

/**
 * O que de fato OCUPA um horário na agenda.
 *
 * Antes não havia filtro: QUALQUER activity do dono na janela virava horário ocupado. NOTE e
 * STATUS_CHANGE são linhas de diário, carimbadas na hora em que alguém escreveu — nunca foram
 * compromisso. TASK é "reabordar esse lead", com hora arbitrária.
 *
 * Nunca doeu porque a agenda lida era a do consultor fixo da board, que quase não tem activity.
 * Passou a doer quando a agenda virou a do DONO DO CARD (ver `dono-da-agenda.ts`): as TASKs de
 * "Reabordar lead (reativação)" que o kanban cria ao descartar um card
 * (`lib/query/hooks/useMoveDeal.ts`) nascem com `ownerId = dono do card` e caem às 09:00 — hora
 * candidata da config. O Pedro tem 20 delas no futuro. Sem este filtro, as 9h sumiriam da oferta
 * todo dia e ninguém entenderia por quê.
 *
 * ⚠️ É UMA TROCA, não um ganho puro — está aqui declarado. O que se perde: a TASK "retorno em
 * 02/09 às 10h" que o desfecho por voz cria (`call-outcome/apply/route.ts`, com `owner_id` do dono
 * do card) deixa de proteger aquele horário, e a Ana pode oferecê-lo. O que se ganha: a agenda do
 * vendedor para de ser falsamente lotada pelas tarefas automáticas de reabordagem.
 *
 * Escolhemos assim porque o primeiro caso é ocasional e visível (as duas coisas aparecem na agenda
 * de quem atende) e o segundo seria diário, sistemático e invisível. E porque o próprio código já
 * trata TASK como "não é horário": `call-outcome/apply/route.ts` cria TASK e não CALL com o
 * comentário "nunca CALL — evita o índice único de CALL".
 *
 * Também não se perde bloqueio manual nenhum: activity criada pela TELA nasce SEM dono
 * (`lib/supabase/activities.ts` só grava `owner_id` quando o chamador manda, e nenhuma tela
 * manda), e sem dono ela já não casava com o `.eq('owner_id', ...)` daqui — ver o aviso no fim
 * deste arquivo.
 */
const TIPOS_QUE_OCUPAM = ['CALL', 'MEETING'];

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
    .in('type', TIPOS_QUE_OCUPAM)
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

/**
 * ⚠️ BURACO CONHECIDO, ANTERIOR A ESTE ARQUIVO: ligação marcada na MÃO não ocupa nada.
 *
 * A tela de atividades não grava `owner_id`, então a CALL criada por ela nasce órfã — e o
 * `.eq('owner_id', ...)` acima nunca a encontra. O índice único `uniq_consultant_call_slot
 * (owner_id, date) WHERE type='CALL'` também não a protege, porque no Postgres NULL não colide
 * com NULL. Em 21/09/2026 havia 5 CALLs assim em produção.
 *
 * Efeito prático: a Ana pode marcar em cima de uma ligação que o consultor agendou pela tela.
 * O conserto é a tela passar o dono ao criar a activity — não é aqui.
 */
