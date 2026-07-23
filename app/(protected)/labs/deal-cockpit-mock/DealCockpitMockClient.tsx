'use client';

import React from 'react';
import {
  Activity,
  BadgeCheck,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Filter,
  HeartPulse,
  Inbox,
  MessageCircle,
  Phone,
  Search,
  Send,
  Settings,
  Sparkles,
  StickyNote,
  X,
} from 'lucide-react';

type Stage = { id: string; label: string; tone: 'blue' | 'violet' | 'amber' | 'green' | 'slate' };

type TimelineItem = {
  id: string;
  at: string;
  kind: 'status' | 'call' | 'note' | 'system';
  title: string;
  subtitle?: string;
  tone?: 'success' | 'danger' | 'neutral';
};

type Tab = 'chat' | 'notas' | 'scripts' | 'arquivos';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
};

type ToastTone = 'neutral' | 'success' | 'danger';
type ToastState = { id: string; message: string; tone: ToastTone };

type ChecklistItem = {
  id: string;
  label: string;
  hint?: string;
};

type LeftDataTab = 'contato' | 'negocio';

type QuickAction = {
  id: string;
  label: string;
  icon: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
};

const stages: Stage[] = [
  { id: 'discover', label: 'Descoberta', tone: 'blue' },
  { id: 'proposal', label: 'Proposta', tone: 'violet' },
  { id: 'negotiation', label: 'Negociação', tone: 'amber' },
  { id: 'won', label: 'Ganho', tone: 'green' },
  { id: 'lost', label: 'Perdido', tone: 'slate' },
];

const mock = {
  deal: {
    title: 'Proposta PROP-2',
    company: 'Empresa',
    valueBRL: 10128.1,
    stageId: 'negotiation',
    healthPct: 61,
    owner: { name: 'Eu' },
    createdAt: '03/12/2025',
    updatedAt: '21/12/2025',
    probabilityPct: 61,
    priority: 'Média',
  },
  contact: {
    name: 'Carla Gomes',
    role: 'Analista',
    phoneE164: '+5560999469863',
    email: 'carla.gomes48@gmail.com',
    source: 'Indicação',
    status: 'Inativo',
  },
  nextAction: {
    title: 'Agradecer cliente e agendar onboarding',
    description: 'Solidificar relacionamento e garantir sucesso na implementação do serviço.',
  },
  quickActions: [
    { id: 'dx', label: 'Diagnóstico do Deal', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'next', label: 'Próxima ação', icon: <ChevronRight className="h-4 w-4" />, tone: 'success' },
    { id: 'wa', label: 'Gerar WhatsApp', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'week', label: 'Tarefas da semana', icon: <CalendarClock className="h-4 w-4" /> },
  ] as QuickAction[],
};

const initialTimeline: TimelineItem[] = [
  { id: '1', kind: 'status', title: 'Moveu para', subtitle: 'GANHO', at: '21/12/2025 · 19:56', tone: 'success' },
  { id: '2', kind: 'system', title: 'Contato promovido para CUSTOMER', subtitle: 'Automático via LinkedStage da etapa "Ganho"', at: '21/12/2025 · 19:56' },
  { id: '3', kind: 'status', title: 'Moveu para', subtitle: 'PERDIDO', at: '21/12/2025 · 19:56', tone: 'danger' },
  { id: '4', kind: 'system', title: 'Contato promovido para OTHER', subtitle: 'Automático via LinkedStage da etapa "Perdido"', at: '21/12/2025 · 19:56' },
  { id: '5', kind: 'call', title: 'Ligação', subtitle: 'Apresentação — Próximo passo para Proposta PROP-2', at: '20/12/2025 · 16:59' },
  { id: '6', kind: 'status', title: 'Moveu para', subtitle: 'PROPOSTA', at: '20/12/2025 · 12:21', tone: 'neutral' },
];

