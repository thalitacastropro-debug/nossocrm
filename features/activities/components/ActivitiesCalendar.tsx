import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Phone, Users, Mail, CheckSquare, X, Pencil, Clock, Briefcase } from 'lucide-react';
import { Activity, Deal } from '@/types';

interface ActivitiesCalendarProps {
    activities: Activity[];
    deals: Deal[];
    currentDate: Date;
    setCurrentDate: (date: Date) => void;
    /** Abre a atividade para edição (o detalhe tem o botão "Editar"). */
    onEdit?: (activity: Activity) => void;
}

/** Faixa visível do dia. Fora dela nada é agendado na operação. */
const HORA_INICIO = 7;
const HORA_FIM = 19;
/** Altura de uma hora, em px. Define a escala de tudo no grid. */
const ALTURA_HORA = 56;
/** Duração assumida — `activities` não tem campo de duração. */
const DURACAO_PADRAO_MIN = 45;

const DIAS_DA_SEMANA = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];

/**
 * Tipos que são COMPROMISSO — os únicos que fazem sentido num calendário.
 *
 * `NOTE` e `STATUS_CHANGE` são registro de histórico, não hora marcada: são 46 das
 * 62 atividades da base em 24/08/2026. Como o switch de cor só tratava os quatro
 * tipos abaixo, esses dois caíam sem cor nenhuma e apareciam como caixas vazias de
 * contorno cinza — o "calendário bugado" que a Thalita via. Eles continuam na
 * aba de lista e na timeline do card, que é onde histórico se lê.
 */
const TIPOS_DE_COMPROMISSO = new Set<Activity['type']>(['CALL', 'MEETING', 'EMAIL', 'TASK']);

const ESTILO_POR_TIPO: Record<string, { faixa: string; fundo: string; texto: string; hora: string }> = {
    CALL: {
        faixa: 'bg-sky-400',
        fundo: 'bg-sky-50 hover:bg-sky-100 dark:bg-sky-500/10 dark:hover:bg-sky-500/20',
        texto: 'text-sky-900 dark:text-sky-100',
        hora: 'text-sky-700/70 dark:text-sky-200/70',
    },
    MEETING: {
        faixa: 'bg-violet-400',
        fundo: 'bg-violet-50 hover:bg-violet-100 dark:bg-violet-500/10 dark:hover:bg-violet-500/20',
        texto: 'text-violet-900 dark:text-violet-100',
        hora: 'text-violet-700/70 dark:text-violet-200/70',
    },
    EMAIL: {
        faixa: 'bg-amber-400',
        fundo: 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20',
        texto: 'text-amber-900 dark:text-amber-100',
        hora: 'text-amber-700/70 dark:text-amber-200/70',
    },
    TASK: {
        faixa: 'bg-emerald-400',
        fundo: 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20',
        texto: 'text-emerald-900 dark:text-emerald-100',
        hora: 'text-emerald-700/70 dark:text-emerald-200/70',
    },
};

const ROTULO_TIPO: Record<string, string> = {
    CALL: 'Ligação',
    MEETING: 'Reunião',
    EMAIL: 'E-mail',
    TASK: 'Tarefa',
    NOTE: 'Nota',
    STATUS_CHANGE: 'Mudança de etapa',
};

const iconePorTipo = (type: Activity['type'], size = 13) => {
    switch (type) {
        case 'CALL': return <Phone size={size} />;
        case 'MEETING': return <Users size={size} />;
        case 'EMAIL': return <Mail size={size} />;
        default: return <CheckSquare size={size} />;
    }
};

const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Com quem é o compromisso.
 *
 * O título costuma ser o tipo do compromisso ("Ligação diagnóstica"), igual em
 * todos os cards — inútil para bater o olho na semana. Quem identifica é o lead,
 * e o nome dele vem do negócio. Os cards nascem como "Fulano — Lead Meta Ads":
 * a origem é ruído aqui, então fica só o nome.
 */
function nomeDoLead(activity: Activity, dealTitleById: Map<string, string>): string {
    const doDeal = (activity.dealId ? dealTitleById.get(activity.dealId) : '') || activity.dealTitle || '';
    const limpo = doDeal.split('—')[0].trim();
    return limpo || activity.title;
}

