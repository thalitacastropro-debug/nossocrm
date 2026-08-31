'use client';

/**
 * @fileoverview Roadmap do time — onde o colaborador pede melhoria e todo mundo
 * vê o que foi aprovado e o que já está no ar.
 *
 * Pedido da Thalita em 31/08/2026, no molde do roadmap público do SuperSchema
 * (Ideas → Prioritized → In Progress → Launched, com voto). O problema que
 * resolve é concreto: melhoria chegava por WhatsApp e sumia no scroll — o Pedro
 * pediu telefone no card, o Denilson pediu som de mensagem nova, e ninguém no
 * time tinha como saber se aquilo tinha virado alguma coisa.
 *
 * DUAS LEITURAS DIFERENTES NA MESMA TELA:
 * - colaborador: escreve, vota e ACOMPANHA. Não vê botão de etapa.
 * - admin: move de etapa e escreve a decisão.
 * O que separa os dois é a RLS (migração 20260831120000); esconder o controle
 * aqui é só não oferecer um caminho que terminaria em 403.
 *
 * Por que LISTA e não kanban de arrastar: a ordem dentro da etapa não significa
 * nada aqui (quem prioriza é a dona, olhando o voto), e arrastar em coluna com
 * 40 itens no celular é pior que um seletor. O CRM já tem kanban onde ele paga.
 */

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Loader2,
  Plus,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  ROADMAP_ORDEM,
  ROADMAP_STATUS_LABEL,
  type RoadmapItem,
  type RoadmapStatus,
} from '@/lib/roadmap/types';

const DATA_CURTA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

/** Cor por etapa. "Feito" em verde e "não vai ser feito" em cinza — não vermelho:
 *  recusar com motivo é uma resposta, não um erro de quem sugeriu. */
const COR_ETAPA: Record<RoadmapStatus, string> = {
  sugerido: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300',
  aprovado: 'bg-primary-500/10 text-primary-700 dark:text-primary-300',
  em_andamento: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  feito: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  recusado: 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-500',
};

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((corpo as { error?: string }).error || 'Algo deu errado.');
  return corpo as T;
}

