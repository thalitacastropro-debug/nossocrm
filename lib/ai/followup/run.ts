/**
 * Orquestrador do follow-up (deps INJETADAS p/ testabilidade). Busca deals elegíveis na
 * board da Ana, decide o toque devido por cadência, envia e persiste o estado em
 * custom_fields.followup. O route.ts injeta as deps reais (admin client, sendAIResponse,
 * geração quente, relógio). Ver spec 2026-07-13-followup-cadencias-ana-design.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyCadence, computeAnchor, initState, nextDueTouch, advanceState, isReengaged,
  registerFailure, clearFailures, MAX_FALHAS_SEGUIDAS,
  type FollowupState,
} from './schedule';
import { COLD_TOUCHES, WARM_FALLBACK, WARM_FIXED_LAST_INDEX, FOLLOWUP_TAG, renderBubbles } from './copy';

export const ANA_SDR_BOARD_ID = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';
export const STAGE_NOVO_LEAD = '1e8026b1-88ef-4daa-bc06-fb12b2dceff7';
export const STAGE_EM_QUALIFICACAO = '3128e500-7182-406a-a095-f7f7c5e772ac';
const BATCH_SIZE = 40;

/**
 * Anexo de um toque da cadência — hoje, o vídeo do 3º toque frio.
 *
 * Decisão da Thalita (25/08/2026): ela grava um vídeo uma vez e ele acompanha o
 * toque. Fica no 3º de propósito, **não no primeiro**: mandar mídia para quem
 * nunca respondeu é o disparo que mais chama atenção do WhatsApp, e a conta é
 * nova (o risco de bloqueio da UAZAPI já está mapeado no roadmap). No 3º toque o
 * lead já recebeu duas mensagens de texto sem reclamar.
 */
export interface AnexoDeToque {
  url: string;
  tipo: 'video' | 'image' | 'audio' | 'document';
  legenda?: string;
  fileName?: string;
  /** Vídeo bolinha (PTV) / áudio de voz (PTT) em vez do formato comum. */
  comoGravacao?: boolean;
  /** Índice do toque que leva o anexo. 2 = 3º toque. */
  toqueIndex: number;
  /** Só a cadência fria por padrão — a quente é conversa em andamento. */
  cadencia?: 'cold' | 'warm';
}

export interface FollowupDeps {
  supabase: SupabaseClient;
  now: Date;
  sendResponse: (conversationId: string, message: string) => Promise<{ success: boolean }>;
  /** Envia o anexo do toque. Ausente = cadência segue só com texto. */
  sendMedia?: (conversationId: string, anexo: AnexoDeToque) => Promise<{ success: boolean }>;
  /** Anexo configurado pela organização (nulo = nenhum). */
  anexo?: AnexoDeToque | null;
  generateWarm: (args: {
    organizationId: string; boardId: string; conversationId: string; firstName: string | null; touchIndex: number;
  }) => Promise<string[] | null>;
  /**
   * Chamado UMA vez, quando a cadência de um lead para por falhas seguidas de envio.
   * Ausente = a parada acontece calada (é o que o teste faz). Ver MAX_FALHAS_SEGUIDAS.
   */
  notify?: (args: {
    dealId: string; contactName: string | null; falhas: number;
  }) => Promise<void>;
}

export interface FollowupResult { processed: number; failed: number; skipped: number; reset: number; }

type CF = Record<string, unknown>;

