/**
 * @fileoverview De quem é a agenda que a Ana consulta e onde ela marca a ligação.
 *
 * ERA do consultor fixo da board (`board_ai_config.consultant_user_id`) — UM por FUNIL. Isso
 * bastava enquanto o time tinha um consultor só. Com dois, o no-show do card do Pedro oferecia
 * os horários livres do Denilson e marcava a ligação na agenda dele (21/09/2026, caso Camila
 * Santos). O card é do Pedro; a reunião tem que ser do Pedro.
 *
 * Agora é o DONO DO CARD, e o consultor da board vira rede de segurança para o card órfão.
 * Em produção isso é quase sempre o mesmo id: o trigger `zz_dono_padrao_lead_novo` (decisão de
 * 26/08/2026) carimba todo lead novo no nome do Denilson, que também é o consultor da board —
 * ou seja, para lead novo nada muda; muda para o card que já foi repassado a alguém.
 *
 * ⚠️ NUNCA devolver string vazia ou undefined disfarçado de id: quem consome passa isso para
 * `.eq('owner_id', ...)`. Com `null` o PostgREST monta `owner_id=eq.null`, que não casa com
 * nada — a agenda volta VAZIA e a pessoa aparece livre o dia inteiro. Por isso o contrato aqui
 * é explícito: id válido ou `null`, e quem recebe `null` não agenda (`scheduling.service.ts`
 * devolve `{kind:'none'}` e a rota de no-show cai no texto genérico).
 *
 * @module lib/ai/scheduling/dono-da-agenda
 */

/** Só o que interessa do deal — evita acoplar ao tipo inteiro. */
export interface CardComDono {
  owner_id?: string | null;
}

/**
 * Resolve de quem é a agenda: dono do card, senão o consultor da board, senão ninguém.
 *
 * @param card deal com (pelo menos) `owner_id`. ⚠️ Se o SELECT que trouxe o deal não pediu
 *   `owner_id`, o campo vem `undefined` e cai no consultor da board sem erro nenhum — confira o
 *   select antes de suspeitar desta função.
 * @param consultorDaBoard `board_ai_config.consultant_user_id` do funil.
 */
export function donoDaAgenda(
  card: CardComDono | null | undefined,
  consultorDaBoard: string | null | undefined,
): string | null {
  const dono = card?.owner_id;
  if (typeof dono === 'string' && dono.length > 0) return dono;
  if (typeof consultorDaBoard === 'string' && consultorDaBoard.length > 0) return consultorDaBoard;
  return null;
}
