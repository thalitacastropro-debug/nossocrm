'use client';

/**
 * @fileoverview Fechamento do mês por pessoa — a tela que o niva-os-visao.md §1 pede.
 *
 * ADMIN-ONLY nas duas pontas: a rota (`GET /api/relatorios/fechamento`) recusa quem não é
 * admin, e esta tela nem tenta buscar — mostra o aviso. Comissão é dado confidencial
 * ([[feedback_niva_dados_confidenciais_crm]]); "admin = quem pode ver o caixa" (§4b).
 *
 * O que a tela responde, por pessoa: quantas vendas, quanto de prêmio, quanto de comissão
 * (140% quando o colaborador trouxe, 100% em lead da casa, % da operadora na carteira
 * própria de sócio) e o que ainda está DEVENDO: prêmio não informado e carteira sem
 * "quem trouxe". Carteira própria de sócio fica FORA da meta. A tabela por operadora vive
 * SÓ na rota (servidor, atrás do gate de admin) — nunca neste componente.
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MES_ANO = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

/** Uma venda como a rota devolve (ver app/api/relatorios/fechamento/route.ts). */
interface VendaDoFechamento {
  deal_id: string;
  titulo: string | null;
  funil_da_venda: string | null;
  vendido_em: string;
  vendedor_id: string | null;
  vendedor_nome: string | null;
  premio_mensal: number | null;
  operadora: string | null;
  pendente_premio: boolean;
  origem: 'trafego' | 'carteira_propria';
  regra:
    | 'colaborador_trouxe_140'
    | 'colaborador_casa_100'
    | 'socio_carteira_cheia'
    | 'casa_sem_comissao'
    | 'indefinida';
  pessoa_da_comissao_id: string | null;
  pessoa_da_comissao_nome: string | null;
  comissao: number | null;
  /** Multiplicador aplicado (1.4, 1.0, 0.5 na exceção MedSênior, % da operadora no sócio). */
  multiplicador: number | null;
  conta_na_meta: boolean | null;
}

interface CorpoDoFechamento {
  vendas: VendaDoFechamento[];
  contagem: number;
  premioTotal: number;
  /** Repasse a COLABORADOR (140%/100%) — despesa de comissão do time. */
  comissaoTime: number;
  /** Comissão cheia de carteira própria de SÓCIO — receita distribuída, não despesa. */
  repasseSocios: number;
  pendentesDePremio: number;
  vendasNaMeta: number;
  /** Vendas do período cujo card foi marcado PERDIDO depois do ganho (implantação caiu). */
  desfeitas: number;
}

const ROTULO_REGRA: Record<VendaDoFechamento['regra'], string> = {
  colaborador_trouxe_140: 'Trouxe o cliente',
  colaborador_casa_100: 'Lead da casa',
  socio_carteira_cheia: 'Carteira de sócio — comissão cheia',
  casa_sem_comissao: 'Lead da casa fechado por sócio — receita da casa',
  indefinida: 'Carteira própria sem "quem trouxe" — marque na aba Origem do card',
};

/**
 * Rótulo da regra + o percentual REALMENTE aplicado na linha. O % não é fixo no rótulo
 * porque existe exceção (MedSênior paga 50% ao colaborador, não 100%/140%) e a carteira
 * de sócio varia por operadora — rótulo fixo mentiria exatamente no caso raro.
 */
const rotuloComPercentual = (v: VendaDoFechamento): string => {
  const base = ROTULO_REGRA[v.regra];
  if (v.multiplicador === null) return base;
  return `${base} (${Math.round(v.multiplicador * 100)}%)`;
};

/** Primeiro e último instante do mês de referência, em ISO UTC. */
function rangeDoMes(referencia: Date): { inicio: string; fim: string } {
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  return {
    inicio: new Date(Date.UTC(ano, mes, 1)).toISOString(),
    fim: new Date(Date.UTC(ano, mes + 1, 0, 23, 59, 59, 999)).toISOString(),
  };
}

