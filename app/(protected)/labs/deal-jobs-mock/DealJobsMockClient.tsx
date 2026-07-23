'use client';

import React from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, MessageSquareText, Phone, Sparkles, Target } from 'lucide-react';

type TimelineItem = {
  id: string;
  kind: 'human' | 'system';
  label: string;
  meta?: string;
  at: string;
};

const mock = {
  deal: {
    title: 'Proposta PROP-2',
    company: 'Empresa',
    stageLabel: 'Negociação',
    valueBRL: 10128.1,
  },
  contact: {
    name: 'Carla Gomes',
    role: 'Analista',
    email: 'carla.gomes48@gmail.com',
    phoneE164: '+5560999469863',
  },
  nextAction: {
    title: 'Agradecer cliente e agendar onboarding',
    why: 'O deal acabou de entrar em “Ganho”. Consolidar relacionamento e garantir kickoff ainda hoje aumenta retenção.',
    cta: 'Executar agora',
  },
  copilot: {
    title: 'Próxima melhor ação',
    suggestion: 'Envie uma mensagem curta de agradecimento e já ofereça 2 horários para kickoff.',
    action: 'Gerar mensagem',
  },
  timeline: [
    { id: 't1', kind: 'human', label: 'Ligação: Apresentação', meta: 'Próximo passo para Proposta PROP-2', at: '20/12/2025 · 16:59' },
    { id: 't2', kind: 'human', label: 'Moveu para “PROPOSTA”', meta: 'Atualização manual', at: '20/12/2025 · 12:21' },
    { id: 't3', kind: 'system', label: 'Contato promovido para CUSTOMER', meta: 'Automático via LinkedStage', at: '21/12/2025 · 19:56' },
    { id: 't4', kind: 'system', label: 'Moveu para “GANHO”', meta: 'Automático via regra', at: '21/12/2025 · 19:56' },
    { id: 't5', kind: 'system', label: 'Contato promovido para OTHER', meta: 'Automático via LinkedStage', at: '21/12/2025 · 19:56' },
    { id: 't6', kind: 'system', label: 'Moveu para “PERDIDO”', meta: 'Automático via regra', at: '21/12/2025 · 19:56' },
  ] as TimelineItem[],
};

function formatCurrencyBRL(value: number): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `R$ ${value.toFixed(2)}`;
  }
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' }) {
  const cls =
    tone === 'success'
      ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
      : tone === 'warning'
        ? 'bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/20'
        : 'bg-white/5 text-slate-200 ring-1 ring-white/10';

  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{children}</span>;
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const dot = item.kind === 'human' ? 'bg-cyan-400' : 'bg-slate-500';
  const titleCls = item.kind === 'human' ? 'text-slate-100' : 'text-slate-200';
  const metaCls = item.kind === 'human' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="flex gap-3 py-3">
      <div className="mt-1.5 flex flex-col items-center">
        <div className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <div className="mt-2 h-full w-px bg-white/5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={`truncate text-sm font-semibold ${titleCls}`}>{item.label}</div>
            {item.meta ? <div className={`mt-0.5 truncate text-xs ${metaCls}`}>{item.meta}</div> : null}
          </div>
          <div className="shrink-0 text-xs text-slate-500">{item.at}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Componente React `DealJobsMockClient`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function DealJobsMockClient() {
  const [showSystemEvents, setShowSystemEvents] = React.useState(false);

  const humanItems = React.useMemo(() => mock.timeline.filter((t) => t.kind === 'human'), []);
  const systemItems = React.useMemo(() => mock.timeline.filter((t) => t.kind === 'system'), []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="w-full px-6 py-6 2xl:px-10">
        {/* Header (context, no noise) */}
        <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-slate-100">
                {mock.deal.title}
                <span className="text-slate-400"> · {mock.deal.company}</span>
              </h1>
              <Badge tone="warning">{mock.deal.stageLabel}</Badge>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Versão mock (Jobs-style) · rota dev-only
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge tone="success">{formatCurrencyBRL(mock.deal.valueBRL)}</Badge>
          </div>
        </header>

        {/* 3-column layout: Main (execution) + Side (copilot) */}
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* Main */}
          <main className="rounded-2xl border border-white/10 bg-white/3 p-4">
            {/* Hero: Next action */}
            <section className="rounded-2xl border border-white/10 bg-linear-to-r from-white/5 to-white/2 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Target className="h-4 w-4" />
                    Próxima ação
                  </div>
                  <h2 className="mt-2 text-base font-semibold text-slate-100">
                    {mock.nextAction.title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">{mock.nextAction.why}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" />
                      {mock.contact.phoneE164}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="truncate">{mock.contact.email}</span>
                  </div>
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/25 hover:bg-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    onClick={() => {
                      // mock only
                      alert('Mock: executar agora');
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {mock.nextAction.cta}
                  </button>

                  <div className="mt-2 text-right text-[11px] text-slate-500">
                    1 CTA primário. O resto é suporte.
                  </div>
                </div>
              </div>
            </section>

            {/* Timeline (clean) */}
            <section className="mt-4 rounded-2xl border border-white/10 bg-white/2 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">Linha do tempo</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Eventos relevantes primeiro; automações ficam colapsadas.
                  </p>
                </div>

                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/3 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5"
                  onClick={() => setShowSystemEvents((v) => !v)}
                >
                  {showSystemEvents ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {showSystemEvents ? 'Ocultar automações' : `Mostrar automações (${systemItems.length})`}
                </button>
              </div>

              <div className="mt-3">
                {humanItems.map((item) => (
                  <TimelineRow key={item.id} item={item} />
                ))}

                {!showSystemEvents ? (
                  <div className="mt-2 rounded-xl border border-white/10 bg-white/2 p-3 text-xs text-slate-400">
                    {systemItems.length} eventos automáticos ocultos.
                  </div>
                ) : (
                  <div className="mt-2">
                    {systemItems.map((item) => (
                      <TimelineRow key={item.id} item={item} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </main>

          {/* Side */}
          <aside className="rounded-2xl border border-white/10 bg-white/3 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-500/20">
                  <Sparkles className="h-4 w-4 text-cyan-300" />
                </div>
                <div>
                  <div className="text-sm font-semibold">NIVA CRM Copilot</div>
                  <div className="text-xs text-slate-500">1 sugestão por vez</div>
                </div>
              </div>
              <Badge tone="success">Pronto</Badge>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-linear-to-br from-white/5 to-white/2 p-4">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <MessageSquareText className="h-4 w-4" />
                {mock.copilot.title}
              </div>
              <p className="mt-2 text-sm text-slate-200">{mock.copilot.suggestion}</p>

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                  onClick={() => {
                    alert('Mock: gerar mensagem');
                  }}
                >
                  {mock.copilot.action}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-white/10 bg-white/3 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5"
                  onClick={() => {
                    alert('Mock: ver mais opções');
                  }}
                >
                  Ver mais opções
                </button>
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-xs font-medium text-slate-400">Pergunte algo</label>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/2 p-2">
                <input
                  type="text"
                  placeholder="Ex.: Gere uma mensagem de onboarding"
                  className="w-full bg-transparent px-2 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-600"
                />
                <button
                  type="button"
                  className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                  onClick={() => {
                    alert('Mock: enviar');
                  }}
                >
                  Enviar
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Sem menu de features aqui — só conversa + uma recomendação ativa.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
