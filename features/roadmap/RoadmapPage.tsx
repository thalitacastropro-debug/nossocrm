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
 * VIROU KANBAN em 01/09/2026, a pedido dela. A leitura que o kanban compra é a
 * que a lista não dava — quanta coisa está parada em cada etapa, lado a lado.
 * O que ele NÃO muda são as duas travas:
 *
 *   1. Só admin move de etapa. Quem barra é a RLS (`roadmap_items_update_admin`,
 *      migração 20260831120000), não este arquivo: para o colaborador o card
 *      simplesmente não é arrastável, e se ele forjar o PATCH a rota devolve
 *      403 porque o update volta com 0 linhas.
 *   2. Recusar exige motivo. Soltar um card em "Não vai ser feito" NÃO move
 *      nada: abre o campo de motivo naquele card. A regra continua também no
 *      servidor (`app/api/roadmap/[itemId]/route.ts`) — a tela só evita que o
 *      admin descubra a regra levando um erro depois do gesto.
 *
 * DUAS LEITURAS DIFERENTES NA MESMA TELA:
 * - colaborador: escreve, vota e ACOMPANHA. Card fixo, sem controle de etapa.
 * - admin: arrasta entre colunas e escreve a decisão.
 *
 * POR QUE O SELETOR DE ETAPA CONTINUA NO CARD, mesmo com o arrastar: arrastar
 * do HTML5 não existe no touch (o Denilson e o Pedro abrem isso no celular) e
 * não existe no teclado. O seletor é o caminho acessível; o arrastar é o atalho
 * de quem está no desktop. Tirar o seletor deixaria a tela sem saída nos dois
 * casos.
 *
 * A ordem DENTRO da coluna continua sendo por voto (a dona prioriza olhando o
 * voto), então soltar um card no meio de uma coluna não reordena nada — só
 * muda de etapa. É de propósito: posição arrastada seria uma segunda prioridade
 * competindo com o voto, e ninguém saberia qual das duas vale.
 */

import React, { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Loader2, Plus, ThumbsUp, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  ROADMAP_ORDEM,
  ROADMAP_STATUS_LABEL,
  type RoadmapItem,
  type RoadmapStatus,
} from '@/lib/roadmap/types';

const DATA_CURTA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

/** Chave do dataTransfer, própria desta tela para não colidir com o arrastar
 *  dos funis (que usa 'dealId'). Minúscula de propósito: o navegador normaliza
 *  o nome do formato para minúsculas no setData e devolve assim no getData, e
 *  os DOMs de teste não fazem a mesma normalização — com o nome já minúsculo a
 *  chave é a mesma nos dois lados. */
const ARRASTA_ITEM = 'roadmapitemid';

/** Cor por etapa. "Feito" em verde e "não vai ser feito" em cinza — não vermelho:
 *  recusar com motivo é uma resposta, não um erro de quem sugeriu. */
const COR_ETAPA: Record<RoadmapStatus, string> = {
  sugerido: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300',
  aprovado: 'bg-primary-500/10 text-primary-700 dark:text-primary-300',
  em_andamento: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  feito: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  recusado: 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-500',
};

