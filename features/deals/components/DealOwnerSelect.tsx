'use client';

/**
 * @fileoverview Seletor de responsável do card (repasse de lead).
 *
 * Antes de 26/08/2026 não existia nenhum controle de dono na interface — a
 * Thalita procurou e não achou porque nunca foi construído. Com o Denilson
 * recebendo todo lead novo e repassando na mão, o repasse tinha que sair do
 * SQL e virar um campo do card.
 *
 * O componente NÃO escreve no Supabase pelo cliente: chama
 * `POST /api/deals/[dealId]/owner`, que troca o dono nos TRÊS lugares (card,
 * pessoa e conversa). Trocar só `deals.owner_id` daqui entregaria um card oco
 * ao novo dono — sem contato e sem WhatsApp, por causa da RLS de posse.
 *
 * @module features/deals/components/DealOwnerSelect
 */

import React, { useEffect, useId, useState } from 'react';
import { UserCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useOrgMembersQuery } from '@/lib/query/hooks/useOrgMembersQuery';

interface DealOwnerSelectProps {
  dealId: string;
  ownerId?: string | null;
  /** Chamado depois de uma troca bem-sucedida (para invalidar os caches da tela). */
  onChanged?: () => void;
  disabled?: boolean;
}

/**
 * A pessoa pode TROCAR o responsável de um card?
 *
 * Espelha o `ve_tudo()` da RLS: admin ou quem tem `ve_todos_os_leads`
 * (sócio/gestor — hoje o Denilson). Um consultor comum não repassa carteira:
 * o WITH CHECK de `contacts_update` é avaliado na linha nova, então ele
 * perderia o acesso ao contato no mesmo comando. Para ele o dono é leitura.
 */
export const podeTrocarResponsavel = (
  profile: { role?: string; ve_todos_os_leads?: boolean } | null | undefined,
): boolean => profile?.role === 'admin' || profile?.ve_todos_os_leads === true;

/** Corpo devolvido pela rota — o repasse reporta o que foi e o que não foi. */
interface TrocaResponsavelResposta {
  error?: string;
  ownerId?: string | null;
  contato?: boolean | null;
  conversas?: number;
  conversasFalhou?: boolean;
  /** Quantos OUTROS cards abertos daquela pessoa continuaram com outro dono. */
  outrosCardsComOutroDono?: number;
  avisoSemAcessoAoFunil?: boolean;
  funil?: string | null;
  novoDonoNome?: string | null;
  semMudanca?: boolean;
}

const SELECT_CLASSES =
  'text-xs rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 ' +
  'px-2 py-1 text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary-500 ' +
  'cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Componente React `DealOwnerSelect`.
 *
 * @param {DealOwnerSelectProps} props - Card, dono atual e callback de atualização.
 * @returns {Element} Seletor de responsável com aviso de repasse parcial.
 */