function formatAt(date = new Date()): string {
  const d = date.toLocaleDateString('pt-BR');
  const t = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${d} · ${t}`;
}

function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

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

function toneToBg(tone: Stage['tone']): string {
  switch (tone) {
    case 'blue':
      return 'bg-sky-500';
    case 'violet':
      return 'bg-violet-500';
    case 'amber':
      return 'bg-amber-500';
    case 'green':
      return 'bg-emerald-500';
    default:
      return 'bg-slate-600';
  }
}

function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'danger' }) {
  const cls =
    tone === 'success'
      ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/20'
      : tone === 'danger'
        ? 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/20'
        : 'bg-white/5 text-slate-200 ring-1 ring-white/10';

  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function Panel({
  title,
  icon,
  right,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/3 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          {icon}
          <span className="uppercase tracking-wide text-slate-400">{title}</span>
        </div>
        {right}
      </div>
      <div className={`p-4 ${bodyClassName ?? ''}`}>{children}</div>
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'text-slate-100 border-b-2 border-cyan-400'
          : 'text-slate-400 hover:text-slate-200 border-b-2 border-transparent'
      }
    >
      <span className="px-2 py-2 text-xs font-semibold uppercase tracking-wide">{children}</span>
    </button>
  );
}

/**
 * Componente React `DealCockpitMockClient`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function DealCockpitMockClient() {
  const [tab, setTab] = React.useState<Tab>('chat');
  const [query, setQuery] = React.useState('');
  const [leftDataTab, setLeftDataTab] = React.useState<LeftDataTab>('contato');

  const [stageId, setStageId] = React.useState<string>(mock.deal.stageId);
  const [timeline, setTimeline] = React.useState<TimelineItem[]>(() => initialTimeline);
  const [showSystemEvents, setShowSystemEvents] = React.useState(false);
  const [kindFilter, setKindFilter] = React.useState<'all' | TimelineItem['kind']>('all');

  const [noteDraft, setNoteDraft] = React.useState('');
  const [savedNotes, setSavedNotes] = React.useState<Array<{ id: string; at: string; text: string }>>([]);

  const [chatDraft, setChatDraft] = React.useState('');
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>(() => [
    {
      id: 'm1',
      role: 'assistant',
      text:
        'Estou no modo cockpit (mock). Posso te ajudar com: próxima ação, mensagens, diagnóstico e checklist da semana — clique nos botões rápidos ou escreva uma pergunta.',
    },
  ]);

  const [toast, setToast] = React.useState<ToastState | null>(null);

  const [lastGeneratedWhatsAppMessage, setLastGeneratedWhatsAppMessage] = React.useState<string | null>(null);

  const [executionDone, setExecutionDone] = React.useState<Record<string, boolean>>({
    kickoff: false,
    thankyou: true,
    champion: false,
    success: false,
  });

  const stageIndex = Math.max(0, stages.findIndex((s) => s.id === stageId));
  const activeStage = stages.find((s) => s.id === stageId) ?? stages[0];

  const latestNonSystem = React.useMemo(() => timeline.find((t) => t.kind !== 'system') ?? null, [timeline]);
  const latestCall = React.useMemo(() => timeline.find((t) => t.kind === 'call') ?? null, [timeline]);
  const latestMove = React.useMemo(() => timeline.find((t) => t.kind === 'status') ?? null, [timeline]);

  const buildWhatsAppMessage = React.useCallback((): string => {
    const firstName = mock.contact.name.split(' ')[0] ?? mock.contact.name;
    return `Oi ${firstName}! Obrigado por avançarmos hoje na ${mock.deal.title}. Posso te sugerir dois horários para o kickoff: amanhã 10:00 ou 16:30?`;
  }, []);

  const openWhatsApp = React.useCallback(
    (text?: string) => {
      // wa.me precisa do telefone só com dígitos (sem +)
      const digits = mock.contact.phoneE164.replace(/\D/g, '');
      const base = `https://wa.me/${digits}`;
      const url = text ? `${base}?text=${encodeURIComponent(text)}` : base;
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    []
  );

  const executionChecklist: ChecklistItem[] = React.useMemo(() => {
    // mock: checklist base que funciona bem em qualquer etapa
    const base: ChecklistItem[] = [
      { id: 'thankyou', label: 'Enviar agradecimento', hint: 'Mensagem curta + reforço do valor.' },
      { id: 'kickoff', label: 'Agendar kickoff', hint: '2 horários, 30 minutos.' },
      { id: 'champion', label: 'Confirmar champion', hint: 'Quem decide/compra internamente?' },
      { id: 'success', label: 'Definir sucesso (30/60 dias)', hint: 'Critérios objetivos + métricas.' },
    ];
    if (stageId === 'won') {
      return [
        { id: 'kickoff', label: 'Kickoff agendado', hint: 'Data, horário, participantes.' },
        { id: 'success', label: 'Plano de sucesso definido', hint: '30/60 dias + entregáveis.' },
        { id: 'access', label: 'Acessos confirmados', hint: 'Responsáveis e credenciais.' },
      ];
    }
    if (stageId === 'lost') {
      return [
        { id: 'reason', label: 'Motivo da perda registrado', hint: 'Preço, timing, produto, concorrente…' },
        { id: 'reopen', label: 'Próximo touch agendado', hint: 'Quando tentar novamente.' },
      ];
    }
    return base;
  }, [stageId]);

  const executionPct = React.useMemo(() => {
    const ids = executionChecklist.map((i) => i.id);
    if (ids.length === 0) return 0;
    const done = ids.filter((id) => Boolean(executionDone[id])).length;
    return Math.round((done / ids.length) * 100);
  }, [executionChecklist, executionDone]);

  const pushToast = React.useCallback((message: string, tone: ToastTone = 'neutral') => {
    const id = uid('toast');
    setToast({ id, message, tone });
    window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 2400);
  }, []);

  const prependTimeline = React.useCallback((item: Omit<TimelineItem, 'id' | 'at'> & { at?: string; id?: string }) => {
    const newItem: TimelineItem = {
      id: item.id ?? uid('t'),
      at: item.at ?? formatAt(),
      kind: item.kind,
      title: item.title,
      subtitle: item.subtitle,
      tone: item.tone,
    };
    setTimeline((prev) => [newItem, ...prev]);
  }, []);

  const handleStageChange = React.useCallback(
    (nextStageId: string) => {
      if (nextStageId === stageId) return;
      const next = stages.find((s) => s.id === nextStageId);
      if (!next) return;

      setStageId(nextStageId);
      const tone: TimelineItem['tone'] = nextStageId === 'won' ? 'success' : nextStageId === 'lost' ? 'danger' : 'neutral';
      prependTimeline({ kind: 'status', title: 'Moveu para', subtitle: next.label.toUpperCase(), tone });
      pushToast(`Etapa: ${next.label}`, 'success');
    },
    [prependTimeline, pushToast, stageId]
  );

  const runQuickAction = React.useCallback(
    (actionId: string) => {
      const pushAssistant = (text: string) => setChatMessages((prev) => [...prev, { id: uid('m'), role: 'assistant', text }]);

      if (actionId === 'dx') {
        pushAssistant(
          'Diagnóstico rápido (mock):\n\n• Momentum: médio (última atividade há 2 dias)\n• Risco: “campeão” no cliente ainda não confirmado\n• Próximo passo recomendado: confirmar kickoff + alinhar critérios de sucesso (30/60 dias).'
        );
        prependTimeline({ kind: 'system', title: 'IA gerou diagnóstico', subtitle: 'Resumo (mock) adicionado no painel de IA.' });
        return;
      }

      if (actionId === 'next') {
        pushAssistant(
          'Próxima melhor ação (mock):\n1) Enviar mensagem de agradecimento\n2) Sugerir 2 horários para kickoff\n3) Pedir confirmação de quem aprova internamente.'
        );
        prependTimeline({ kind: 'system', title: 'IA sugeriu próxima ação', subtitle: 'Checklist gerado (mock).' });
        return;
      }

      if (actionId === 'wa') {
        const msg = buildWhatsAppMessage();
        setLastGeneratedWhatsAppMessage(msg);
        pushAssistant(
          `Mensagem WhatsApp (mock):\n\n${msg}`
        );
        prependTimeline({ kind: 'status', title: 'WhatsApp', subtitle: 'Rascunho gerado (IA/mock)' });
        pushToast('Mensagem gerada (mock)', 'success');
        return;
      }

      if (actionId === 'week') {
        pushAssistant(
          'Tarefas da semana (mock):\n\n• Kickoff agendado\n• Checklist de implantação enviado\n• Definir indicadores de sucesso\n• Confirmar acessos + responsáveis'
        );
        prependTimeline({ kind: 'system', title: 'IA listou tarefas', subtitle: 'Plano semanal (mock).' });
        return;
      }

      pushToast('Ação não implementada (mock)', 'neutral');
    },
    [buildWhatsAppMessage, prependTimeline, pushToast]
  );

  const handleSendChat = React.useCallback(() => {
    const text = chatDraft.trim();
    if (!text) return;
    setChatDraft('');
    setChatMessages((prev) => [...prev, { id: uid('m'), role: 'user', text }]);

    // Mock response (sem chamar backend)
    window.setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        {
          id: uid('m'),
          role: 'assistant',
          text:
            'Entendi. Como é mock, eu não chamo o banco nem a IA real — mas posso simular: quer (1) mensagem pronta, (2) checklist de próxima ação, ou (3) perguntas de qualificação?',
        },
      ]);
    }, 220);
  }, [chatDraft]);

  const copyToClipboard = React.useCallback(
    async (label: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        pushToast(`${label} copiado`, 'success');
      } catch {
        pushToast(`Não foi possível copiar ${label.toLowerCase()}`, 'danger');
      }
    },
    [pushToast]
  );

  return (
    <div className="h-dvh overflow-hidden bg-slate-950 text-slate-100">
      {toast ? (
        <div className="fixed right-6 top-6 z-50">
          <div
            className={
              toast.tone === 'success'
                ? 'flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 shadow-xl shadow-black/30'
                : toast.tone === 'danger'
                  ? 'flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/15 px-4 py-3 text-sm text-rose-100 shadow-xl shadow-black/30'
                  : 'flex items-center gap-2 rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm text-slate-100 shadow-xl shadow-black/30'
            }
            role="status"
            aria-live="polite"
          >
            {toast.tone === 'success' ? <Check className="h-4 w-4" /> : toast.tone === 'danger' ? <X className="h-4 w-4" /> : null}
            <div className="min-w-0 truncate">{toast.message}</div>
          </div>
        </div>
      ) : null}

      {/* Top pipeline bar */}
      <div className="sticky top-0 z-40 h-16 border-b border-white/5 bg-black/40 backdrop-blur">
        <div className="flex h-16 w-full items-center px-6 2xl:px-10">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-slate-100">{mock.deal.title}</div>
                <div className="text-xs text-slate-500">|</div>
                <div className="truncate text-xs text-slate-400">{mock.deal.company}</div>
              </div>
              <div className="mt-1 text-[11px] text-slate-600">2. Pipeline de Vendas</div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold text-emerald-300">{formatCurrencyBRL(mock.deal.valueBRL)}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                Etapa: <span className="font-semibold text-slate-300">{activeStage.label}</span>
              </div>
            </div>
          </div>

          <div className="ml-8 grid flex-1 grid-cols-5 gap-3">
            {stages.map((s, idx) => {
              const isActive = idx === stageIndex;
              const isDone = idx < stageIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => handleStageChange(s.id)}
                  title={`Mover para ${s.label}`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-1.5 flex-1 rounded-full ${isDone || isActive ? toneToBg(s.tone) : 'bg-white/10'}`}
                    />
                    <div className={`h-2 w-2 rounded-full ${isActive ? toneToBg(s.tone) : isDone ? 'bg-white/30' : 'bg-white/10'}`} />
                  </div>
                  <div className={`mt-1 text-[11px] ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>{s.label}</div>
                </button>
              );
            })}
          </div>

          <div className="ml-8 hidden text-[11px] text-slate-600 xl:block">Clique nas etapas para simular movimentação (mock)</div>
        </div>
      </div>

      {/* Cockpit layout */}
      <div className="h-[calc(100dvh-64px)] w-full overflow-hidden px-6 py-4 2xl:px-10">
        <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[360px_1fr_420px] lg:items-stretch">
          {/* Left rail */}
          <div className="flex min-h-0 flex-col gap-4 overflow-auto pr-1">
            <Panel
              title="Health"
              icon={<HeartPulse className="h-4 w-4 text-emerald-300" />}
              right={<Chip tone="success">{mock.deal.healthPct}%</Chip>}
              className="shrink-0"
            >
              <div className="h-2 w-full rounded-full bg-white/10">
                <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${mock.deal.healthPct}%` }} />
              </div>
              <div className="mt-2 text-[11px] text-slate-500">Indicador sintético (mock) — objetivo é te dar leitura rápida.</div>
            </Panel>

            <Panel title="Próxima ação" icon={<BadgeCheck className="h-4 w-4 text-cyan-300" /> } className="shrink-0">
              <div className="text-sm font-semibold text-slate-100">{mock.nextAction.title}</div>
              <div className="mt-1 text-xs text-slate-400">{mock.nextAction.description}</div>
              <div className="mt-2 text-[11px] text-slate-500">
                Ações aqui EXECUTAM (discador, rascunho, agendar). No rodapé da timeline você REGISTRA atividades rápidas.
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/25 hover:bg-rose-500"
                  onClick={() => {
                    // Mock: executar a próxima ação = preparar o kit (rascunho + agenda + tarefa) e registrar tudo.
                    setTab('chat');
                    runQuickAction('wa');
                    prependTimeline({ kind: 'status', title: 'Reunião', subtitle: 'Kickoff — sugeriu 2 horários (mock)' });
                    prependTimeline({ kind: 'status', title: 'Tarefa', subtitle: 'Follow-up onboarding (mock)' });
                    prependTimeline({ kind: 'system', title: 'Próxima ação executada', subtitle: mock.nextAction.title });
                    pushToast('Próxima ação preparada (mock)', 'success');
                  }}
                >
                  <Activity className="h-4 w-4" />
                  Executar agora
                </button>
                <div className="grid w-full grid-cols-4 gap-2">
                  <button
                    type="button"
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/3 px-2 py-2 hover:bg-white/5"
                    title="Ligar (abre o discador)"
                    aria-label="Ligar (abre o discador)"
                    onClick={() => {
                      prependTimeline({ kind: 'call', title: 'Ligação', subtitle: `Iniciou ligação para ${mock.contact.phoneE164} (mock)` });
                      pushToast('Abrindo discador…', 'neutral');
                      window.location.href = `tel:${mock.contact.phoneE164}`;
                    }}
                  >
                    <Phone className="h-4 w-4 text-slate-200" />
                    <span className="text-[10px] font-semibold text-slate-300">Ligar</span>
                  </button>
                  <button
                    type="button"
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/3 px-2 py-2 hover:bg-white/5"
                    title="Gerar WhatsApp (IA) — cria rascunho no chat"
                    aria-label="Gerar WhatsApp (IA) — cria rascunho no chat"
                    onClick={() => {
                      setTab('chat');
                      runQuickAction('wa');
                    }}
                  >
                    <Sparkles className="h-4 w-4 text-slate-200" />
                    <span className="text-[10px] font-semibold text-slate-300">Gerar WA</span>
                  </button>
                  <button
                    type="button"
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/3 px-2 py-2 hover:bg-white/5"
                    title="Rascunho e-mail (mock)"
                    aria-label="Rascunho e-mail (mock)"
                    onClick={() => {
                      prependTimeline({ kind: 'status', title: 'E-mail', subtitle: 'Rascunho criado (mock)' });
                      pushToast('Rascunho de e-mail criado (mock)', 'success');
                    }}
                  >
                    <Inbox className="h-4 w-4 text-slate-200" />
                    <span className="text-[10px] font-semibold text-slate-300">E-mail</span>
                  </button>
                  <button
                    type="button"
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/3 px-2 py-2 hover:bg-white/5"
                    title="Agendar (mock)"
                    aria-label="Agendar (mock)"
                    onClick={() => {
                      prependTimeline({ kind: 'status', title: 'Agendar', subtitle: 'Agenda aberta (mock)' });
                      pushToast('Abriria agenda (mock)', 'neutral');
                    }}
                  >
                    <CalendarClock className="h-4 w-4 text-slate-200" />
                    <span className="text-[10px] font-semibold text-slate-300">Agendar</span>
                  </button>
                </div>
              </div>
            </Panel>

            <Panel
              title="Dados"
              icon={<FileText className="h-4 w-4 text-slate-300" />}
              right={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={
                      leftDataTab === 'contato'
                        ? 'rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-slate-100 ring-1 ring-white/10'
                        : 'rounded-full bg-white/3 px-2.5 py-1 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-white/5'
                    }
                    onClick={() => setLeftDataTab('contato')}
                  >
                    Contato
                  </button>
                  <button
                    type="button"
                    className={
                      leftDataTab === 'negocio'
                        ? 'rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-slate-100 ring-1 ring-white/10'
                        : 'rounded-full bg-white/3 px-2.5 py-1 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-white/5'
                    }
                    onClick={() => setLeftDataTab('negocio')}
                  >
                    Negócio
                  </button>
                </div>
              }
              className="flex min-h-0 flex-1 flex-col"
              bodyClassName="min-h-0 flex-1 overflow-auto"
            >
              {leftDataTab === 'contato' ? (
                <div className="flex min-h-0 flex-col gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{mock.contact.name}</div>
                    <div className="mt-1 text-xs text-slate-400">{mock.contact.role}</div>
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Tel</span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-slate-200">{mock.contact.phoneE164}</span>
                          <button
                            type="button"
                            className="rounded-lg border border-white/10 bg-white/2 p-1.5 text-slate-300 hover:bg-white/5"
                            title="Copiar telefone"
                            onClick={() => copyToClipboard('Telefone', mock.contact.phoneE164)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Email</span>
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-slate-200">{mock.contact.email}</span>
                          <button
                            type="button"
                            className="shrink-0 rounded-lg border border-white/10 bg-white/2 p-1.5 text-slate-300 hover:bg-white/5"
                            title="Copiar email"
                            onClick={() => copyToClipboard('Email', mock.contact.email)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Origem</span>
                        <span className="text-slate-200">{mock.contact.source}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Status</span>
                        <span className="text-slate-200">{mock.contact.status}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/2 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sinais</div>
                    <div className="mt-2 space-y-1 text-xs text-slate-300">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Último evento</span>
                        <span className="truncate text-slate-200">{latestNonSystem ? `${latestNonSystem.title}${latestNonSystem.subtitle ? ` — ${latestNonSystem.subtitle}` : ''}` : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Última ligação</span>
                        <span className="truncate text-slate-200">{latestCall ? latestCall.at : '—'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Etapa</span>
                        <span className="text-slate-200">{activeStage.label}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-0 flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-xl border border-white/10 bg-white/2 p-3">
                      <div className="text-slate-500">Probabilidade</div>
                      <div className="mt-1 text-sm font-semibold text-slate-100">{mock.deal.probabilityPct}%</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/2 p-3">
                      <div className="text-slate-500">Ativ.</div>
                      <div className="mt-1 text-sm font-semibold text-slate-100">10</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/2 p-3">
                      <div className="text-slate-500">Criado</div>
                      <div className="mt-1 text-sm font-semibold text-slate-100">{mock.deal.createdAt}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/2 p-3">
                      <div className="text-slate-500">Atualizado</div>
                      <div className="mt-1 text-sm font-semibold text-slate-100">{mock.deal.updatedAt}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/2 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Resumo</div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-white/10 bg-white/2 p-2">
                        <div className="text-slate-500">Valor</div>
                        <div className="mt-0.5 font-semibold text-slate-100">{formatCurrencyBRL(mock.deal.valueBRL)}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/2 p-2">
                        <div className="text-slate-500">Prioridade</div>
                        <div className="mt-0.5 font-semibold text-slate-100">{mock.deal.priority}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/2 p-2">
                        <div className="text-slate-500">Dono</div>
                        <div className="mt-0.5 font-semibold text-slate-100">{mock.deal.owner.name}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/2 p-2">
                        <div className="text-slate-500">Última mudança</div>
                        <div className="mt-0.5 truncate font-semibold text-slate-100">{latestMove ? latestMove.at : mock.deal.updatedAt}</div>
                      </div>
                    </div>
                  </div>

                  {/* atalhos removidos: redundância com Próxima ação / Timeline / Chat */}
                </div>
              )}
            </Panel>
          </div>

          {/* Center */}
          <div className="flex min-h-0 flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Atividades</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={
                      kindFilter === 'all'
                        ? 'rounded-full bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-slate-100 ring-1 ring-white/10'
                        : 'rounded-full bg-white/3 px-3 py-1.5 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-white/5'
                    }
                    onClick={() => setKindFilter('all')}
                  >
                    Tudo
                  </button>
                  {(['call', 'note', 'status'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={
                        kindFilter === k
                          ? 'rounded-full bg-cyan-500/15 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 ring-1 ring-cyan-500/20'
                          : 'rounded-full bg-white/3 px-3 py-1.5 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-white/5'
                      }
                      onClick={() => setKindFilter(k)}
                      title={`Filtrar por ${k}`}
                    >
                      {k === 'call' ? 'Ligações' : k === 'note' ? 'Notas' : 'Mudanças'}
                    </button>
                  ))}

                  <button
                    type="button"
                    className={
                      showSystemEvents
                        ? 'rounded-full bg-amber-500/15 px-3 py-1.5 text-[11px] font-semibold text-amber-100 ring-1 ring-amber-500/20'
                        : 'rounded-full bg-white/3 px-3 py-1.5 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-white/5'
                    }
                    onClick={() => setShowSystemEvents((v) => !v)}
                    title="Mostrar/ocultar automações"
                  >
                    Sistemas
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/3 px-3 py-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar"
                    className="w-44 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
                  />
                </div>
                <button
                  type="button"
                  className="rounded-xl border border-white/10 bg-white/3 p-2 hover:bg-white/5"
                  title="Filtros"
                  onClick={() => {
                    pushToast('Use os chips (acima) para filtrar (mock)', 'neutral');
                  }}
                >
                  <Filter className="h-4 w-4 text-slate-200" />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/3">
              <div className="flex-1 min-h-0 overflow-auto divide-y divide-white/10">
                {timeline
                  .filter((t) => {
                    if (!showSystemEvents && t.kind === 'system') return false;
                    if (kindFilter !== 'all' && t.kind !== kindFilter) return false;
                    if (!query.trim()) return true;
                    const q = query.toLowerCase();
                    return `${t.title} ${t.subtitle ?? ''}`.toLowerCase().includes(q);
                  })
                  .map((t) => (
                    <div key={t.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-slate-200">{t.title}</span>
                            {t.subtitle ? (
                              t.title === 'Moveu para' ? (
                                <Chip tone={t.tone === 'success' ? 'success' : t.tone === 'danger' ? 'danger' : 'neutral'}>{t.subtitle}</Chip>
                              ) : (
                                <span className="truncate text-xs text-slate-400">{t.subtitle}</span>
                              )
                            ) : null}
                          </div>
                          {t.title !== 'Moveu para' && t.subtitle ? (
                            <div className="mt-0.5 text-[11px] text-slate-500">{t.subtitle}</div>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-[11px] text-slate-500">{t.at}</div>
                      </div>
                    </div>
                  ))}
              </div>

              <div className="border-t border-white/10 px-4 py-3">
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wide text-slate-600"
                    title="Use quando a atividade aconteceu fora do CRM (ex.: WhatsApp/telefone externo)"
                  >
                    Registrar (fora do CRM):
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 hover:text-slate-200"
                    onClick={() => {
                      prependTimeline({ kind: 'status', title: 'WhatsApp', subtitle: 'Mensagem enviada (registrado)' });
                      pushToast('WhatsApp registrado na timeline', 'success');
                    }}
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 hover:text-slate-200"
                    onClick={() => {
                      prependTimeline({ kind: 'status', title: 'E-mail', subtitle: 'Enviado (registrado)' });
                      pushToast('E-mail registrado na timeline', 'success');
                    }}
                  >
                    <Inbox className="h-4 w-4" /> Email
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 hover:text-slate-200"
                    onClick={() => {
                      prependTimeline({ kind: 'call', title: 'Ligação', subtitle: 'Realizada (registrado)' });
                      pushToast('Ligação registrada na timeline', 'success');
                    }}
                  >
                    <Phone className="h-4 w-4" /> Ligação
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 hover:text-slate-200"
                    onClick={() => {
                      prependTimeline({ kind: 'status', title: 'Reunião', subtitle: 'Agendada (registrado)' });
                      pushToast('Reunião registrada na timeline', 'success');
                    }}
                  >
                    <CalendarClock className="h-4 w-4" /> Reunião
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 hover:text-slate-200"
                    onClick={() => {
                      prependTimeline({ kind: 'status', title: 'Tarefa', subtitle: 'Criada (registrado)' });
                      pushToast('Tarefa registrada na timeline', 'success');
                    }}
                  >
                    <Activity className="h-4 w-4" /> Tarefa
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom row: útil, mas não pode roubar altura da timeline */}
            <div className="grid min-h-0 gap-4 lg:grid-cols-2 lg:max-h-[30dvh]">
              <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/3 p-4">
                <label className="block text-xs font-semibold text-slate-400">Escreva…</label>
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  className="mt-2 min-h-0 flex-1 w-full resize-none rounded-xl border border-white/10 bg-white/2 p-3 text-sm text-slate-200 outline-none placeholder:text-slate-600"
                  placeholder="Notas, resumo da call, próximos passos…"
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-500">Dica: salve highlights curtos; a timeline vira seu log.</div>
                  <button
                    type="button"
                    className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                    onClick={() => {
                      const text = noteDraft.trim();
                      if (!text) {
                        pushToast('Escreva uma nota antes de salvar', 'danger');
                        return;
                      }

                      const at = formatAt();
                      const id = uid('note');
                      setSavedNotes((prev) => [{ id, at, text }, ...prev]);
                      prependTimeline({ kind: 'note', title: 'Nota', subtitle: text.slice(0, 120) + (text.length > 120 ? '…' : '') });
                      setNoteDraft('');
                      pushToast('Nota salva', 'success');
                    }}
                  >
                    Salvar
                  </button>
                </div>
              </div>

              <Panel
                title="Execução"
                icon={<Activity className="h-4 w-4 text-amber-200" />}
                right={<Chip tone={executionPct >= 70 ? 'success' : 'neutral'}>{executionPct}%</Chip>}
                className="flex min-h-0 flex-col"
                bodyClassName="min-h-0 flex-1 overflow-auto"
              >
                <div className="h-2 w-full rounded-full bg-white/10">
                  <div className="h-2 rounded-full bg-amber-400" style={{ width: `${executionPct}%` }} />
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Checklist rápido por etapa — use isso para preencher o “espaço vazio” com ação.
                </div>

                <div className="mt-3 space-y-2">
                  {executionChecklist.map((item) => {
                    const checked = Boolean(executionDone[item.id]);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={
                          checked
                            ? 'w-full rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-left text-sm text-emerald-100 hover:bg-emerald-500/15'
                            : 'w-full rounded-xl border border-white/10 bg-white/2 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/3'
                        }
                        onClick={() => {
                          setExecutionDone((prev) => ({ ...prev, [item.id]: !prev[item.id] }));
                          prependTimeline({
                            kind: 'system',
                            title: checked ? 'Checklist desmarcado' : 'Checklist concluído',
                            subtitle: item.label,
                          });
                          pushToast(checked ? 'Item desmarcado' : 'Item concluído', checked ? 'neutral' : 'success');
                        }}
                        title={item.hint}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold">{item.label}</div>
                            {item.hint ? <div className="mt-0.5 text-[11px] text-slate-500">{item.hint}</div> : null}
                          </div>
                          <div className="shrink-0">
                            <span
                              className={
                                checked
                                  ? 'inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 ring-1 ring-emerald-500/20'
                                  : 'inline-flex items-center rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 ring-1 ring-white/10'
                              }
                            >
                              {checked ? 'Feito' : 'Pendente'}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            </div>
          </div>

          {/* Right rail */}
          <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/3">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-500/20">
                    <Bot className="h-4 w-4 text-cyan-300" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-100">NIVA CRM Pilot</div>
                    <div className="text-[11px] text-slate-500">Deal: {mock.deal.title}</div>
                  </div>
                </div>
                <Chip tone="success">Pronto</Chip>
              </div>

              <div className="flex items-center gap-4 px-4 shrink-0">
                <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>Chat IA</TabButton>
                <TabButton active={tab === 'notas'} onClick={() => setTab('notas')}>Notas</TabButton>
                <TabButton active={tab === 'scripts'} onClick={() => setTab('scripts')}>Scripts</TabButton>
                <TabButton active={tab === 'arquivos'} onClick={() => setTab('arquivos')}>Arquivos</TabButton>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden p-4">
                {tab === 'chat' ? (
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/10 bg-white/2">
                      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                          <Sparkles className="h-4 w-4" />
                          Copilot (mock)
                        </div>
                        <span className="text-[11px] text-slate-500">Sem chamadas externas</span>
                      </div>

                      <div className="min-h-0 flex-1 overflow-auto p-3">
                        <div className="space-y-2">
                          {chatMessages.map((m) => (
                            <div
                              key={m.id}
                              className={
                                m.role === 'user'
                                  ? 'ml-auto w-fit max-w-[85%] rounded-2xl bg-cyan-500/15 px-3 py-2 text-sm text-cyan-50 ring-1 ring-cyan-500/20'
                                  : m.role === 'system'
                                    ? 'mx-auto w-fit max-w-[90%] rounded-full bg-white/5 px-3 py-1.5 text-[11px] text-slate-300 ring-1 ring-white/10'
                                    : 'w-fit max-w-[85%] rounded-2xl bg-white/5 px-3 py-2 text-sm text-slate-100 ring-1 ring-white/10'
                              }
                            >
                              <div className="whitespace-pre-wrap">{m.text}</div>

                              {m.role === 'assistant' && m.text.startsWith('Mensagem WhatsApp (mock):') ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/10"
                                    onClick={() => {
                                      const msg = lastGeneratedWhatsAppMessage ?? buildWhatsAppMessage();
                                      void copyToClipboard('Mensagem WhatsApp', msg);
                                    }}
                                    title="Copiar mensagem"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                    Copiar
                                  </button>

                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20"
                                    onClick={() => {
                                      const msg = lastGeneratedWhatsAppMessage ?? buildWhatsAppMessage();
                                      openWhatsApp(msg);
                                      prependTimeline({ kind: 'system', title: 'WhatsApp aberto', subtitle: 'Mensagem pronta (mock)' });
                                      pushToast('Abrindo WhatsApp…', 'neutral');
                                    }}
                                    title="Abrir WhatsApp para enviar"
                                  >
                                    <MessageCircle className="h-3.5 w-3.5" />
                                    Abrir WhatsApp
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-wrap gap-2">
                      {mock.quickActions.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className={
                            a.tone === 'success'
                              ? 'inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20'
                              : 'inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 ring-1 ring-white/10 hover:bg-white/10'
                          }
                          onClick={() => runQuickAction(a.id)}
                        >
                          {a.icon}
                          {a.label}
                        </button>
                      ))}
                    </div>

                    <div className="shrink-0 flex items-center gap-2 rounded-xl border border-white/10 bg-white/2 p-2">
                      <input
                        value={chatDraft}
                        onChange={(e) => setChatDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSendChat();
                          }
                        }}
                        className="w-full bg-transparent px-2 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-600"
                        placeholder="Pergunte algo…"
                      />
                      <button
                        type="button"
                        className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                        onClick={handleSendChat}
                        title="Enviar (Enter)"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : tab === 'notas' ? (
                  <div className="rounded-2xl border border-white/10 bg-white/2 p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                      <StickyNote className="h-4 w-4" />
                      Notas do deal
                    </div>
                    {savedNotes.length === 0 ? (
                      <div className="mt-3 text-sm text-slate-400">Sem notas ainda. Salve uma nota no centro para ela aparecer aqui.</div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {savedNotes.map((n) => (
                          <div key={n.id} className="rounded-2xl border border-white/10 bg-white/3 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="whitespace-pre-wrap text-sm text-slate-200">{n.text}</div>
                                <div className="mt-2 text-[11px] text-slate-500">{n.at}</div>
                              </div>
                              <div className="shrink-0">
                                <button
                                  type="button"
                                  className="rounded-lg border border-white/10 bg-white/2 p-1.5 text-slate-300 hover:bg-white/5"
                                  title="Copiar nota"
                                  onClick={() => copyToClipboard('Nota', n.text)}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : tab === 'scripts' ? (
                  <div className="rounded-2xl border border-white/10 bg-white/2 p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                      <FileText className="h-4 w-4" />
                      Scripts
                    </div>
                    <div className="mt-3 text-sm text-slate-400">(mock) Argumentos, objeções, playbooks por etapa.</div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/2 p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                      <Inbox className="h-4 w-4" />
                      Arquivos
                    </div>
                    <div className="mt-3 text-sm text-slate-400">(mock) Propostas, PDFs, contratos, anexos.</div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/3 px-4 py-3 shrink-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <Settings className="h-4 w-4" />
                Cockpit
              </div>
              <button
                type="button"
                className="text-xs font-semibold text-slate-200 hover:text-slate-100"
                onClick={() => pushToast('Personalização ainda é mock 😉', 'neutral')}
              >
                Personalizar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
