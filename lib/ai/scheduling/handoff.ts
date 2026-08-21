/**
 * @fileoverview Handoff server-side Ana->Consultor. Quando uma reunião REAL é confirmada, MOVE
 * o deal para o próximo board da jornada (`boards.next_board_id`, ex.: SDR — IA Qualificação →
 * Comercial — Consultor) para o consultor assumir o lead agendado.
 *
 * MOVE, não copia (decisão da Thalita 2026-07-19, após revisão adversarial): uma cópia deixava
 * DUAS fontes de verdade — a activity CALL e as mutações (remarcação/cancelamento) ficam sempre
 * no deal, então o card copiado congelava (horário velho, "reunião realizada"/"cancelar" agindo
 * na activity errada, anti-no-show caçando reunião já feita). Movendo o PRÓPRIO deal, a CALL, o
 * `reuniao_agendada`, o lead_form/tier/qualificacao viajam juntos → o consultor trabalha o card
 * real, uma fonte de verdade só. A cadência anti-no-show é board-agnóstica (ancora em activities),
 * então segue disparando após o move; a barra de agendamentos conta CALL (também board-agnóstica).
 *
 * Gatilho = reunião REAL confirmada (chamado pelo agent.service DEPOIS do avanço de etapa, quando
 * `scheduling_status.kind==='confirmed'`), NÃO "chegou na etapa agendado" (o avaliador de IA pode
 * alcançar "agendado" sem booking — bug do Cleysson). Idempotente: flag `custom_fields.handoff_consultor`
 * no deal (uma vez movido/flagado, nunca re-move — cobre remarcação e re-runs).
 *
 * @module lib/ai/scheduling/handoff
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { slotLabelFromIso } from './availability';

/**
 * Por que o lead está sendo entregue. Molda a etapa de destino, a activity e o alerta.
 *
 * REGRA DE NEGÓCIO (Thalita, 21/08): o lead só vai pro consultor quando a Ana NÃO CONSEGUE
 * resolver — e, uma vez lá, **a Ana não volta a atender**. O lead vira responsabilidade do
 * consultor. Por isso os três motivos abaixo são caminhos de SAÍDA definitiva do funil da Ana.
 */
export type HandoffMotivo =
  /** Reunião REAL confirmada. Cai na etapa de entrada (call-agendada). */
  | 'reuniao_agendada'
  /** A Ana travou (notify_team): não conseguiu resolver, precisa de humano. Cai em qualificação. */
  | 'ana_nao_resolveu'
  /** Cadência esgotada sem o lead interagir: só resolve por LIGAÇÃO. Cai em qualificação. */
  | 'sem_resposta_ligar';

export interface HandoffToNextBoardParams {
  supabase: SupabaseClient;
  /** Deal a mover (o card no funil da Ana). */
  dealId: string;
  /** Board de origem. Se null/sem `next_board_id` → no-op. */
  sourceBoardId: string | null | undefined;
  organizationId: string;
  /** Default `reuniao_agendada` (comportamento histórico, inalterado). */
  motivo?: HandoffMotivo;
}

export interface HandoffResult {
  handedOff: boolean;
  reason?: 'no_next_board' | 'already_done' | 'source_missing' | 'no_target_stage' | 'db_error';
  targetBoardId?: string;
}

/**
 * Extrai do card o que o CONSULTOR precisa antes de discar: o que já se sabe do lead, há quanto
 * tempo ele está no funil e o que a Ana já tentou.
 *
 * Pedido da Thalita (21/08): "o alerta tem que vir o resumo dos followups, além do ligar; esse lead
 * entrou no funil há quanto tempo?" — sem isso o consultor liga às cegas ou gasta tempo relendo a
 * conversa inteira. Tudo é opcional: card magro simplesmente omite a linha.
 */
