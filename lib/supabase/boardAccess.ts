/**
 * @fileoverview Serviço Supabase para acesso por funil (`board_access`).
 *
 * Quem enxerga qual funil. Modelo default-DENY: `admin` enxerga todos os funis
 * sem precisar de linha nenhuma aqui; qualquer outro papel enxerga só os que o
 * admin concedeu. A RLS (migração `20260824210000_acesso_por_funil.sql`) é quem
 * de fato aplica a regra — este serviço só lê e escreve as concessões para a
 * tela de Equipe.
 *
 * Decisão da Thalita (24/08/2026): a concessão é manual e por pessoa, porque a
 * área de atuação define o funil — um time de implantação não precisa ver o
 * comercial, e vice-versa.
 *
 * @module lib/supabase/boardAccess
 */

import { supabase } from './client';

/** Uma concessão: a pessoa `userId` enxerga o funil `boardId`. */
export interface BoardAccessRow {
  boardId: string;
  userId: string;
}

interface DbBoardAccess {
  board_id: string;
  user_id: string;
}

export const boardAccessService = {
  /**
   * Todas as concessões visíveis para quem chama.
   *
   * Admin recebe as de toda a equipe (é o que a tela de Equipe precisa); os
   * demais papéis recebem só as próprias — a RLS filtra, não este código.
   */
  async getAll(): Promise<{ data: BoardAccessRow[]; error: Error | null }> {
    if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

    const { data, error } = await supabase.from('board_access').select('board_id, user_id');
    if (error) return { data: [], error };

    return {
      data: (data as DbBoardAccess[] | null)?.map((r) => ({ boardId: r.board_id, userId: r.user_id })) ?? [],
      error: null,
    };
  },

  /**
   * Define exatamente quais funis uma pessoa enxerga.
   *
   * Aplica a diferença (concede o que falta, revoga o que sobra) em vez de
   * apagar tudo e reinserir: se a revogação passar e a concessão falhar, a
   * pessoa fica sem funil nenhum no meio do caminho.
   *
   * @param userId  Pessoa que recebe (ou perde) o acesso.
   * @param boardIds Conjunto final de funis que ela deve enxergar.
   */
  async setForUser(userId: string, boardIds: string[]): Promise<{ error: Error | null }> {
    if (!supabase) return { error: new Error('Supabase não configurado') };

    const { data: current, error: readError } = await supabase
      .from('board_access')
      .select('board_id')
      .eq('user_id', userId);

    if (readError) return { error: readError };

    const atual = new Set((current as { board_id: string }[] | null)?.map((r) => r.board_id) ?? []);
    const desejado = new Set(boardIds);

    const conceder = [...desejado].filter((id) => !atual.has(id));
    const revogar = [...atual].filter((id) => !desejado.has(id));

    if (conceder.length > 0) {
      const { data: sessao } = await supabase.auth.getUser();
      const { error } = await supabase.from('board_access').insert(
        conceder.map((boardId) => ({
          board_id: boardId,
          user_id: userId,
          granted_by: sessao?.user?.id ?? null,
        })),
      );
      if (error) return { error };
    }

    if (revogar.length > 0) {
      const { error } = await supabase
        .from('board_access')
        .delete()
        .eq('user_id', userId)
        .in('board_id', revogar);
      if (error) return { error };
    }

    return { error: null };
  },
};