export async function runLeadFollowup(deps: FollowupDeps): Promise<FollowupResult> {
  const { supabase, now } = deps;
  const res: FollowupResult = { processed: 0, failed: 0, skipped: 0, reset: 0 };

  // 1. Deals candidatos na board da Ana (abertos, em novo-lead/em-qualificacao).
  const { data: deals } = await supabase
    .from('deals')
    .select('id, organization_id, contact_id, stage_id, custom_fields, tags')
    .eq('board_id', ANA_SDR_BOARD_ID)
    .in('stage_id', [STAGE_NOVO_LEAD, STAGE_EM_QUALIFICACAO])
    .eq('is_won', false)
    .eq('is_lost', false)
    .is('deleted_at', null)
    .not('contact_id', 'is', null)
    .limit(BATCH_SIZE * 4);

  const candidates = (deals ?? []).filter((d) => {
    const fu = ((d.custom_fields as CF | null)?.followup ?? {}) as FollowupState;
    return fu.stopped !== true;
  });
  if (candidates.length === 0) return res;

  const contactIds = [...new Set(candidates.map((d) => d.contact_id as string))];

  // 2. Conversa MAIS RECENTE de cada contato (qualquer direção). Se a mais recente for
  //    inbound (lead respondeu) ou estiver pausada, o contato é pulado no loop — evita
  //    seguir uma conversa antiga quando o contato tem mais de uma (ex.: 2º canal).
  const { data: convs } = await supabase
    .from('messaging_conversations')
    .select('id, contact_id, first_response_at, last_message_at, last_message_direction, metadata')
    .in('contact_id', contactIds)
    .order('last_message_at', { ascending: false });

  const convByContact = new Map<string, Record<string, unknown>>();
  for (const c of convs ?? []) {
    const cid = c.contact_id as string | null;
    if (!cid || convByContact.has(cid)) continue; // ordenado desc => 1º = mais recente
    convByContact.set(cid, c);
  }
  if (convByContact.size === 0) return res;

  // 3. Contatos (nome + ai_paused).
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, name, ai_paused')
    .in('id', [...convByContact.keys()]);
  const contactById = new Map((contacts ?? []).map((c) => [c.id as string, c]));

  // 4. Último inbound por conversa (reset de reengajamento).
  const convIds = [...convByContact.values()].map((c) => c.id as string);
  const { data: inbound } = await supabase
    .from('messaging_messages')
    .select('conversation_id, created_at')
    .in('conversation_id', convIds)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false });
  const latestInboundByConv = new Map<string, string>();
  for (const m of inbound ?? []) {
    const k = m.conversation_id as string;
    if (!latestInboundByConv.has(k)) latestInboundByConv.set(k, m.created_at as string);
  }

  for (const deal of candidates) {
    const contactId = deal.contact_id as string;
    const conv = convByContact.get(contactId);
    const contact = contactById.get(contactId);
    if (!conv || !contact || contact.ai_paused) { res.skipped++; continue; }
    // A conversa mais recente do contato precisa ser NOSSA (outbound) e não pausada.
    if (conv.last_message_direction !== 'outbound') { res.skipped++; continue; }
    if (((conv.metadata as CF | null) ?? {}).ai_paused === true) { res.skipped++; continue; }

    const cf = (deal.custom_fields as CF | null) ?? {};
    const existing = cf.followup as FollowupState | undefined;
    const convId = conv.id as string;
    const lastMessageAt = conv.last_message_at as string;
    const cadence = classifyCadence(conv.first_response_at as string | null);

    // Reset de reengajamento: inbound mais novo que a âncora atual.
    let state: FollowupState;
    let wasReset = false;
    if (existing && isReengaged(existing.anchor_at, latestInboundByConv.get(convId))) {
      state = initState(cadence, computeAnchor({ cadence, firstTouchSentAt: null, lastMessageAt }));
      wasReset = true;
    } else if (existing) {
      state = existing;
    } else {
      const firstTouchSentAt = (((cf.lead_form as CF | null)?.first_touch as CF | null)?.sent_at as string | null) ?? null;
      state = initState(cadence, computeAnchor({ cadence, firstTouchSentAt, lastMessageAt }));
    }

    const decision = nextDueTouch(state, now);
    if (!decision) {
      if (wasReset) { await persistFollowup(supabase, deal.id as string, cf, state, false); res.reset++; }
      else res.skipped++;
      continue;
    }

    // Renderiza a mensagem do toque.
    const name = (contact.name as string | null) ?? null;
    let message: string;
    if (state.cadence === 'cold') {
      message = renderBubbles(COLD_TOUCHES[decision.touchIndex], name);
    } else if (decision.touchIndex === WARM_FIXED_LAST_INDEX) {
      message = renderBubbles([WARM_FALLBACK[decision.touchIndex]], name);
    } else {
      const ai = await deps.generateWarm({
        organizationId: deal.organization_id as string, boardId: ANA_SDR_BOARD_ID,
        conversationId: convId, firstName: name, touchIndex: decision.touchIndex,
      });
      message = ai && ai.length ? ai.join('\n\n') : renderBubbles([WARM_FALLBACK[decision.touchIndex]], name);
    }

    // Idempotência: PERSISTE o avanço ANTES de enviar. Se a função morrer ou o persist
    // falhar, nunca reenvia o mesmo toque (risco de ban). Se o envio falhar, reverte.
    const advanced = clearFailures(advanceState(state, now));
    const tags = (deal.tags as string[] | null) ?? [];
    const persisted = await persistFollowup(supabase, deal.id as string, cf, advanced, advanced.stopped === true, tags);
    if (!persisted) { res.failed++; continue; } // não envia se não conseguiu registrar

    const sent = await deps.sendResponse(convId, message);
    if (!sent.success) {
      // Reverte o toque (não foi entregue, não pode ser consumido) MAS conta a falha: sem
      // isso o mesmo toque era retentado a cada 15 min para sempre — foi o que aconteceu
      // em 28/08/2026 com o WhatsApp fora do ar (Ricardo levou 20 tentativas).
      const comFalha = registerFailure(state, now);
      await persistFollowup(supabase, deal.id as string, cf, comFalha, comFalha.stopped === true, tags);
      res.failed++;
      if (comFalha.stopped === true && deps.notify) {
        // Parou de vez: alguém precisa olhar (quase sempre é a instância do WhatsApp caída,
        // não o lead). Falha do aviso não pode derrubar o lote.
        await deps.notify({
          dealId: deal.id as string,
          contactName: (contact.name as string | null) ?? null,
          falhas: comFalha.fail_count ?? MAX_FALHAS_SEGUIDAS,
        }).catch((err: unknown) => console.error('[followup] aviso de falhas nao saiu:', err));
      }
      continue;
    }
    res.processed++;

    // Anexo do toque (hoje: o vídeo do 3º toque frio). Vai DEPOIS do texto — a
    // mensagem explica o vídeo, não o contrário — e o resultado dele NÃO reverte
    // a cadência: o toque já foi entregue, e reverter faria o texto sair duas
    // vezes no próximo ciclo (risco de ban, que é o que a cadência mais evita).
    if (
      deps.anexo &&
      deps.sendMedia &&
      decision.touchIndex === deps.anexo.toqueIndex &&
      state.cadence === (deps.anexo.cadencia ?? 'cold')
    ) {
      const anexoEnviado = await deps.sendMedia(convId, deps.anexo);
      if (!anexoEnviado.success) {
        console.warn('[followup] anexo do toque falhou (texto já entregue):', deal.id);
      }
    }
    if (wasReset) res.reset++;

    // CADÊNCIA ESGOTADA → ENTREGA PRO CONSULTOR, COM ALERTA DE LIGAR (Thalita, 21/08).
    //
    // Antes, o último toque gravava `stopped: 'max_touches'` e o card ficava PARADO em
    // "Em Qualificação" no funil da Ana, indistinguível de lead vivo — a Jéssica Raphael está
    // assim desde 31/07. Não existia estado terminal nenhum.
    //
    // Regra: se a Ana já fez toda a cadência e o lead não interage, insistir por mensagem não vai
    // resolver — e ainda gasta disparo numa API não-oficial (risco de bloqueio do número). O lead
    // vai pro funil do consultor, em Qualificação, com alerta destacado pra LIGAR.
    if (advanced.stopped === true) {
      try {
        const { handoffToNextBoard } = await import('@/lib/ai/scheduling/handoff');
        await handoffToNextBoard({
          supabase,
          dealId: deal.id as string,
          // A seleção acima já filtra por este board — não precisa vir no select.
          sourceBoardId: ANA_SDR_BOARD_ID,
          organizationId: deal.organization_id as string,
          motivo: 'sem_resposta_ligar',
        });
      } catch (err) {
        console.error('[Followup] entrega ao consultor no fim da cadência falhou (não-fatal):', err);
      }
    }
  }

  return res;
}

async function persistFollowup(
  supabase: SupabaseClient, dealId: string, existingCf: CF, state: FollowupState, addTag: boolean, tags: string[] = []
): Promise<boolean> {
  const patch: CF = { custom_fields: { ...existingCf, followup: state }, updated_at: new Date().toISOString() };
  if (addTag) patch.tags = [...new Set([...tags, FOLLOWUP_TAG])];
  const { error } = await supabase.from('deals').update(patch).eq('id', dealId);
  if (error) { console.error('[followup] persist falhou p/ deal', dealId, error); return false; }
  return true;
}
