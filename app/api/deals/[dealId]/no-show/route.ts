/**
 * @fileoverview Marcar No-show
 *
 * POST /api/deals/[dealId]/no-show
 *
 * Fluxo (card do board do Consultor → botão "Marcar no-show"):
 *  1. Grava no_show em deals.custom_fields.
 *  2. Move o deal de volta pro board da Ana, etapa "Resgate No-show".
 *  3. Reativa a IA (Ana) pro contato (ai_paused=false) + reseta o circuit breaker.
 *  4. Dispara UMA mensagem proativa de resgate na hora, já oferecendo até 2 horários
 *     livres reais do consultor (encaixe mesmo-dia); sem agenda → texto genérico.
 *
 * Body: { conversationId?: string, contactId?: string }
 *
 * @module app/api/deals/[dealId]/no-show/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { sendAIResponse } from '@/lib/ai/agent/agent.service';
import { resetCircuitBreaker } from '@/lib/ai/messaging/circuit-breaker';
import { ANA_SDR_BOARD_ID, RESGATE_NOSHOW_STAGE_ID } from '@/lib/config/boards';
import { getSchedulingConfig } from '@/lib/ai/scheduling/config';
import { loadBusyIntervals } from '@/lib/ai/scheduling/busy';
import { getAvailableSlots } from '@/lib/ai/scheduling/availability';
import { getBoardAIConfig } from '@/lib/ai/messaging/board-config';
import { buildRescueMessage } from '@/lib/ai/scheduling/no-show-message';
import { donoDaAgenda } from '@/lib/ai/scheduling/dono-da-agenda';
import { emCicloDeResgate } from '@/lib/ai/scheduling/no-show-ciclo';
import type { Slot } from '@/lib/ai/scheduling/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export const maxDuration = 60;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NoShowBody {
  conversationId?: string;
  contactId?: string;
}

/** Primeiro nome do contato para interpolar a saudação (null se não houver). */
function primeiroNome(nome?: string | null): string | null {
  if (!nome) return null;
  const first = nome.trim().split(/\s+/)[0];
  return first || null;
}

/**
 * Calcula até 2 horários livres reais do consultor pra oferecer na mensagem de resgate (encaixe
 * mesmo-dia incluso: o motor parte de hoje respeitando a antecedência mínima). Reusa a MESMA
 * cadeia da Ana (config→busy→available) do board da SDR. Best-effort: qualquer falha → [] (a
 * mensagem cai no texto genérico). Quando o lead responder, a própria Ana reagenda de verdade
 * (o board de Resgate roda o mesmo motor de agendamento).
 *
 * Buffer: os 2 slots ofertados são os mais próximos, logo os mais perto do piso de antecedência
 * (minLeadMinutes). Sem folga, uns minutos de atraso na resposta do lead fariam o slot prometido
 * cair abaixo do piso e a Ana recusar o horário que ela mesma ofereceu. Somamos RESGATE_BUFFER_MIN
 * ao "agora" só pro CÁLCULO da oferta, dando margem pro lead responder.
 */
const RESGATE_BUFFER_MIN = 20;