export default function RoadmapPage() {
  const { profile } = useAuth();
  const ehAdmin = profile?.role === 'admin';
  const qc = useQueryClient();

  const [abrirForm, setAbrirForm] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [area, setArea] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  // "Feito" e "não vai ser feito" nascem fechados: o time entra aqui para ver o
  // que está vivo. O histórico importa, mas não é a primeira pergunta.
  const [fechadas, setFechadas] = useState<Set<RoadmapStatus>>(new Set(['feito', 'recusado']));

  const { data, isLoading } = useQuery({
    queryKey: ['roadmap'],
    queryFn: () => pedir<{ itens: RoadmapItem[] }>('/api/roadmap'),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['roadmap'] });

  const sugerir = useMutation({
    mutationFn: () =>
      pedir('/api/roadmap', {
        method: 'POST',
        body: JSON.stringify({ title: titulo, area: area || undefined, description: descricao || undefined }),
      }),
    onSuccess: () => {
      setTitulo('');
      setArea('');
      setDescricao('');
      setAbrirForm(false);
      setErro(null);
      invalidar();
    },
    onError: (e: Error) => setErro(e.message),
  });

  const votar = useMutation({
    mutationFn: ({ id, votei }: { id: string; votei: boolean }) =>
      pedir(`/api/roadmap/${id}/vote`, { method: votei ? 'DELETE' : 'POST' }),
    onSuccess: invalidar,
    onError: (e: Error) => setErro(e.message),
  });

  const mover = useMutation({
    mutationFn: ({ id, status, decisao }: { id: string; status: RoadmapStatus; decisao?: string }) =>
      pedir(`/api/roadmap/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(decisao === undefined ? { status } : { status, decisao }),
      }),
    onSuccess: () => {
      setErro(null);
      invalidar();
    },
    onError: (e: Error) => setErro(e.message),
  });

  const apagar = useMutation({
    mutationFn: (id: string) => pedir(`/api/roadmap/${id}`, { method: 'DELETE' }),
    onSuccess: invalidar,
    onError: (e: Error) => setErro(e.message),
  });

  /** Agrupa por etapa e ordena por voto (mais pedido primeiro), depois pelo mais novo. */
  const porEtapa = useMemo(() => {
    const mapa = new Map<RoadmapStatus, RoadmapItem[]>();
    for (const etapa of ROADMAP_ORDEM) mapa.set(etapa, []);
    for (const item of data?.itens ?? []) mapa.get(item.status)?.push(item);
    for (const lista of mapa.values()) {
      lista.sort((a, b) => b.votos - a.votos || b.criadoEm.localeCompare(a.criadoEm));
    }
    return mapa;
  }, [data]);

  const alternarEtapa = (etapa: RoadmapStatus) =>
    setFechadas((atual) => {
      const nova = new Set(atual);
      if (nova.has(etapa)) nova.delete(etapa);
      else nova.add(etapa);
      return nova;
    });

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold font-display text-slate-900 dark:text-white">
          Roadmap do time
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Sentiu falta de alguma coisa no dia a dia? Escreve aqui. Vote no que os outros
          pediram — é assim que a gente sabe o que dói em mais de uma pessoa.
          {!ehAdmin && ' Quem aprova é a administração.'}
        </p>
      </header>

      {erro && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200"
        >
          {erro}
        </div>
      )}

      {/* -------------------------------------------------- sugerir melhoria */}
      {abrirForm ? (
        <form
          className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!titulo.trim()) return;
            sugerir.mutate();
          }}
        >
          <input
            autoFocus
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={140}
            placeholder="O que você quer que melhore? (ex.: ver o histórico do cliente no card)"
            className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus-visible-ring"
          />
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            maxLength={40}
            placeholder="Onde dói? (ex.: card, Ana, relatórios) — opcional"
            className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus-visible-ring"
          />
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Conta um caso real em que isso te atrapalhou. É o que faz a ideia ser priorizada."
            className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus-visible-ring"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!titulo.trim() || sugerir.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 focus-visible-ring"
            >
              {sugerir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Enviar sugestão
            </button>
            <button
              type="button"
              onClick={() => {
                setAbrirForm(false);
                setErro(null);
              }}
              className="rounded-lg px-3 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 focus-visible-ring"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAbrirForm(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible-ring"
        >
          <Plus className="h-4 w-4" />
          Sugerir melhoria
        </button>
      )}

      {/* --------------------------------------------------------- as etapas */}
      {isLoading ? (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : (
        <div className="space-y-6">
          {ROADMAP_ORDEM.map((etapa) => {
            const itens = porEtapa.get(etapa) ?? [];
            const fechada = fechadas.has(etapa);
            const rotulo = ROADMAP_STATUS_LABEL[etapa];

            // Etapa vazia só aparece se estiver "viva": um "Não vai ser feito"
            // vazio é ruído; um "Sugerido" vazio é convite.
            if (itens.length === 0 && (etapa === 'feito' || etapa === 'recusado')) return null;

            return (
              <section key={etapa}>
                <button
                  onClick={() => alternarEtapa(etapa)}
                  aria-expanded={!fechada}
                  className="w-full flex items-center gap-2 py-2 text-left focus-visible-ring rounded-lg"
                >
                  {fechada ? (
                    <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  )}
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COR_ETAPA[etapa]}`}>
                    {rotulo.titulo}
                  </span>
                  <span className="text-xs text-slate-400">{itens.length}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-500 hidden sm:inline">
                    · {rotulo.ajuda}
                  </span>
                </button>

                {!fechada && (
                  <div className="space-y-3 pl-6">
                    {itens.length === 0 ? (
                      <p className="text-sm text-slate-400 py-2">
                        Nada por aqui ainda. Comece pelo botão &ldquo;Sugerir melhoria&rdquo;.
                      </p>
                    ) : (
                      itens.map((item) => (
                        <ItemDoRoadmap
                          key={item.id}
                          item={item}
                          ehAdmin={ehAdmin}
                          onVotar={() => votar.mutate({ id: item.id, votei: item.votei })}
                          onMover={(status, decisao) => mover.mutate({ id: item.id, status, decisao })}
                          onApagar={() => apagar.mutate(item.id)}
                        />
                      ))
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ItemDoRoadmap({
  item,
  ehAdmin,
  onVotar,
  onMover,
  onApagar,
}: {
  item: RoadmapItem;
  ehAdmin: boolean;
  onVotar: () => void;
  onMover: (status: RoadmapStatus, decisao?: string) => void;
  onApagar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  // Recusa exige motivo (a rota barra sem ele) — então o campo aparece ANTES
  // de recusar, e não como um erro depois do clique.
  const [motivo, setMotivo] = useState(item.decisao ?? '');
  const [pedindoMotivo, setPedindoMotivo] = useState(false);

  return (
    <article className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-4">
      <div className="flex items-start gap-3">
        <button
          onClick={onVotar}
          aria-pressed={item.votei}
          aria-label={item.votei ? 'Tirar meu voto' : 'Votar nesta melhoria'}
          className={`shrink-0 flex flex-col items-center justify-center w-12 rounded-lg border px-2 py-1.5 transition-colors focus-visible-ring ${
            item.votei
              ? 'border-primary-300 dark:border-primary-800 bg-primary-500/10 text-primary-600 dark:text-primary-400'
              : 'border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5'
          }`}
        >
          <ThumbsUp className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold tabular-nums">{item.votos}</span>
        </button>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</h3>

          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {item.area && (
              <>
                <span className="rounded bg-slate-100 dark:bg-white/10 px-1.5 py-0.5">{item.area}</span>
                {' · '}
              </>
            )}
            {item.souOAutor ? 'Você' : item.autor} · {DATA_CURTA.format(new Date(item.criadoEm))}
            {item.decididoPor && ` · decidido por ${item.decididoPor}`}
          </p>

          {item.decisao && (
            <p className="mt-2 rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
              <span className="font-semibold">Decisão:</span> {item.decisao}
            </p>
          )}

          {item.description && (
            <>
              <button
                onClick={() => setAberto((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 focus-visible-ring rounded"
              >
                <Lightbulb className="h-3 w-3" aria-hidden="true" />
                {aberto ? 'esconder detalhe' : 'ver detalhe'}
              </button>
              {aberto && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                  {item.description}
                </p>
              )}
            </>
          )}

          {ehAdmin && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-white/5 pt-3">
              <label className="text-xs text-slate-500" htmlFor={`etapa-${item.id}`}>
                Etapa
              </label>
              <select
                id={`etapa-${item.id}`}
                value={item.status}
                onChange={(e) => {
                  const novo = e.target.value as RoadmapStatus;
                  if (novo === 'recusado' && !motivo.trim()) {
                    setPedindoMotivo(true);
                    return;
                  }
                  setPedindoMotivo(false);
                  onMover(novo, motivo.trim() || undefined);
                }}
                className="rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1 text-xs text-slate-800 dark:text-slate-200 focus-visible-ring"
              >
                {ROADMAP_ORDEM.map((s) => (
                  <option key={s} value={s}>
                    {ROADMAP_STATUS_LABEL[s].titulo}
                  </option>
                ))}
              </select>

              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                onBlur={() => {
                  if (motivo.trim() !== (item.decisao ?? '')) onMover(item.status, motivo.trim());
                }}
                maxLength={1000}
                placeholder={pedindoMotivo ? 'Escreva o motivo para poder recusar' : 'Decisão / motivo (opcional)'}
                className={`min-w-0 flex-1 rounded-lg border bg-transparent px-2 py-1 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus-visible-ring ${
                  pedindoMotivo
                    ? 'border-amber-400 dark:border-amber-500/50'
                    : 'border-slate-200 dark:border-white/10'
                }`}
              />

              <button
                onClick={onApagar}
                aria-label="Apagar item"
                className="rounded-lg p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 focus-visible-ring"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
