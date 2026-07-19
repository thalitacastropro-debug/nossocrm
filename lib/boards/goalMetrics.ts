/**
 * @fileoverview Métricas de meta de board que dependem de eventos (não do estado atual
 * dos cards). Hoje: agendamentos do mês (`meetings_scheduled`), usado pela barra de
 * objetivo do board SDR (meta "39 agendamentos/mês").
 *
 * Fonte = atividades `CALL` (a ligação que o booker cria ao confirmar a reunião), a MESMA
 * do dashboard (ReunioesMetricsSection). É board-agnóstico e sobrevive a copy/move do deal:
 * a métrica conta o evento, não em qual funil o card está agora. Contar `is_won` (o que a
 * barra fazia) zerava a meta — SDR nunca fecha venda; contar a etapa "agendado" contaria os
 * mis-advancements (deal em agendado SEM reunião real, ex.: Cleysson).
 *
 * @module lib/boards/goalMetrics
 */

/** Início (1º dia 00:00) e fim (último dia 23:59:59.999) do mês que contém `now`, hora local. */
export function getCurrentMonthRange(now: Date): { start: string; end: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  // Dia 0 do mês seguinte = último dia do mês atual.
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Conta agendamentos = atividades do tipo CALL. Espera atividades JÁ filtradas por período
 * (o useActivities faz o recorte por data) e sem soft-deleted (o service já exclui) — assim
 * uma remarcação (que soft-deleta a CALL antiga e cria uma nova) não conta em dobro.
 */
export function countScheduledMeetings(activities: Array<{ type?: string | null }>): number {
  return activities.filter((a) => a.type === 'CALL').length;
}