export function DealOwnerSelect({ dealId, ownerId, onChanged, disabled }: DealOwnerSelectProps) {
  const { data: time = [] } = useOrgMembersQuery();
  // Fora quem tem papel 'trafego' (a agência de anúncios): essa pessoa nem abre o
  // funil, então um card no nome dela some da operação. O aviso de board_access
  // pegaria depois — mas prevenir é melhor do que avisar que o lead sumiu.
  const members = React.useMemo(() => time.filter((m) => m.role !== 'trafego'), [time]);
  const selectId = useId();

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  /** Escolha já gravada no banco que o funil ainda não devolveu na prop. */
  const [escolhaPendente, setEscolhaPendente] = useState<string | null>(null);

  // Quando o card muda, ou quando o banco finalmente devolve o dono novo (ou
  // outra pessoa troca), a escolha local sai de cena e volta a valer a prop.
  useEffect(() => {
    setEscolhaPendente(null);
  }, [dealId, ownerId]);

  // O select mostra a ESCOLHA enquanto o refetch não chega. Sem isto ele volta
  // a exibir o dono antigo no instante em que o "Repassando..." some — invalidar
  // DEALS_VIEW_KEY recarrega deals + contatos + conversas e leva segundos — e
  // quem repassou acha que o clique não pegou e repassa de novo.
  const donoAtual = escolhaPendente ?? ownerId ?? '';

  // Dono que não está mais na lista do time (perfil removido, por exemplo):
  // sem esta opção o select cairia em branco e MENTIRIA "Sem dono".
  const donoForaDaLista = !!ownerId && !members.some((m) => m.id === ownerId);

  const trocar = async (escolhido: string) => {
    // Compara com o que está NA TELA, não só com a prop: logo depois de um
    // repasse a prop ainda é a antiga, e voltar para ela é uma troca de verdade.
    if (escolhido === donoAtual) return;
    const novoDonoId = escolhido === '' ? null : escolhido;

    setSalvando(true);
    setErro(null);
    setAvisos([]);

    try {
      const res = await fetch(`/api/deals/${dealId}/owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: novoDonoId }),
      });

      let corpo: TrocaResponsavelResposta | null = null;
      try {
        corpo = (await res.json()) as TrocaResponsavelResposta;
      } catch {
        // resposta sem corpo JSON — cai na mensagem padrão abaixo
      }

      if (!res.ok) {
        setErro(corpo?.error || 'Não foi possível trocar o responsável. Tente de novo.');
        return;
      }

      const pendencias: string[] = [];
      if (corpo?.avisoSemAcessoAoFunil) {
        const quem = corpo.novoDonoNome || 'Essa pessoa';
        const onde = corpo.funil ? `o funil ${corpo.funil}` : 'esse funil';
        pendencias.push(
          `${quem} não tem acesso a ${onde} — o card vai sumir da tela dele. Libere em Configurações > Equipe.`,
        );
      }
      if (corpo?.contato === false) {
        pendencias.push('O contato continuou com o dono antigo — o novo responsável não vai ver os dados da pessoa.');
      }
      if (corpo?.conversasFalhou) {
        pendencias.push('A conversa do WhatsApp não foi repassada — ela não vai aparecer no Inbox do novo responsável.');
      }
      // A posse é da PESSOA: o contato inteiro mudou de mão. Se essa pessoa tem card
      // aberto em outro funil no nome de um colega, o colega acabou de perder o
      // acesso ao contato e vai abrir um card oco sem entender por quê.
      const outros = corpo?.outrosCardsComOutroDono ?? 0;
      if (outros > 0) {
        pendencias.push(
          outros === 1
            ? 'Essa pessoa tem mais 1 card aberto em outro funil, no nome de outra pessoa. O contato inteiro passou a ser do novo responsável — confira aquele card.'
            : `Essa pessoa tem mais ${outros} cards abertos em outros funis, no nome de outras pessoas. O contato inteiro passou a ser do novo responsável — confira esses cards.`,
        );
      }
      setAvisos(pendencias);

      setEscolhaPendente(escolhido);
      onChanged?.();
    } catch {
      // Falha de rede vira "Failed to fetch", que não diz nada para quem usa.
      setErro('Sem conexão com o servidor. Verifique a internet e tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <UserCircle className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
        <label htmlFor={selectId} className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Responsável
        </label>
        <select
          id={selectId}
          value={donoAtual}
          disabled={disabled || salvando}
          onChange={(e) => trocar(e.target.value)}
          className={SELECT_CLASSES}
        >
          <option value="">Sem dono</option>
          {donoForaDaLista && <option value={ownerId as string}>Responsável atual (fora do time)</option>}
          {members.map((membro) => (
            <option key={membro.id} value={membro.id}>
              {membro.name}
            </option>
          ))}
        </select>
        {salvando && (
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            Repassando...
          </span>
        )}
      </div>

      {erro && (
        <p role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          {erro}
        </p>
      )}

      {avisos.length > 0 && (
        <div className="mt-1 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-2 py-1">
          {avisos.map((texto) => (
            <p key={texto} className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
              <span>{texto}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