function resumoParaConsultor(
  custom: Record<string, unknown>,
  createdAt: string | null
): { qualificacao?: string; diasNoFunil?: number; toques?: number; ultimoToque?: string; leadJaRespondeu?: boolean } {
  const q = (custom.qualificacao ?? {}) as Record<string, unknown>;
  const tier = (custom.tier ?? {}) as { value?: string };
  const fu = (custom.followup ?? {}) as { count?: number; last_sent_at?: string };

  const partes: string[] = [];
  if (tier.value && tier.value !== 'indefinido') partes.push(tier.value);
  if (typeof q.vidas === 'number') partes.push(`${q.vidas} vida${q.vidas > 1 ? 's' : ''}`);
  if (typeof q.valor_pago_exato === 'number') partes.push(`paga R$${q.valor_pago_exato}/mês`);
  if (typeof q.cidade_uf === 'string' && q.cidade_uf.trim()) partes.push(String(q.cidade_uf).trim());

  const diasNoFunil = createdAt
    ? Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000))
    : undefined;

  return {
    qualificacao: partes.length ? partes.join(' · ') : undefined,
    diasNoFunil,
    toques: typeof fu.count === 'number' ? fu.count : undefined,
    ultimoToque: fu.last_sent_at,
  };
}

export async function handoffToNextBoard(params: HandoffToNextBoardParams): Promise<HandoffResult> {
  const { supabase, dealId, sourceBoardId, organizationId, motivo = 'reuniao_agendada' } = params;
  if (!sourceBoardId) return { handedOff: false, reason: 'no_next_board' };

  // 1. Próximo board da jornada. Sem ele, não há pra onde entregar.
  const { data: srcBoard } = await supabase
    .from('boards')
    .select('next_board_id')
    .eq('id', sourceBoardId)
    .maybeSingle();
  const nextBoardId = ((srcBoard?.next_board_id as string | null | undefined) ?? null) as string | null;
  if (!nextBoardId) return { handedOff: false, reason: 'no_next_board' };

  // 2. Deal + guard de idempotência. A flag `handoff_consultor` (uma vez movido) impede re-move —
  //    cobre remarcação/re-run. Defensivo: se o deal já saiu do board de origem, também não mexe.
  const { data: srcDeal } = await supabase
    .from('deals')
    .select('board_id, title, custom_fields, created_at')
    .eq('id', dealId)
    .maybeSingle();
  if (!srcDeal) return { handedOff: false, reason: 'source_missing' };
  const srcCustom = (srcDeal.custom_fields as Record<string, unknown>) || {};
  if (srcCustom.handoff_consultor) return { handedOff: false, reason: 'already_done' };
  if (srcDeal.board_id && srcDeal.board_id !== sourceBoardId) return { handedOff: false, reason: 'already_done' };

  // 3. Etapa de destino.
  //    - `reuniao_agendada` → etapa de ENTRADA (menor order = "call-agendada"): tem horário marcado.
  //    - demais motivos → etapa de QUALIFICAÇÃO: o consultor ainda precisa trabalhar o lead, e pôr
  //      em "call-agendada" mentiria sobre existir reunião. Se a etapa não existir no board, cai na
  //      de entrada em vez de abortar — entregar no lugar quase certo é melhor que não entregar.
  const { data: stages } = await supabase
    .from('board_stages')
    .select('id, name')
    .eq('board_id', nextBoardId)
    .order('order', { ascending: true });

  const lista = (Array.isArray(stages) ? stages : []) as Array<{ id: string; name: string }>;
  const entryStageId = lista[0]?.id ? String(lista[0].id) : undefined;
  const qualificacaoStageId = lista.find((s) =>
    String(s.name ?? '').toLowerCase().includes('qualifica')
  )?.id;

  const targetStageId =
    motivo === 'reuniao_agendada' ? entryStageId : (qualificacaoStageId ?? entryStageId);
  if (!targetStageId) return { handedOff: false, reason: 'no_target_stage' };

  // 4. MOVE o deal (mesmo id): board_id + stage_id + carimbo de origem/idempotência. A activity CALL
  //    (owner=consultor) e o custom_fields (reuniao_agendada/lead_form/tier/qualificacao) ficam no
  //    MESMO deal — o consultor abre o card real, com o horário e o histórico. Sem cópia congelada.
  const now = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('deals')
    .update({
      board_id: nextBoardId,
      stage_id: targetStageId,
      last_stage_change_date: now,
      updated_at: now,
      custom_fields: {
        ...srcCustom,
        originBoardId: sourceBoardId,
        handoff_consultor: { board_id: nextBoardId, from: sourceBoardId, at: now, motivo },
      },
    })
    .eq('id', dealId);

  if (updErr) {
    console.error('[Handoff] falha ao mover deal p/ o board destino:', updErr);
    return { handedOff: false, reason: 'db_error' };
  }

  // 5. Log de atividade (best-effort, pra rastreabilidade na timeline).
  const descricaoPorMotivo: Record<HandoffMotivo, string> = {
    reuniao_agendada: 'Automação: reunião agendada → card movido para o board Comercial — Consultor',
    ana_nao_resolveu:
      'Automação: a Ana não conseguiu resolver e entregou o lead → card movido para Qualificação do Consultor',
    sem_resposta_ligar:
      'Automação: cadência esgotada sem o lead responder → card movido para Qualificação do Consultor. LIGAR (não resolve por mensagem)',
  };
  const { error: actErr } = await supabase.from('activities').insert({
    deal_id: dealId,
    organization_id: organizationId,
    type: 'STATUS_CHANGE',
    title:
      motivo === 'sem_resposta_ligar'
        ? 'Movido para o Consultor — LIGAR'
        : 'Movido para o funil do Consultor',
    description: descricaoPorMotivo[motivo],
    date: now,
    completed: true,
  });
  if (actErr) console.error('[Handoff] log de atividade falhou (não-fatal):', actErr);

  // 6. Aviso POSITIVO no Telegram pro consultor ("✅ Novo lead agendado — {nome}, reunião {label}").
  //    Busca token/chat_id em organization_settings, igual ao handleHandoff do agent.service. Com o
  //    MOVE, o notify_team da etapa "agendado" ficou inócuo (o deal sai na hora) — este é o alerta que
  //    avisa o consultor que caiu um lead agendado no funil dele. Best-effort: NUNCA falha o handoff.
  //    Caveat (LOW, aceito): o guard de idempotência (passo 2) é read-then-write não-atômico; no
  //    double-run CONCORRENTE conhecido do agent.service, os 2 runs podem passar o guard e enviar 2
  //    pings idênticos. Raiz é o double-run (não este código); dup de notificação é inócua.
  try {
    const { data: orgTelegram } = await supabase
      .from('organization_settings')
      .select('telegram_bot_token, telegram_chat_id')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (orgTelegram?.telegram_bot_token && orgTelegram?.telegram_chat_id) {
      const leadForm = srcCustom.lead_form as { mapped?: { name?: string } } | undefined;
      const reuniao = srcCustom.reuniao_agendada as { data_hora?: string } | undefined;
      const contactName =
        leadForm?.mapped?.name?.trim() ||
        (typeof srcDeal.title === 'string' ? srcDeal.title.trim() : '') ||
        'Novo lead';
      const meetingLabel = slotLabelFromIso(reuniao?.data_hora, '-03:00');

      const { sendTelegramMessage, formatMeetingHandoffMessage, formatEntregaConsultorMessage } =
        await import('@/lib/notifications/telegram');

      const message =
        motivo === 'reuniao_agendada'
          ? formatMeetingHandoffMessage({
              contactName,
              meetingLabel,
              appUrl: process.env.NEXT_PUBLIC_APP_URL,
              dealId,
            })
          : formatEntregaConsultorMessage({
              contactName,
              precisaLigar: motivo === 'sem_resposta_ligar',
              // BRIEFING (pedido da Thalita, 21/08): o consultor precisa saber o que já se tentou e
              // há quanto tempo, pra não perder tempo relendo a conversa nem ligar às cegas.
              ...resumoParaConsultor(srcCustom, srcDeal.created_at as string | null),
              appUrl: process.env.NEXT_PUBLIC_APP_URL,
              dealId,
            });

      await sendTelegramMessage(orgTelegram.telegram_bot_token, orgTelegram.telegram_chat_id, message);
    }
  } catch (err) {
    console.error('[Handoff] notificação Telegram falhou (não-fatal):', err);
  }

  return { handedOff: true, targetBoardId: nextBoardId };
}
