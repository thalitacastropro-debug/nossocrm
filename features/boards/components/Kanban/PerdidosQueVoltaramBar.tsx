'use client';

import React from 'react';
import { MessageCircleReply, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { usePerdidosQueVoltaram, useDispensarPerdidoQueVoltou } from '@/lib/query/hooks/usePerdidosQueVoltaram';

/** Horário de Brasília — o relógio de quem lê, não o UTC do banco. */
function quando(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return `${dia} ${hora}`;
}

/**
 * A PORTA DE ENTRADA DO PERDIDO QUE VOLTOU (pedido da Thalita em 11/09, dúvida do Pedro em 09/10).
 *
 * Marcado como perdido, o card some do funil: o filtro abre em "Em Aberto" a cada visita, a busca
 * é cruzada com ele, e o perdido pelo áudio nem está neste funil (vai para a Nutrição). Esta faixa
 * aparece em QUALQUER funil, independente do filtro, sempre que um perdido voltou a escrever — e
 * abre o card direto, onde está o botão Reabrir. "Dispensar" é para quem voltou só para dizer
 * "fechei com outra": o card continua perdido e sai daqui.
 *
 * Não reabre nada sozinho: decidir se é reabertura é do consultor.
 */
export function PerdidosQueVoltaramBar({ onAbrir }: { onAbrir: (dealId: string) => void }) {
  const { user } = useAuth();
  const { data: retornos = [] } = usePerdidosQueVoltaram();
  const dispensar = useDispensarPerdidoQueVoltou();

  if (retornos.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Perdidos que voltaram a falar"
      className="mx-4 mt-2 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2"
    >
      <p className="text-xs font-bold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
        <MessageCircleReply size={14} />
        {retornos.length === 1
          ? '1 lead perdido voltou a falar'
          : `${retornos.length} leads perdidos voltaram a falar`}
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-2">
        {retornos.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-2 rounded-lg bg-white dark:bg-white/5 border border-amber-200/70 dark:border-white/10 pl-2.5 pr-1 py-1 text-xs max-w-full"
          >
            <button
              type="button"
              onClick={() => onAbrir(r.dealId)}
              title="Abrir o card (o botão Reabrir está lá)"
              className="text-left min-w-0 hover:underline"
            >
              <span className="font-semibold text-slate-900 dark:text-white">{r.titulo}</span>
              <span className="text-slate-500 dark:text-slate-400"> · {quando(r.ultimaMsgEm)}</span>
              {r.ultimaPrevia && (
                <span className="block truncate max-w-[260px] text-slate-500 dark:text-slate-400 italic">
                  “{r.ultimaPrevia}”
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => dispensar.mutate({ id: r.id, userId: user?.id })}
              disabled={dispensar.isPending}
              aria-label={`Dispensar ${r.titulo}`}
              title="Dispensar — o card continua perdido"
              className="shrink-0 p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50"
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
