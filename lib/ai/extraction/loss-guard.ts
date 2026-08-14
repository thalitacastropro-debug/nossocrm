/**
 * @fileoverview Quem pode marcar (e DESMARCAR) um deal como perdido, a partir da extração.
 *
 * CONTEXTO (caso Ruberleide, 03/08 — roadmap §P0.3): a extração de domínio relê a
 * conversa INTEIRA a cada turno. A lead escreveu "Quero cotar com estas vidas apenas"
 * em 30/07 — dizendo QUANTAS vidas entram, não recusando o diagnóstico — e o modelo
 * leu isso como `quer_so_cotacao=true`. Como a frase nunca sai do histórico, a flag
 * re-disparava em TODO turno seguinte; em 03/08, no turno em que ela ACEITOU o horário
 * das 14h, o deal foi marcado `is_lost=true` com "Só quer cotação e recusa o diagnóstico".
 *
 * O bug estrutural não é o falso positivo do modelo (isso vai acontecer de novo): é que
 * `is_lost`/`loss_reason` só eram ESCRITOS, nunca limpos. Um único turno errado virava
 * estado PERMANENTE, e o card sumia do board. A Graci passou pelo mesmo (27/07) e só
 * escapou porque já tinha reunião confirmada — o `loss_reason` dela ficou grudado até hoje,
 * mesmo com o tier já de volta pra `bronze`.
 *
 * REGRA: a extração pode desfazer a PRÓPRIA conclusão, e só ela. Perda marcada por humano
 * (modal / arrastar card) nunca é revertida automaticamente.
 */

/** Marca em `custom_fields` que a perda foi decidida pela extração, não por humano. */
export const PERDA_ORIGEM_EXTRACAO = 'extracao';

export interface ExtractionLossInput {
  /** Motivo que a extração concluiu AGORA. `null` = lead está dentro do perfil. */
  lossReason: string | null;
  /** Reunião já confirmada no card (guard do P0 24/07). */
  meetingConfirmed: boolean;
  /** Deal já entregue ao consultor. */
  alreadyHandedOff: boolean;
  /** Estado atual do deal no banco. */
  currentIsLost: boolean;
  /** A perda atual foi escrita pela extração? (`custom_fields.perda_origem`) */
  lossOwnedByExtraction: boolean;
}

export interface ExtractionLossUpdate {
  loss_reason?: string | null;
  is_lost?: boolean;
}

/**
 * Decide o que a extração escreve nos campos de perda.
 *
 * Campo ausente no retorno = "não toca nesse campo".
 */
export function resolveExtractionLoss(input: ExtractionLossInput): ExtractionLossUpdate {
  const { lossReason, meetingConfirmed, alreadyHandedOff, currentIsLost, lossOwnedByExtraction } = input;

  if (lossReason) {
    const update: ExtractionLossUpdate = { loss_reason: lossReason };
    // Reunião confirmada ou handoff = o lead JÁ topou falar com o consultor. O motivo fica
    // como contexto, mas o card continua vivo e visível.
    if (!meetingConfirmed && !alreadyHandedOff) update.is_lost = true;
    return update;
  }

  // Sem motivo agora: a extração desfaz o que ELA mesma marcou — este é o caminho de volta
  // que não existia. Perda de humano é intocável.
  if (currentIsLost && lossOwnedByExtraction) {
    return { is_lost: false, loss_reason: null };
  }

  return {};
}
