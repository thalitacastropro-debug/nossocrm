/**
 * @fileoverview Seção "Reuniões" do dashboard — o elo Agendadas → Realizadas
 * → No-show do funil (antes só existia Agendadas e No-show, sem métrica).
 *
 * Fontes (client-side, volume da Niva é pequeno):
 * - Agendadas: activities type='CALL' no período (a ligação que a Ana marca).
 * - Realizadas: activities type CALL/MEETING completed=true no período
 *   (alimentadas pelo botão "Reunião realizada" e pelo apply do áudio→CRM).
 * - No-show: deals com custom_fields.no_show=true carimbado no período
 *   (botão de no-show grava no_show_at) — contagem exata, não derivada.
 *
 * Espelha o padrão visual do MessagingMetricsSection (MetricCard local).
 *
 * @module features/dashboard/components/ReunioesMetricsSection
 */
'use client';

import React, { useMemo } from 'react';
import { CalendarClock, CalendarCheck, PhoneMissed } from 'lucide-react';
import { useActivities, useDeals } from '@/lib/query/hooks';
import { periodToDateRange } from '@/lib/utils/periodToDateRange';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';

function MetricCard({
  icon: Icon,
  label,
  value,
  subtext,
  color = 'blue',
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subtext?: string;
  color?: 'green' | 'amber' | 'blue';
}) {
  const colorClasses = {
    green: 'text-green-500 bg-green-100 dark:bg-green-500/20',
    amber: 'text-amber-500 bg-amber-100 dark:bg-amber-500/20',
    blue: 'text-blue-500 bg-blue-100 dark:bg-blue-500/20',
  };

  return (
    <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">{label}</p>
          <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
          {subtext && (
            <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{subtext}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReunioesMetricsSection({ period }: { period: PeriodFilter }) {
  const { start, end } = useMemo(() => periodToDateRange(period), [period]);
  const { data: activities = [] } = useActivities({ dateFrom: start, dateTo: end });
  const { data: deals = [] } = useDeals();

  const { agendadas, realizadas, noShows } = useMemo(() => {
    const calls = activities.filter((a) => a.type === 'CALL' || a.type === 'MEETING');
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    return {
      agendadas: calls.filter((a) => a.type === 'CALL').length,
      realizadas: calls.filter((a) => a.completed).length,
      noShows: deals.filter((d) => {
        const cf = d.customFields as Record<string, unknown> | undefined;
        if (cf?.no_show !== true) return false;
        // carimbo do botão de no-show; sem carimbo (legado), conta fora de período
        const at = typeof cf.no_show_at === 'string' ? new Date(cf.no_show_at).getTime() : NaN;
        return Number.isFinite(at) ? at >= startMs && at <= endMs : false;
      }).length,
    };
  }, [activities, deals, start, end]);

  // Sem dado nenhum no período → não polui o dashboard.
  if (agendadas === 0 && realizadas === 0 && noShows === 0) return null;

  const showRate = agendadas > 0 ? Math.round((realizadas / agendadas) * 100) : null;

  return (
    <section aria-label="Métricas de reuniões">
      <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
        <CalendarClock size={16} className="text-primary-500" aria-hidden="true" />
        Reuniões
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard icon={CalendarClock} label="Agendadas" value={agendadas} color="blue" />
        <MetricCard
          icon={CalendarCheck}
          label="Realizadas"
          value={realizadas}
          subtext={showRate !== null ? `${showRate}% das agendadas` : undefined}
          color="green"
        />
        <MetricCard icon={PhoneMissed} label="No-show" value={noShows} color="amber" />
      </div>
    </section>
  );
}
