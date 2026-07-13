/**
 * @fileoverview Painel de Qualificação da SDR (Ana) no card do deal.
 *
 * Mostra pro consultor, de relance, o que a Ana coletou na conversa
 * (custom_fields.qualificacao + tier + objeções), as PENDÊNCIAS (o que ainda
 * falta pegar na ligação) e, se o lead veio de anúncio, o formulário do Meta
 * (custom_fields.lead_form.fields). Só aparece quando há dados — não polui
 * cards de outros boards/orgs.
 *
 * @module features/deals/components/QualificacaoSDRPanel
 */

import React from 'react';
import {
  ClipboardList,
  Users,
  HeartPulse,
  Building2,
  MapPin,
  AlertTriangle,
  CalendarCheck,
  Megaphone,
  Hospital,
  MessageSquareWarning,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOTIVO_LABELS, type MotivoTag } from '@/lib/ai/taxonomy/motivos';

interface QualificacaoSDRPanelProps {
  customFields?: Record<string, unknown> | null;
  compact?: boolean;
  className?: string;
}

type TierValue = 'ouro' | 'prata' | 'bronze' | 'indefinido' | 'fora_icp';

interface TierData {
  value?: TierValue;
  motivos?: string[];
  provisorio?: boolean;
}

interface Qualificacao {
  tem_cnpj?: string | null;
  vidas?: number | null;
  idades?: number[] | null;
  tem_plano_atual?: string | null;
  operadora?: string | null;
  valor_pago_exato?: number | null;
  coparticipacao?: string | null;
  hospital_preferencia?: string | null;
  cidade_uf?: string | null;
  reuniao_preferencia?: string | null;
  algo_a_destacar?: string | null;
}

