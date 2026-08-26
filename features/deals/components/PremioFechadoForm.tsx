'use client';

/**
 * @fileoverview Formulário do PRÊMIO DO PLANO VENDIDO — o número que fecha o mês.
 *
 * Um componente só, dois lugares: o modal do card (o card ganho vive na Implantação) e a
 * pendência do topo do funil (quem vendeu perdeu o card de vista quando ele mudou de funil,
 * mas continua vendo a pendência da própria venda no header do Comercial).
 *
 * Envia para `PATCH /api/deals/[dealId]/venda` — rota de servidor porque a RLS esconde o
 * card de quem vendeu depois do move; é a rota que confere se a venda é da pessoa.
 *
 * ⚠️ NADA de percentual de comissão aqui. A lista de operadoras é só nome (ajuda a digitar
 * certo); os percentuais são confidenciais e vivem fora do alcance do time
 * ([[feedback_niva_dados_confidenciais_crm]]).
 */

import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';

/** O que a rota devolve e o que o chamador recebe no onSaved. */
export interface PremioSalvo {
  premio_mensal: number;
  operadora: string;
  vigencia_em: string | null;
}

interface PremioFechadoFormProps {
  dealId: string;
  /** Chamado com o prêmio salvo — o chamador invalida as queries e fecha o form. */
  onSaved: (venda: PremioSalvo) => void;
  /** Correção: os valores atuais pré-preenchem o form. */
  premioAtual?: PremioSalvo | null;
  /** Cancelar é opcional: o painel do modal não precisa, o popup da pendência sim. */
  onCancel?: () => void;
}

/**
 * Operadoras que a Niva opera — SÓ OS NOMES, para digitar certo e agrupar relatório.
 * O campo continua livre (datalist): operadora nova não pode travar uma venda.
 */
const OPERADORAS_CONHECIDAS = ['Porto Seguro', 'AMIL', 'Sulamérica', 'Alice', 'Bradesco'];

export const PremioFechadoForm: React.FC<PremioFechadoFormProps> = ({
  dealId,
  onSaved,
  premioAtual,
  onCancel,
}) => {
  const [premio, setPremio] = useState(
    premioAtual ? String(premioAtual.premio_mensal) : '',
  );
  const [operadora, setOperadora] = useState(premioAtual?.operadora ?? '');
  const [vigencia, setVigencia] = useState(premioAtual?.vigencia_em ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const idBase = useId();
  const listaId = `${idBase}-operadoras`;

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validação de presença aqui; a de VALOR (zero, teto, data que não existe) é da rota,
    // que é quem manda — a mensagem dela volta pronta em português.
    if (premio.trim() === '' || operadora.trim() === '') {
      setErro('Informe o prêmio mensal e a operadora do plano vendido.');
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const resposta = await fetch(`/api/deals/${encodeURIComponent(dealId)}/venda`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          premio_mensal: premio,
          operadora,
          vigencia_em: vigencia,
        }),
      });
      const corpo = (await resposta.json().catch(() => null)) as
        | { venda?: PremioSalvo; error?: string }
        | null;
      if (!resposta.ok || !corpo?.venda) {
        setErro(corpo?.error ?? 'Não foi possível salvar o prêmio. Tente de novo.');
        return;
      }
      onSaved(corpo.venda);
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={submeter} className="space-y-3" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={`${idBase}-premio`}
            className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1"
          >
            Prêmio mensal (R$)
          </label>
          <input
            id={`${idBase}-premio`}
            type="text"
            inputMode="decimal"
            value={premio}
            onChange={(e) => setPremio(e.target.value)}
            placeholder="1.850,00"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <label
            htmlFor={`${idBase}-operadora`}
            className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1"
          >
            Operadora
          </label>
          <input
            id={`${idBase}-operadora`}
            type="text"
            list={listaId}
            value={operadora}
            onChange={(e) => setOperadora(e.target.value)}
            placeholder="Bradesco"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <datalist id={listaId}>
            {OPERADORAS_CONHECIDAS.map((nome) => (
              <option key={nome} value={nome} />
            ))}
          </datalist>
        </div>
      </div>
      <div>
        <label
          htmlFor={`${idBase}-vigencia`}
          className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1"
        >
          Vigência (opcional)
        </label>
        <input
          id={`${idBase}-vigencia`}
          type="date"
          value={vigencia}
          onChange={(e) => setVigencia(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {erro && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}

      <div className="flex items-center gap-2 justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-bold rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={salvando}
          className="px-4 py-1.5 text-xs font-bold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 transition-colors inline-flex items-center gap-1.5"
        >
          {salvando && <Loader2 size={12} className="animate-spin" />}
          Salvar prêmio
        </button>
      </div>
    </form>
  );
};