async function computeRescueSlots(
  admin: SupabaseClient,
  organizationId: string,
  /** Dono do CARD. É a agenda dele que abre os horários — não a do consultor da board. */
  dealOwnerId: string | null,
  now: Date,
): Promise<Slot[]> {
  try {
    // O board fica cravado no da SDR de propósito: o card está indo PARA lá neste mesmo request,
    // então é a config da Ana (hora candidata, slot de 40min, antecedência) que vale.
    const cfg = getSchedulingConfig(ANA_SDR_BOARD_ID);
    if (!cfg) return [];
    const boardCfg = await getBoardAIConfig(admin, ANA_SDR_BOARD_ID);
    // Dono do card, com o consultor da board como rede de segurança. NUNCA `user.id`: quem clica
    // em "Marcar no-show" não é necessariamente o dono — um admin opera card dos outros, e o
    // resgate passaria a ler a agenda (vazia) de quem clicou.
    const consultantUserId = donoDaAgenda({ owner_id: dealOwnerId }, boardCfg?.consultant_user_id);
    if (!consultantUserId) {
      // Sem este aviso, a mensagem sai sem horário e não há como descobrir depois de qual agenda
      // ela tentou ler — nem se tentou. Era o caminho mudo mais provável desta rota.
      console.warn('[no-show] card sem dono e board sem consultor — resgate vai sem horários');
      return [];
    }
    const offerNow = new Date(now.getTime() + RESGATE_BUFFER_MIN * 60_000);
    const busy = await loadBusyIntervals({
      supabase: admin,
      organizationId,
      consultantUserId,
      now: offerNow,
      config: cfg.availability,
    });
    const slots = getAvailableSlots({ now: offerNow, busy, config: cfg.availability }).slice(0, 2);
    // Qual agenda foi lida e o que sobrou dela: é o que permite conferir, depois do deploy, que a
    // ligação foi oferecida na agenda de quem de fato atende.
    console.log(
      '[no-show] resgate: agenda=%s ocupados=%d oferecidos=%d',
      consultantUserId,
      busy.length,
      slots.length,
    );
    return slots;
  } catch (err) {
    console.error('[no-show] falha ao calcular horários de resgate (usando texto genérico):', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 });
  }

  // Corpo é opcional: se vier vazio, caímos no deal.contact_id.
  let body: NoShowBody = {};
  try {
    body = ((await request.json()) as NoShowBody) ?? {};
  } catch {
    body = {};
  }

  try {
    const supabase = await createClient();

    // 1. Auth
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch do deal — a RLS é o gate de autorização (só vê o que pode agir).
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, board_id, contact_id, organization_id, owner_id, custom_fields')
      .eq('id', dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const existingCf = (deal.custom_fields as Record<string, unknown> | null) ?? {};

    // Idempotência: só enquanto ESTE resgate está aberto. `no_show` nunca é limpo (o painel
    // conta no-show por período e zerar apagaria o histórico), então a flag flat bloquearia para
    // sempre o 2º no-show de um lead que remarcou e sumiu de novo — caminho que passou a ser
    // alcançável agora que o card volta mesmo pro funil do consultor.
    if (emCicloDeResgate(existingCf)) {
      return NextResponse.json({ dealId, already_marked: true }, { status: 200 });
    }

    const nowIso = new Date().toISOString();

    // 3. Move de volta pro board da Ana + grava no_show.
    //    custom_fields é REPLACE total no banco → spread do existente é obrigatório.
    //
    //    Os carimbos `handoff_consultor` e `escalated_consultor` FICAM. Apagá-los aqui era
    //    tentador: eles são o guard de idempotência do `handoffToNextBoard`, todo card que leva
    //    no-show já passou por ali (foi assim que chegou no funil do Consultor), e com o carimbo
    //    de pé o lead que remarcasse pelo resgate ficaria preso em "Resgate No-show" — agenda
    //    certa, card perdido.
    //
    //    Mas `handoff_consultor` tem um SEGUNDO leitor: a extração o usa como trava do `is_lost`
    //    (`domain-extraction.service.ts` → `loss-guard.ts`, guard de 24/07). Sem ele, a extração
    //    marcaria como PERDIDO justamente o card em resgate — exatamente quando o lead está
    //    calado e o motivo de perda é mais fácil de inferir errado.
    //
    //    Quem reabre a porta do handoff é o `no_show_at` gravado logo abaixo: o guard de lá
    //    compara as datas em vez de olhar a presença da flag (ver `no-show-ciclo.ts`).
    const noShowCf = {
      ...existingCf,
      no_show: true,
      no_show_at: nowIso,
      no_show_by: user.id,
    };

    const { error: moveError } = await supabase
      .from('deals')
      .update({
        board_id: ANA_SDR_BOARD_ID,
        stage_id: RESGATE_NOSHOW_STAGE_ID,
        last_stage_change_date: nowIso,
        updated_at: nowIso,
        custom_fields: noShowCf,
      })
      .eq('id', dealId);

    if (moveError) {
      // O trigger check_deal_duplicate roda no UPDATE (ignora board_id) e pode
      // barrar se já houver deal aberto do contato na etapa de destino.
      if ((moveError as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'Já existe um negócio para este contato na etapa de resgate.' },
          { status: 409 }
        );
      }
      console.error('[no-show] move failed:', moveError.message);
      return NextResponse.json({ error: 'Failed to move deal' }, { status: 500 });
    }

    // O contato NAO pode vir do corpo: e o do deal ja autorizado. Aceitar body.contactId
    // deixava um consultor despausar a IA e disparar WhatsApp para o lead de outro.
    const effectiveContactId = deal.contact_id ?? undefined;

    // Admin client (service role) para os side-effects de sistema: messaging_messages
    // tem FORCE RLS, e reativar IA/enviar é ação de sistema — bypass é o caminho seguro.
    const admin = createStaticAdminClient();

    // A conversa tambem e derivada do deal. Se o corpo mandar uma, ela so vale se
    // pertencer ao contato DESTE card — senao um consultor faria o sistema mandar
    // WhatsApp para o lead de outro.
    let conversationId: string | undefined;
    if (body.conversationId && effectiveContactId) {
      const { data: conv } = await admin
        .from('messaging_conversations')
        .select('id')
        .eq('id', body.conversationId)
        .eq('contact_id', effectiveContactId)
        .maybeSingle();
      conversationId = conv?.id as string | undefined;
    }
    if (!conversationId && effectiveContactId) {
      const { data: conv } = await admin
        .from('messaging_conversations')
        .select('id')
        .eq('contact_id', effectiveContactId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      conversationId = conv?.id as string | undefined;
    }

    // 4. Reativa IA (best-effort) — contato (cross-channel) OU fallback na conversa — E reseta o breaker.
    try {
      if (effectiveContactId) {
        await admin.from('contacts').update({ ai_paused: false }).eq('id', effectiveContactId);
      } else if (conversationId) {
        // Fallback quando não há contato vinculado: metadata.ai_paused na conversa.
        const { data: conv } = await admin
          .from('messaging_conversations')
          .select('metadata')
          .eq('id', conversationId)
          .maybeSingle();
        const currentMeta = (conv?.metadata as Record<string, unknown> | null) ?? {};
        await admin
          .from('messaging_conversations')
          .update({ metadata: { ...currentMeta, ai_paused: false }, updated_at: nowIso })
          .eq('id', conversationId);
      }

      if (conversationId) {
        await resetCircuitBreaker(admin, conversationId);
      }
    } catch (reactErr) {
      console.error(
        '[no-show] reactivation failed:',
        reactErr instanceof Error ? reactErr.message : reactErr
      );
      // segue — o move já valeu
    }

    // 5. Envia UMA mensagem de resgate (AWAITED). Sem conversationId → pula.
    let messageSent = false;
    if (conversationId) {
      // Nome do contato p/ interpolar a saudação (best-effort).
      let nome: string | null = null;
      if (effectiveContactId) {
        const { data: contato } = await admin
          .from('contacts')
          .select('name')
          .eq('id', effectiveContactId)
          .maybeSingle();
        nome = primeiroNome(contato?.name as string | undefined);
      }

      // Horários livres reais pra oferecer no resgate (best-effort; [] → texto genérico).
      const slots = deal.organization_id
        ? await computeRescueSlots(
            admin,
            deal.organization_id as string,
            (deal.owner_id as string | null) ?? null,
            new Date(),
          )
        : [];

      try {
        const result = await sendAIResponse({
          supabase: admin,
          conversationId,
          response: buildRescueMessage(nome, slots),
        });
        messageSent = result.success;

        if (!result.success) {
          // Sem rollback: registra o erro no deal e segue.
          await supabase
            .from('deals')
            .update({
              custom_fields: {
                ...noShowCf,
                no_show_message_error: result.error?.message ?? 'unknown',
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', dealId);
        }
      } catch (sendErr) {
        console.error(
          '[no-show] send failed:',
          sendErr instanceof Error ? sendErr.message : sendErr
        );
        await supabase
          .from('deals')
          .update({
            custom_fields: {
              ...noShowCf,
              no_show_message_error:
                sendErr instanceof Error ? sendErr.message : 'send_exception',
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', dealId);
      }
    }

    // 6. OK
    return NextResponse.json({ dealId, moved: true, messageSent }, { status: 200 });
  } catch (error) {
    console.error('[no-show]', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