const TIER_META: Record<TierValue, { label: string; badge: string }> = {
  ouro: { label: 'Ouro', badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-500/30' },
  prata: { label: 'Prata', badge: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300 border border-slate-300 dark:border-slate-500/30' },
  bronze: { label: 'Bronze', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-700/20 dark:text-amber-300 border border-amber-300 dark:border-amber-600/30' },
  indefinido: { label: 'A definir', badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700' },
  fora_icp: { label: 'Fora do perfil', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30' },
};

function cnpjLabel(v?: string | null): string | null {
  switch (v) {
    case 'pme': return 'PME (tem CNPJ)';
    case 'mei': return 'MEI';
    case 'vai_abrir_mei': return 'Vai abrir MEI';
    case 'nao_tem': return 'Sem CNPJ';
    default: return null;
  }
}

function planoLine(q: Qualificacao): string {
  if (q.tem_plano_atual === 'nao') return 'Primeiro plano';
  if (q.tem_plano_atual !== 'sim' && !q.operadora && q.valor_pago_exato == null) return '—';
  const parts: string[] = [];
  if (q.operadora) parts.push(String(q.operadora));
  if (typeof q.valor_pago_exato === 'number') parts.push(`R$ ${q.valor_pago_exato.toLocaleString('pt-BR')}`);
  if (q.coparticipacao === 'com') parts.push('c/ copart.');
  else if (q.coparticipacao === 'sem') parts.push('s/ copart.');
  return parts.length ? parts.join(' · ') : 'Já tem plano';
}

/** Pendências que o consultor ainda precisa fechar (espelha buildConsultantSummary). */
function pendencias(q: Qualificacao): string[] {
  const p: string[] = [];
  const idades = Array.isArray(q.idades) ? q.idades.filter((n) => typeof n === 'number') : [];
  const cnpj = q.tem_cnpj ?? undefined;
  if (cnpj === 'vai_abrir_mei') p.push('orientar abertura do MEI');
  else if (!cnpj || cnpj === 'desconhecido') p.push('confirmar CNPJ (PME/MEI)');
  else if (cnpj !== 'nao_tem') p.push('pegar nº do CNPJ' + (q.cidade_uf ? '' : ' e a cidade'));
  if (q.tem_plano_atual === 'sim' && typeof q.valor_pago_exato !== 'number') p.push('valor da mensalidade');
  if (typeof q.vidas === 'number' && idades.length > 0 && idades.length < q.vidas) p.push('idades faltando');
  return p;
}

/** Detecta se há dados de qualificação e/ou formulário do Meta nos custom_fields. */
function detectData(customFields?: Record<string, unknown> | null): { hasQual: boolean; hasForm: boolean } {
  const q = customFields?.qualificacao;
  const hasQual = !!(
    q &&
    typeof q === 'object' &&
    Object.values(q as Record<string, unknown>).some(
      (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
    )
  );
  const fields = (customFields?.lead_form as { fields?: Record<string, unknown> } | undefined)?.fields;
  const hasForm = !!(
    fields &&
    typeof fields === 'object' &&
    Object.values(fields).some((v) => v !== null && v !== undefined && String(v).trim() !== '')
  );
  return { hasQual, hasForm };
}

/**
 * O card deve renderizar o painel? Compact (barra lateral) só quando há qualificação;
 * completo (aba IA Insights) quando há qualificação OU formulário do Meta. Usado pelo
 * DealDetailModal pra não deixar um bloco vazio.
 */
export function sdrPanelHasData(customFields?: Record<string, unknown> | null, opts?: { compact?: boolean }): boolean {
  const { hasQual, hasForm } = detectData(customFields);
  return opts?.compact ? hasQual : hasQual || hasForm;
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-400 mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider leading-tight">{label}</p>
        <p className="text-xs text-slate-900 dark:text-white break-words">{value}</p>
      </div>
    </div>
  );
}

export function QualificacaoSDRPanel({ customFields, compact, className }: QualificacaoSDRPanelProps) {
  const q = (customFields?.qualificacao ?? null) as Qualificacao | null;
  const tier = (customFields?.tier ?? null) as TierData | null;
  // objecoes pode ser string[] (formato antigo da Ana) ou {categoria,detalhe,origem}[]
  // (taxonomia unificada). Normaliza pra rótulos de exibição, tolerando os dois.
  const objecoes = Array.isArray(customFields?.objecoes)
    ? (customFields!.objecoes as unknown[]).map((o) => {
        if (typeof o === 'string') return o;
        if (o && typeof o === 'object') {
          const rec = o as { categoria?: string; detalhe?: string | null };
          const base = rec.categoria ? (MOTIVO_LABELS[rec.categoria as MotivoTag] ?? rec.categoria) : (rec.detalhe ?? '');
          return rec.categoria && rec.detalhe ? `${base}: ${rec.detalhe}` : base;
        }
        return String(o);
      }).filter(Boolean)
    : [];
  const leadForm = customFields?.lead_form as { fields?: Record<string, unknown> } | null | undefined;
  const reuniao = customFields?.reuniao_agendada as { status?: string; label?: string } | null | undefined;

  const { hasQual, hasForm } = detectData(customFields);
  const formFields = leadForm?.fields && typeof leadForm.fields === 'object' ? leadForm.fields : null;

  if (!hasQual && !hasForm) return null;
  if (compact && !hasQual) return null; // compact (sidebar) só mostra a qualificação; o formulário fica na aba IA Insights

  const idades = Array.isArray(q?.idades) ? q!.idades!.filter((n) => typeof n === 'number') : [];
  const vidasStr = typeof q?.vidas === 'number'
    ? (idades.length ? `${q.vidas} (idades: ${idades.join(', ')})` : String(q.vidas))
    : null;
  const cnpjStr = q ? cnpjLabel(q.tem_cnpj) : null;
  const tierValue = (tier?.value ?? 'indefinido') as TierValue;
  const tm = TIER_META[tierValue] ?? TIER_META.indefinido;
  const pend = q ? pendencias(q) : [];
  const reuniaoConfirmada = reuniao?.status === 'confirmada' ? reuniao.label : null;

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-4 h-4 text-primary-500" />
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Qualificação (Ana)</h4>
        {hasQual && (
          <span className={cn('ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full', tm.badge)}>
            {tm.label}{tier?.provisorio ? ' · provisório' : ''}
          </span>
        )}
      </div>

      {hasQual && (
        <div className={cn('gap-3', compact ? 'flex flex-col' : 'grid grid-cols-2')}>
          <Row icon={<HeartPulse className="w-3.5 h-3.5" />} label="Plano atual" value={planoLine(q!)} />
          {vidasStr && <Row icon={<Users className="w-3.5 h-3.5" />} label="Vidas" value={vidasStr} />}
          {cnpjStr && <Row icon={<Building2 className="w-3.5 h-3.5" />} label="CNPJ" value={cnpjStr} />}
          {q?.cidade_uf && <Row icon={<MapPin className="w-3.5 h-3.5" />} label="Cidade" value={String(q.cidade_uf)} />}
          {q?.hospital_preferencia && <Row icon={<Hospital className="w-3.5 h-3.5" />} label="Hospital" value={String(q.hospital_preferencia)} />}
          {q?.algo_a_destacar && <Row icon={<MessageSquareWarning className="w-3.5 h-3.5" />} label="Observação" value={String(q.algo_a_destacar)} />}
        </div>
      )}

      {reuniaoConfirmada && (
        <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg px-3 py-2">
          <CalendarCheck className="w-4 h-4 shrink-0" />
          <span>Ligação do consultor: <strong>{reuniaoConfirmada}</strong></span>
        </div>
      )}

      {pend.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Consultor precisa pegar</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pend.map((p) => (
              <span key={p} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 border border-amber-200 dark:border-amber-500/20">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {!compact && objecoes.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Objeções</p>
          <div className="flex flex-wrap gap-1.5">
            {objecoes.map((o, i) => (
              <span key={`${o}-${i}`} className="text-[11px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300 border border-rose-200 dark:border-rose-500/20">
                {o}
              </span>
            ))}
          </div>
        </div>
      )}

      {!compact && tier?.motivos && tier.motivos.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Tier {tm.label.toLowerCase()}: {tier.motivos.join('; ')}
        </p>
      )}

      {!compact && hasForm && (
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Megaphone className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Formulário do anúncio (Meta)</span>
          </div>
          <dl className="space-y-1.5">
            {Object.entries(formFields!)
              .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
              .filter(([k]) => !['anuncio', 'campanha', 'conjunto', 'channel_id'].includes(k))
              .map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0 max-w-[55%] break-words">{k}</dt>
                  <dd className="text-slate-900 dark:text-white font-medium break-words">{String(v)}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}
    </div>
  );
}