/** Um compromisso já posicionado na coluna do dia. */
interface Posicionado {
    activity: Activity;
    inicio: Date;
    fim: Date;
    topo: number;
    altura: number;
    /** Fatia horizontal, para compromissos que se sobrepõem. */
    coluna: number;
    colunas: number;
}

/**
 * Distribui os compromissos de um dia em colunas quando eles se sobrepõem —
 * é o que evita um evento cobrir o outro e mantém os dois legíveis.
 */
function posicionarDia(doDia: Activity[]): Posicionado[] {
    const eventos = doDia
        .map((activity) => {
            const inicio = new Date(activity.date);
            const fim = new Date(inicio.getTime() + DURACAO_PADRAO_MIN * 60_000);
            const minutosDoInicio = (inicio.getHours() - HORA_INICIO) * 60 + inicio.getMinutes();
            const topo = (minutosDoInicio / 60) * ALTURA_HORA;
            const altura = (DURACAO_PADRAO_MIN / 60) * ALTURA_HORA;
            return { activity, inicio, fim, topo, altura, coluna: 0, colunas: 1 };
        })
        .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

    // Grupo = corrente de eventos que se tocam. Todos dividem a largura entre si.
    let grupo: Posicionado[] = [];
    let fimDoGrupo = -Infinity;

    const fecharGrupo = () => {
        grupo.forEach((e, i) => {
            e.coluna = i;
            e.colunas = grupo.length;
        });
        grupo = [];
    };

    for (const evento of eventos) {
        if (grupo.length > 0 && evento.inicio.getTime() >= fimDoGrupo) {
            fecharGrupo();
            fimDoGrupo = -Infinity;
        }
        grupo.push(evento);
        fimDoGrupo = Math.max(fimDoGrupo, evento.fim.getTime());
    }
    fecharGrupo();

    return eventos;
}

/**
 * Agenda semanal.
 *
 * Reescrita em 24/08/2026 a pedido da Thalita ("quero clean e organizado; hoje
 * fica gigantesco e vai puxando a tela pra baixo"). O que era e o que virou:
 * - cada evento carregava um bloco de "detalhes no hover" que ficava SEMPRE no
 *   DOM (só com `opacity-0`) — ocupava altura com a descrição inteira mesmo sem
 *   ninguém passar o mouse. Agora o detalhe abre ao CLICAR, num painel próprio.
 * - gradientes, sombras coloridas, `border-2`, `hover:scale-105` e ícone em caixa
 *   deram lugar a bloco pastel com uma faixa de cor à esquerda.
 * - o evento agora ocupa a FAIXA DE HORÁRIO dele (posição por minuto), em vez de
 *   empilhar dentro da célula da hora e esticar a linha.
 */
