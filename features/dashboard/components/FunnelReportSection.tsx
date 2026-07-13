/**
 * @fileoverview Relatório do funil (F6 do spec áudio→CRM §4.8).
 *
 * Consome a RPC get_funnel_report (agregada no servidor): volume, conversão
 * (show rate / close rate), receita fechada + vidas, e diagnóstico (motivos
 * de perda + objeções da taxonomia unificada). Filtro de consultor + export CSV.
 *
 * @module features/dashboard/components/FunnelReportSection
 */
'use client';

import React, { useState } from 'react';
import { Download, TrendingUp } from 'lucide-react';
import { useFunnelReportQuery } from '@/lib/query/hooks/useFunnelReportQuery';
import { useOrgMembersQuery } from '@/lib/query/hooks/useOrgMembersQuery';
import { stringifyCsv } from '@/lib/utils/csv';
import { MOTIVO_LABELS, type MotivoTag } from '@/lib/ai/taxonomy/motivos';
import type { PeriodFilter } from '@/features/dashboard/hooks/useDashboardMetrics';

function label(tag: string): string {
  return MOTIVO_LABELS[tag as MotivoTag] ?? tag;
}

function Stat({ label: statLabel, value, subtext }: { label: string; value: string; subtext?: string }) {
  return (
    <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">{statLabel}</p>
      <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
      {subtext && <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{subtext}</p>}
    </div>
  );
}

export function FunnelReportSection({ period }: { period: PeriodFilter }) {
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const userId = selectedUserId === 'all' ? undefined : selectedUserId;
  const { data, isLoading, error } = useFunnelReportQuery(period, userId);
  const { data: members = [] } = useOrgMembersQuery();

  if (error || isLoading || !data) return null;

  const { volume, conversao, receita, diagnostico } = data;
  const isEmpty = volume.agendadas === 0 && volume.realizadas === 0 && volume.vendas === 0 && volume.perdidas === 0;
  if (isEmpty) return null;

  const exportCsv = () => {
    const rows: string[][] = [
      ['metrica', 'valor'],
      ['agendadas', String(volume.agendadas)],
      ['realizadas', String(volume.realizadas)],
      ['vendas', String(volume.vendas)],
      ['perdidas', String(volume.perdidas)],
      ['show_rate', String(conversao.show_rate)],
      ['close_rate', String(conversao.close_rate)],
      ['receita_fechada', String(receita.total)],
      ['vidas_fechadas', String(receita.vidas)],
      ...diagnostico.motivos_perda.map((m) => [`perda_${m.motivo}`, String(m.n)]),
      ...diagnostico.objecoes.map((o) => [`objecao_${o.categoria}`, String(o.n)]),
    ];
    const blob = new Blob([stringifyCsv(rows, ',')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-funil-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-label="Relatório do funil">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <TrendingUp size={16} className="text-primary-500" aria-hidden="true" />
          Relatório do funil
        </h2>
        <div className="flex items-center gap-2">
          {members.length > 1 && (
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="text-xs rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-slate-700 dark:text-slate-300"
              aria-label="Filtrar por consultor"
            >
              <option value="all">Todos</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={exportCsv}
            className="text-xs font-bold text-primary-600 dark:text-primary-400 hover:text-primary-500 flex items-center gap-1.5"
            aria-label="Exportar relatório em CSV"
          >
            <Download size={14} aria-hidden="true" /> CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat
          label="Show rate"
          value={`${Math.round(conversao.show_rate * 100)}%`}
          subtext={`${volume.realizadas} de ${volume.agendadas} agendadas`}
        />
        <Stat
          label="Close rate"
          value={`${Math.round(conversao.close_rate * 100)}%`}
          subtext={`${volume.vendas} vendas / ${volume.perdidas} perdas`}
        />
        <Stat
          label="Receita fechada"
          value={`R$ ${receita.total.toLocaleString('pt-BR')}`}
        />
        <Stat label="Vidas fechadas" value={String(receita.vidas)} />
      </div>

      {(diagnostico.motivos_perda.length > 0 || diagnostico.objecoes.length > 0) && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          {diagnostico.motivos_perda.length > 0 && (
            <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Motivos de perda</p>
              <ul className="space-y-1">
                {diagnostico.motivos_perda.map((m) => (
                  <li key={m.motivo} className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300">{label(m.motivo)}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{m.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diagnostico.objecoes.length > 0 && (
            <div className="glass p-4 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Objeções (Ana + consultor)</p>
              <ul className="space-y-1">
                {diagnostico.objecoes.map((o) => (
                  <li key={o.categoria} className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300">{label(o.categoria)}</span>
                    <span className="font-bold text-slate-900 dark:text-white">{o.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
