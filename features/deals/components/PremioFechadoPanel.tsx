'use client';

/**
 * @fileoverview Painel "Venda fechada" do modal do card.
 *
 * Aparece só em card com carimbo de venda (`custom_fields.venda`) — na prática, o card
 * que chegou à Implantação pela automação de ganho (ou ganhou em funil de ponta). Mostra
 * quem vendeu e quando (o carimbo é congelado, ninguém edita) e cuida do que FALTA: o
 * prêmio do plano vendido, sem o qual a venda não entra no "Já ganho no mês" nem em
 * relatório de comissão.
 *
 * ⚠️ Comissão não aparece aqui — nem número, nem percentual. Ver
 * [[feedback_niva_dados_confidenciais_crm]].
 *
 * @module features/deals/components/PremioFechadoPanel
 */

import React, { useState } from 'react';
import { AlertTriangle, BadgeDollarSign } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { lerPremioFechado, type PremioFechado } from '@/lib/deals/premioFechado';
import { PremioFechadoForm } from './PremioFechadoForm';

interface PremioFechadoPanelProps {
  dealId: string;
  customFields: Record<string, unknown> | undefined;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** `2026-09-01` → `01/09/2026` (a vigência é gravada no formato do input date). */
const dataCurta = (iso: string): string => iso.split('-').reverse().join('/');

export const PremioFechadoPanel: React.FC<PremioFechadoPanelProps> = ({ dealId, customFields }) => {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  // Eco local do que acabou de ser salvo: o modal recebe customFields por props e o
  // refetch dos deals pode levar um instante — sem isto, salvar parecia não ter funcionado.
  const [salvoAgora, setSalvoAgora] = useState<PremioFechado | null>(null);

  const venda = customFields?.venda;
  if (typeof venda !== 'object' || venda === null) return null;
  const carimbo = venda as Record<string, unknown>;

  const premio = salvoAgora ?? lerPremioFechado(venda);
  const vendedorNome = typeof carimbo.vendedor_nome === 'string' ? carimbo.vendedor_nome : null;
  const vendidoEm = typeof carimbo.vendido_em === 'string' ? carimbo.vendido_em : null;

  const aoSalvar = (salvo: PremioFechado) => {
    setSalvoAgora(salvo);
    setEditando(false);
    // O número do topo do funil e a lista de cards leem caches distintos — os dois
    // precisam saber que o prêmio mudou.
    queryClient.invalidateQueries({ queryKey: queryKeys.vendasDoFunil.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.deals.all });
  };

  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <BadgeDollarSign size={16} className="text-emerald-500" aria-hidden="true" />
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Venda fechada</h3>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        {vendedorNome ? `Vendida por ${vendedorNome}` : 'Vendedor não identificado'}
        {vendidoEm ? ` em ${new Date(vendidoEm).toLocaleDateString('pt-BR')}` : ''}.
      </p>

      {premio && !editando ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Prêmio mensal
            </div>
            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              {BRL.format(premio.premio_mensal)}
            </div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Operadora
            </div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">
              {premio.operadora || '—'}
            </div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Vigência
            </div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">
              {premio.vigencia_em ? dataCurta(premio.vigencia_em) : '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="ml-auto text-[11px] font-bold text-primary-600 dark:text-primary-400 hover:underline"
          >
            Corrigir
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {!premio && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <strong>Falta informar o prêmio do plano vendido.</strong> Sem ele, esta venda não
                entra no &quot;Já ganho no mês&quot; nem em relatório de comissão.
              </span>
            </p>
          )}
          <PremioFechadoForm
            dealId={dealId}
            premioAtual={premio}
            onSaved={aoSalvar}
            onCancel={premio ? () => setEditando(false) : undefined}
          />
        </div>
      )}
    </div>
  );
};