const FechamentoDoMesPage: React.FC = () => {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const ehAdmin = profile?.role === 'admin';
  // Mês de referência navegável (◀ ▶). Date com dia 1 para não pular mês em dia 31.
  const [referencia, setReferencia] = useState(() => {
    const hoje = new Date();
    return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  });
  const periodo = useMemo(() => rangeDoMes(referencia), [referencia]);

  const { data, isLoading, isError, error } = useQuery<CorpoDoFechamento>({
    queryKey: ['fechamentoDoMes', periodo.inicio, periodo.fim],
    queryFn: async () => {
      const busca = new URLSearchParams(periodo);
      const resposta = await fetch(`/api/relatorios/fechamento?${busca.toString()}`);
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) {
        throw new Error(
          (corpo as { error?: string } | null)?.error ?? 'Não foi possível carregar o fechamento.',
        );
      }
      return corpo as CorpoDoFechamento;
    },
    enabled: !authLoading && ehAdmin,
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  /** Agrupamento por pessoa da comissão (vendas sem pessoa caem em "A definir"). */
  const porPessoa = useMemo(() => {
    const grupos = new Map<string, { nome: string; vendas: VendaDoFechamento[] }>();
    for (const venda of data?.vendas ?? []) {
      const chave = venda.pessoa_da_comissao_id ?? 'indefinido';
      const nome =
        venda.pessoa_da_comissao_nome ?? venda.vendedor_nome ?? 'A definir (sem "quem trouxe")';
      const grupo = grupos.get(chave) ?? { nome, vendas: [] };
      grupo.vendas.push(venda);
      grupos.set(chave, grupo);
    }
    return Array.from(grupos.entries()).map(([id, grupo]) => {
      let premio = 0;
      let comissao = 0;
      let pendencias = 0;
      let naMeta = 0;
      for (const v of grupo.vendas) {
        if (v.premio_mensal !== null) premio += v.premio_mensal;
        if (v.comissao !== null) comissao += v.comissao;
        if (v.pendente_premio || v.regra === 'indefinida') pendencias += 1;
        if (v.conta_na_meta === true) naMeta += 1;
      }
      return { id, ...grupo, premio, comissao, pendencias, naMeta };
    });
  }, [data]);

  if (!authLoading && !ehAdmin) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-6">
          <Lock size={20} className="text-slate-400 shrink-0" aria-hidden="true" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            O fechamento do mês é visível só para administradores.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/reports')}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 transition-colors"
          aria-label="Voltar para relatórios"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white font-display">
            Fechamento do mês
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Vendas carimbadas, prêmio do plano vendido e comissão por pessoa. Só administradores veem esta tela.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setReferencia((r) => new Date(r.getFullYear(), r.getMonth() - 1, 1))}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 transition-colors"
            aria-label="Mês anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-bold text-slate-900 dark:text-white capitalize min-w-36 text-center">
            {MES_ANO.format(referencia)}
          </span>
          <button
            type="button"
            onClick={() => setReferencia((r) => new Date(r.getFullYear(), r.getMonth() + 1, 1))}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 transition-colors"
            aria-label="Próximo mês"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Carregando o fechamento...</p>}
      {isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Não foi possível carregar o fechamento.'}
        </p>
      )}

      {data && (
        <>
          {/* Totais do mês. "Comissão do time" (140%/100%, despesa de repasse) fica
              separada de "Carteira de sócios" (comissão cheia — receita da venda
              distribuída ao sócio): somar as duas num "a pagar" único inflaria a despesa. */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { rotulo: 'Vendas', valor: String(data.contagem) },
              { rotulo: 'Prêmio (soma)', valor: BRL.format(data.premioTotal) },
              { rotulo: 'Comissão do time', valor: BRL.format(data.comissaoTime) },
              { rotulo: 'Carteira de sócios', valor: BRL.format(data.repasseSocios) },
              { rotulo: 'Contam na meta', valor: String(data.vendasNaMeta) },
            ].map(({ rotulo, valor }) => (
              <div
                key={rotulo}
                className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4"
              >
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {rotulo}
                </div>
                <div className="text-lg font-bold text-slate-900 dark:text-white">{valor}</div>
              </div>
            ))}
          </div>

          {data.pendentesDePremio > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                {data.pendentesDePremio === 1
                  ? '1 venda do mês ainda está sem o prêmio do plano vendido'
                  : `${data.pendentesDePremio} vendas do mês ainda estão sem o prêmio do plano vendido`}
                {' '}— o prêmio e a comissão dessas vendas não entram nas somas acima. Preencha no
                card (aba IA Insights) ou pela pendência no topo do funil.
              </span>
            </p>
          )}

          {data.desfeitas > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
              <span>
                {data.desfeitas === 1
                  ? '1 venda do período foi DESFEITA (o card foi marcado como perdido depois do ganho)'
                  : `${data.desfeitas} vendas do período foram DESFEITAS (cards marcados como perdidos depois do ganho)`}
                {' '}— ela não conta nas somas nem na meta.
              </span>
            </p>
          )}

          {/* Por pessoa */}
          {porPessoa.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nenhuma venda carimbada neste mês.
            </p>
          ) : (
            porPessoa.map((grupo) => (
              <div
                key={grupo.id}
                className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden"
              >
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    {grupo.nome}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {grupo.vendas.length} venda{grupo.vendas.length === 1 ? '' : 's'} · na meta: {grupo.naMeta}
                  </span>
                  <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                    Prêmio <strong className="text-slate-900 dark:text-white">{BRL.format(grupo.premio)}</strong>
                    {' · '}Comissão{' '}
                    <strong className="text-emerald-600 dark:text-emerald-400">{BRL.format(grupo.comissao)}</strong>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-2 font-bold">Venda</th>
                        <th className="px-4 py-2 font-bold">Data</th>
                        <th className="px-4 py-2 font-bold">Prêmio</th>
                        <th className="px-4 py-2 font-bold">Operadora</th>
                        <th className="px-4 py-2 font-bold">Regra</th>
                        <th className="px-4 py-2 font-bold text-right">Comissão</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grupo.vendas.map((v) => (
                        <tr
                          key={v.deal_id}
                          className="border-t border-slate-100 dark:border-white/5 text-slate-700 dark:text-slate-300"
                        >
                          <td className="px-4 py-2 max-w-52">
                            <div className="truncate font-medium text-slate-900 dark:text-white">
                              {v.titulo ?? v.deal_id}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {v.funil_da_venda ?? ''}
                              {v.conta_na_meta === false && ' · fora da meta'}
                              {v.conta_na_meta === null && ' · meta a definir'}
                            </div>
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {new Date(v.vendido_em).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            {v.premio_mensal !== null ? (
                              BRL.format(v.premio_mensal)
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400 font-bold">
                                falta informar
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2">{v.operadora ?? '—'}</td>
                          <td className="px-4 py-2 max-w-64">
                            <span className="text-[11px]">{rotuloComPercentual(v)}</span>
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap font-medium">
                            {v.comissao !== null ? BRL.format(v.comissao) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
};

export default FechamentoDoMesPage;