export const ActivitiesCalendar: React.FC<ActivitiesCalendarProps> = ({
    activities,
    deals,
    currentDate,
    setCurrentDate,
    onEdit,
}) => {
    const [selecionada, setSelecionada] = useState<Activity | null>(null);

    const inicioDaSemana = useMemo(() => {
        const d = new Date(currentDate);
        d.setDate(d.getDate() - d.getDay());
        d.setHours(0, 0, 0, 0);
        return d;
    }, [currentDate]);

    const diasDaSemana = useMemo(
        () =>
            Array.from({ length: 7 }, (_, i) => {
                const date = new Date(inicioDaSemana);
                date.setDate(inicioDaSemana.getDate() + i);
                return date;
            }),
        [inicioDaSemana],
    );

    const horas = useMemo(
        () => Array.from({ length: HORA_FIM - HORA_INICIO + 1 }, (_, i) => HORA_INICIO + i),
        [],
    );

    const tituloDaSemana = useMemo(() => {
        const fim = diasDaSemana[6];
        const mesInicio = inicioDaSemana.toLocaleDateString('pt-BR', { month: 'long' });
        const mesFim = fim.toLocaleDateString('pt-BR', { month: 'long' });
        const ano = fim.getFullYear();
        if (mesInicio === mesFim) {
            return `${inicioDaSemana.getDate()}–${fim.getDate()} de ${mesInicio} ${ano}`;
        }
        return `${inicioDaSemana.getDate()} de ${mesInicio} – ${fim.getDate()} de ${mesFim} ${ano}`;
    }, [inicioDaSemana, diasDaSemana]);

    const dealTitleById = useMemo(() => {
        const map = new Map<string, string>();
        for (const d of deals) map.set(d.id, d.title);
        return map;
    }, [deals]);

    /** Compromissos posicionados, por dia da semana. */
    const porDia = useMemo(() => {
        const mapa = new Map<string, Posicionado[]>();
        const compromissos = activities.filter((a) => {
            if (!TIPOS_DE_COMPROMISSO.has(a.type)) return false;
            const d = new Date(a.date);
            if (Number.isNaN(d.getTime())) return false;
            return d.getHours() >= HORA_INICIO && d.getHours() <= HORA_FIM;
        });

        for (const dia of diasDaSemana) {
            const chave = dia.toDateString();
            const doDia = compromissos.filter((a) => new Date(a.date).toDateString() === chave);
            mapa.set(chave, posicionarDia(doDia));
        }
        return mapa;
    }, [activities, diasDaSemana]);

    /** Quantos registros de histórico existem na semana — só para não sumirem em silêncio. */
    const registrosDeHistorico = useMemo(
        () =>
            activities.filter((a) => {
                if (TIPOS_DE_COMPROMISSO.has(a.type)) return false;
                const d = new Date(a.date);
                return d >= inicioDaSemana && d < new Date(inicioDaSemana.getTime() + 7 * 86_400_000);
            }).length,
        [activities, inicioDaSemana],
    );

    const ehHoje = (date: Date) => date.toDateString() === new Date().toDateString();

    const mover = (dias: number) => {
        const nova = new Date(currentDate);
        nova.setDate(nova.getDate() + dias);
        setCurrentDate(nova);
    };

    return (
        <div className="bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
            {/* Cabeçalho */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex flex-wrap gap-3 justify-between items-center">
                <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        {tituloDaSemana}
                    </h2>
                    {registrosDeHistorico > 0 && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                            {registrosDeHistorico} {registrosDeHistorico === 1 ? 'registro' : 'registros'} de
                            histórico nesta semana — veja na lista
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={() => mover(-7)}
                        aria-label="Semana anterior"
                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <button
                        onClick={() => setCurrentDate(new Date())}
                        className="px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                    >
                        Hoje
                    </button>
                    <button
                        onClick={() => mover(7)}
                        aria-label="Próxima semana"
                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>

            <div className="overflow-auto max-h-[70vh]">
                <div className="min-w-[840px]">
                    {/* Faixa dos dias */}
                    <div className="grid grid-cols-[56px_repeat(7,1fr)] sticky top-0 z-20 bg-white dark:bg-dark-card border-b border-slate-200 dark:border-white/10">
                        <div />
                        {diasDaSemana.map((date) => (
                            <div
                                key={date.toISOString()}
                                className={`py-2.5 text-center border-l border-slate-100 dark:border-white/5 ${ehHoje(date) ? 'bg-primary-50/60 dark:bg-primary-500/10' : ''}`}
                            >
                                <div className="text-[10px] font-medium tracking-wide text-slate-400 dark:text-slate-500">
                                    {DIAS_DA_SEMANA[date.getDay()]}
                                </div>
                                <div
                                    className={`text-lg font-semibold leading-tight ${ehHoje(date) ? 'text-primary-600 dark:text-primary-400' : 'text-slate-700 dark:text-slate-200'}`}
                                >
                                    {date.getDate()}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Grade */}
                    <div className="grid grid-cols-[56px_repeat(7,1fr)]">
                        {/* Coluna das horas */}
                        <div>
                            {horas.map((hora) => (
                                <div
                                    key={hora}
                                    style={{ height: ALTURA_HORA }}
                                    className="relative text-[11px] text-slate-400 dark:text-slate-500 text-right pr-2"
                                >
                                    <span className="absolute -top-1.5 right-2">
                                        {String(hora).padStart(2, '0')}:00
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Uma coluna por dia */}
                        {diasDaSemana.map((date) => {
                            const posicionados = porDia.get(date.toDateString()) ?? [];
                            return (
                                <div
                                    key={date.toISOString()}
                                    className={`relative border-l border-slate-100 dark:border-white/5 ${ehHoje(date) ? 'bg-primary-50/30 dark:bg-primary-500/5' : ''}`}
                                >
                                    {/* Linhas de hora */}
                                    {horas.map((hora) => (
                                        <div
                                            key={hora}
                                            style={{ height: ALTURA_HORA }}
                                            className="border-b border-slate-100 dark:border-white/5"
                                        />
                                    ))}

                                    {posicionados.map(({ activity, inicio, topo, altura, coluna, colunas }) => {
                                        const estilo = ESTILO_POR_TIPO[activity.type] ?? ESTILO_POR_TIPO.TASK;
                                        const largura = 100 / colunas;
                                        const atrasada = !activity.completed && inicio < new Date();
                                        const comQuem = nomeDoLead(activity, dealTitleById);

                                        return (
                                            <button
                                                key={activity.id}
                                                type="button"
                                                onClick={() => setSelecionada(activity)}
                                                style={{
                                                    top: topo,
                                                    height: Math.max(altura, 26),
                                                    left: `calc(${coluna * largura}% + 3px)`,
                                                    width: `calc(${largura}% - 6px)`,
                                                }}
                                                className={`absolute overflow-hidden rounded-md pl-2 pr-1.5 py-1 text-left transition-colors ${estilo.fundo} ${activity.completed ? 'opacity-60' : ''}`}
                                                title={`${comQuem} — ${activity.title} · ${hhmm(inicio)}`}
                                            >
                                                <span
                                                    className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-md ${atrasada ? 'bg-red-400' : estilo.faixa}`}
                                                    aria-hidden="true"
                                                />
                                                {/* COM QUEM primeiro: "Ligação diagnóstica" é igual em todos os
                                                    cards e não diz nada de relance; o nome do lead diz. */}
                                                <span
                                                    className={`block text-[11px] font-medium leading-tight truncate ${estilo.texto} ${activity.completed ? 'line-through' : ''}`}
                                                >
                                                    {comQuem}
                                                </span>
                                                <span className={`block text-[10px] leading-tight truncate ${estilo.hora}`}>
                                                    {hhmm(inicio)} · {activity.title}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Detalhe do compromisso — o que antes tentava caber dentro do bloco */}
            {selecionada && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setSelecionada(null);
                    }}
                >
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/10 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">
                                    {iconePorTipo(selecionada.type)}
                                    {ROTULO_TIPO[selecionada.type] ?? selecionada.type}
                                    {selecionada.completed && (
                                        <span className="text-emerald-600 dark:text-emerald-400">· concluída</span>
                                    )}
                                </div>
                                <h3 className="text-base font-semibold text-slate-900 dark:text-white break-words">
                                    {selecionada.title}
                                </h3>
                            </div>
                            <button
                                onClick={() => setSelecionada(null)}
                                aria-label="Fechar"
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 shrink-0"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="px-5 py-4 space-y-3 text-sm">
                            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                                <Clock size={14} className="text-slate-400 shrink-0" />
                                {new Date(selecionada.date).toLocaleString('pt-BR', {
                                    weekday: 'long',
                                    day: '2-digit',
                                    month: 'long',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })}
                            </div>

                            {selecionada.dealId && (
                                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 min-w-0">
                                    <Briefcase size={14} className="text-slate-400 shrink-0" />
                                    <span className="truncate">
                                        {dealTitleById.get(selecionada.dealId) ?? selecionada.dealTitle ?? 'Negócio'}
                                    </span>
                                </div>
                            )}

                            {selecionada.description && (
                                <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed border-t border-slate-100 dark:border-white/5 pt-3">
                                    {selecionada.description}
                                </p>
                            )}
                        </div>

                        {onEdit && (
                            <div className="px-5 py-3 border-t border-slate-100 dark:border-white/10 flex justify-end">
                                <button
                                    onClick={() => {
                                        const alvo = selecionada;
                                        setSelecionada(null);
                                        onEdit(alvo);
                                    }}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-colors"
                                >
                                    <Pencil size={14} />
                                    Editar
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
