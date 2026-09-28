/**
 * @fileoverview O card está no meio de um resgate de no-show?
 *
 * Existe porque `custom_fields.no_show` NUNCA é limpo — de propósito: o painel conta no-show por
 * `no_show_at` dentro do período (`ReunioesMetricsSection`), e zerar a marca apagaria o histórico.
 * O mesmo vale para `handoff_consultor`, que além do guard de idempotência do handoff é lido pela
 * extração como trava do `is_lost` (`lib/ai/extraction/domain-extraction.service.ts` →
 * `loss-guard.ts`): apagá-lo deixaria a extração marcar como PERDIDO justamente o card em resgate,
 * que é quando o lead está calado e o motivo de perda é mais fácil de inferir errado.
 *
 * Como nenhum dos dois carimbos pode sumir, quem precisa saber "e agora, em que pé está?" tem que
 * olhar a ORDEM dos fatos, não a presença da flag. É a mesma lição que já está escrita em
 * `lib/ai/followup/meeting-reminder.ts` ("NUNCA `no_show === true` flat").
 *
 * @module lib/ai/scheduling/no-show-ciclo
 */

/** Data de um carimbo `{ at }` de custom_fields, ou NaN. */
function quando(carimbo: unknown): number {
  const at = (carimbo as { at?: unknown } | null | undefined)?.at;
  return Date.parse(String(at ?? ''));
}

/**
 * true = o card levou no-show e AINDA não voltou para o funil do consultor.
 *
 * Dois usos, que precisam concordar:
 *  - a rota de no-show não remarca/redispara o resgate enquanto o ciclo está aberto;
 *  - `handoffToNextBoard` volta a poder mover o card quando o ciclo está aberto, senão o lead que
 *    remarcasse pelo resgate ficaria preso em "Resgate No-show" (agenda certa, card perdido).
 */
export function emCicloDeResgate(cf: Record<string, unknown> | null | undefined): boolean {
  const noShowAt = Date.parse(String(cf?.no_show_at ?? ''));
  if (Number.isNaN(noShowAt)) return false;

  // Saiu para o consultor DEPOIS do no-show (por handoff ou por escalação) = ciclo fechado.
  // O card está lá de novo e um novo no-show é um evento novo, não repetição do anterior.
  const saidas = [quando(cf?.handoff_consultor), quando(cf?.escalated_consultor)];
  return !saidas.some((at) => !Number.isNaN(at) && at > noShowAt);
}