/** Faixa no topo da coluna — é o que dá o "de relance" que a lista não tinha. */
const FAIXA_ETAPA: Record<RoadmapStatus, string> = {
  sugerido: 'bg-slate-300 dark:bg-white/20',
  aprovado: 'bg-primary-500',
  em_andamento: 'bg-amber-400',
  feito: 'bg-emerald-500',
  recusado: 'bg-slate-200 dark:bg-white/10',
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
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [colunaAlvo, setColunaAlvo] = useState<RoadmapStatus | null>(null);
  /** Item que foi solto em "Não vai ser feito" e está esperando o motivo. Mora
   *  aqui e não no card porque quem descobre a falta do motivo é a coluna. */
  const [recusaPendente, setRecusaPendente] = useState<string | null>(null);

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
      setRecusaPendente(null);
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

  const porId = useMemo(() => {
    const mapa = new Map<string, RoadmapItem>();
    for (const item of data?.itens ?? []) mapa.set(item.id, item);
    return mapa;
  }, [data]);

  /**
   * Soltou um card numa coluna. Três desfechos, e só um deles escreve:
   * - mesma etapa → não faz nada (evita PATCH à toa e "salvo" sem mudança);
   * - "Não vai ser feito" sem motivo escrito → NÃO move, pede o motivo;
   * - o resto → move.
   */
  const soltarNaColuna = (destino: RoadmapStatus, e: React.DragEvent) => {
    e.preventDefault();
    setColunaAlvo(null);
    setArrastando(null);

    const id = e.dataTransfer.getData(ARRASTA_ITEM);
    const item = id ? porId.get(id) : undefined;
    if (!item || item.status === destino) return;

    if (destino === 'recusado' && !item.decisao?.trim()) {
      setRecusaPendente(id);
      setErro('Escreva o motivo antes de recusar — quem sugeriu precisa entender a decisão.');
      return;
    }

    mover.mutate({ id, status: destino });
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold font-display text-slate-900 dark:text-white">
          Roadmap do time
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Sentiu falta de alguma coisa no dia a dia? Escreve aqui. Vote no que os outros
          pediram — é assim que a gente sabe o que dói em mais de uma pessoa.
          {ehAdmin
            ? ' Arraste o card entre as colunas para mudar a etapa.'
            : ' Quem aprova é a administração.'}
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
          className="max-w-2xl space-y-3 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-4"
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
          className="inline-flex w-fit items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible-ring"
        >
          <Plus className="h-4 w-4" />
          Sugerir melhoria
        </button>
      )}

      {/* ------------------------------------------------------- as colunas */}
      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : (
        <div
          role="list"
          aria-label="Etapas do roadmap"
          className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2"
        >
          {ROADMAP_ORDEM.map((etapa) => (
            <ColunaDoRoadmap
              key={etapa}
              etapa={etapa}
              itens={porEtapa.get(etapa) ?? []}
              ehAdmin={ehAdmin}
              destacada={colunaAlvo === etapa && arrastando !== null}
              arrastando={arrastando}
              recusaPendente={recusaPendente}
              onDragOver={(e) => {
                if (!ehAdmin) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setColunaAlvo(etapa);
              }}
              onDragLeave={() => setColunaAlvo((atual) => (atual === etapa ? null : atual))}
              onDrop={(e) => soltarNaColuna(etapa, e)}
              onArrastarCard={(id) => setArrastando(id)}
              onSoltarCard={() => {
                setArrastando(null);
                setColunaAlvo(null);
              }}
              onVotar={(item) => votar.mutate({ id: item.id, votei: item.votei })}
              onMover={(id, status, decisao) => mover.mutate({ id, status, decisao })}
              onApagar={(id) => apagar.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ColunaDoRoadmap({
  etapa,
  itens,
  ehAdmin,
  destacada,
  arrastando,
  recusaPendente,
  onDragOver,
  onDragLeave,
  onDrop,
  onArrastarCard,
  onSoltarCard,
  onVotar,
  onMover,
  onApagar,
}: {
  etapa: RoadmapStatus;
  itens: RoadmapItem[];
  ehAdmin: boolean;
  destacada: boolean;
  arrastando: string | null;
  recusaPendente: string | null;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onArrastarCard: (id: string) => void;
  onSoltarCard: () => void;
  onVotar: (item: RoadmapItem) => void;
  onMover: (id: string, status: RoadmapStatus, decisao?: string) => void;
  onApagar: (id: string) => void;
}) {
  const rotulo = ROADMAP_STATUS_LABEL[etapa];

  return (
    <section
      role="listitem"
      aria-label={`Coluna ${rotulo.titulo}: ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex min-w-[17rem] flex-1 flex-col overflow-hidden rounded-xl border-2 transition-all duration-200 ${
        destacada
          ? 'border-primary-400 dark:border-primary-500 bg-primary-500/5 scale-[1.01]'
          : 'border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]'
      }`}
    >
      <div className={`h-1.5 w-full ${FAIXA_ETAPA[etapa]}`} aria-hidden="true" />

      <div className="shrink-0 border-b border-slate-200 dark:border-white/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COR_ETAPA[etapa]}`}>
            {rotulo.titulo}
          </span>
          <span className="text-xs tabular-nums text-slate-400">{itens.length}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">{rotulo.ajuda}</p>
      </div>

      <div className="min-h-[6rem] flex-1 space-y-3 overflow-y-auto p-3">
        {itens.length === 0 ? (
          <p className="py-2 text-xs text-slate-400">
            {etapa === 'sugerido'
              ? 'Nada por aqui ainda — comece pelo botão de sugerir melhoria.'
              : 'Vazio.'}
          </p>
        ) : (
          itens.map((item) => (
            <CartaoDoRoadmap
              key={item.id}
              item={item}
              ehAdmin={ehAdmin}
              sendoArrastado={arrastando === item.id}
              pedindoMotivo={recusaPendente === item.id}
              onArrastar={() => onArrastarCard(item.id)}
              onSoltar={onSoltarCard}
              onVotar={() => onVotar(item)}
              onMover={(status, decisao) => onMover(item.id, status, decisao)}
              onApagar={() => onApagar(item.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function CartaoDoRoadmap({
  item,
  ehAdmin,
  sendoArrastado,
  pedindoMotivo,
  onArrastar,
  onSoltar,
  onVotar,
  onMover,
  onApagar,
}: {
  item: RoadmapItem;
  ehAdmin: boolean;
  sendoArrastado: boolean;
  pedindoMotivo: boolean;
  onArrastar: () => void;
  onSoltar: () => void;
  onVotar: () => void;
  onMover: (status: RoadmapStatus, decisao?: string) => void;
  onApagar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState(item.decisao ?? '');
  // Faltou motivo: ou porque soltou em "Não vai ser feito" (a coluna avisa), ou
  // porque escolheu "Não vai ser feito" no seletor com o campo vazio.
  const [faltaMotivo, setFaltaMotivo] = useState(false);
  const campoMotivo = useRef<HTMLInputElement>(null);

  const cobrando = pedindoMotivo || faltaMotivo;

  React.useEffect(() => {
    if (pedindoMotivo) campoMotivo.current?.focus();
  }, [pedindoMotivo]);

  return (
    <article
      draggable={ehAdmin}
      onDragStart={(e) => {
        e.dataTransfer.setData(ARRASTA_ITEM, item.id);
        e.dataTransfer.effectAllowed = 'move';
        onArrastar();
      }}
      onDragEnd={onSoltar}
      className={`rounded-xl border bg-white p-3 dark:bg-dark-card ${
        cobrando ? 'border-amber-400 dark:border-amber-500/50' : 'border-slate-200 dark:border-white/10'
      } ${ehAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${sendoArrastado ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <button
          onClick={onVotar}
          aria-pressed={item.votei}
          aria-label={item.votei ? 'Tirar meu voto' : 'Votar nesta melhoria'}
          className={`flex w-10 shrink-0 flex-col items-center justify-center rounded-lg border px-2 py-1.5 transition-colors focus-visible-ring ${
            item.votei
              ? 'border-primary-300 dark:border-primary-800 bg-primary-500/10 text-primary-600 dark:text-primary-400'
              : 'border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5'
          }`}
        >
          <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
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
          </p>

          {item.decisao && (
            <p className="mt-2 rounded-lg bg-slate-50 dark:bg-white/5 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300">
              <span className="font-semibold">Decisão:</span> {item.decisao}
              {item.decididoPor && <span className="text-slate-500"> — {item.decididoPor}</span>}
            </p>
          )}

          {item.description && (
            <>
              <button
                onClick={() => setAberto((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 rounded text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 focus-visible-ring"
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
        </div>
      </div>

      {/* O seletor é o caminho de quem está no celular ou no teclado — o
          arrastar é atalho de desktop, não substituto. */}
      {ehAdmin && (
        <div className="mt-3 space-y-2 border-t border-slate-100 dark:border-white/5 pt-2.5">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`etapa-${item.id}`}>
              Etapa de {item.title}
            </label>
            <select
              id={`etapa-${item.id}`}
              value={item.status}
              onChange={(e) => {
                const novo = e.target.value as RoadmapStatus;
                if (novo === 'recusado' && !motivo.trim()) {
                  setFaltaMotivo(true);
                  campoMotivo.current?.focus();
                  return;
                }
                setFaltaMotivo(false);
                onMover(novo, motivo.trim() || undefined);
              }}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 dark:border-white/10 bg-transparent px-2 py-1 text-xs text-slate-800 dark:text-slate-200 focus-visible-ring"
            >
              {ROADMAP_ORDEM.map((s) => (
                <option key={s} value={s}>
                  {ROADMAP_STATUS_LABEL[s].titulo}
                </option>
              ))}
            </select>

            <button
              onClick={onApagar}
              aria-label={`Apagar ${item.title}`}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 focus-visible-ring"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <input
            ref={campoMotivo}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            onBlur={() => {
              if (motivo.trim() !== (item.decisao ?? '')) onMover(item.status, motivo.trim());
            }}
            maxLength={1000}
            aria-label={`Decisão sobre ${item.title}`}
            placeholder={cobrando ? 'Escreva o motivo para poder recusar' : 'Decisão / motivo (opcional)'}
            className={`w-full min-w-0 rounded-lg border bg-transparent px-2 py-1 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus-visible-ring ${
              cobrando
                ? 'border-amber-400 dark:border-amber-500/50'
                : 'border-slate-200 dark:border-white/10'
            }`}
          />

          {/* Só aparece quando o motivo já foi escrito: fecha o gesto que o
              arrastar deixou pela metade, sem obrigar a mexer no seletor. */}
          {cobrando && motivo.trim() && (
            <button
              onClick={() => {
                setFaltaMotivo(false);
                onMover('recusado', motivo.trim());
              }}
              className="w-full rounded-lg bg-slate-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/20 focus-visible-ring"
            >
              Recusar com este motivo
            </button>
          )}
        </div>
      )}
    </article>
  );
}
