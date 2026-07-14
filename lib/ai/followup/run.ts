/**
 * Orquestrador do follow-up (deps INJETADAS p/ testabilidade). Busca deals elegíveis na
 * board da Ana, decide o toque devido por cadência, envia e persiste o estado em
 * custom_fields.followup. O route.ts injeta as deps reais (admin client, sendAIResponse,
 * geração quente, relógio). Ver spec 2026-07-13-followup-cadencias-ana-design.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyCadence, computeAnchor, initState, nextDueTouch, advanceState, isReengaged,
  type FollowupState,
} from './schedule';
import { COLD_TOUCHES, WARM_FALLBACK, WARM_FIXED_LAST_INDEX, FOLLOWUP_TAG, renderBubbles } from './copy';

export const ANA_SDR_BOARD_ID = 'c2e36157-1b63-43cc-be35-bb1cab7a287f';
export const STAGE_NOVO_LEAD = '1e8026b1-88ef-4daa-bc06-fb12b2dceff7';
export const STAGE_EM_QUALIFICACAO = '3128e500-7182-406a-a095-f7f7c5e772ac';
const BATCH_SIZE = 40;

export interface FollowupDeps {
  supabase: SupabaseClient;
  now: Date;
  sendResponse: (conversationId: string, message: string) => Promise<{ success: boolean }>;
  generateWarm: (args: {
    organizationId: string; boardId: string; conversationId: string; firstName: string | null; touchIndex: number;
  }) => Promise<string[] | null>;
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

  // 2. Conversa mais recente por contato (última fala nossa).
  const { data: convs } = await supabase
    .from('messaging_conversations')
    .select('id, contact_id, first_response_at, last_message_at, last_message_direction, metadata')
    .in('contact_id', contactIds)
    .eq('last_message_direction', 'outbound')
    .order('last_message_at', { ascending: false });

  const convByContact = new Map<string, Record<string, unknown>>();
  for (const c of convs ?? []) {
    const cid = c.contact_id as string | null;
    if (!cid || convByContact.has(cid)) continue; // ordenado desc => 1º = mais recente
    if (((c.metadata as CF | null) ?? {}).ai_paused === true) continue;
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

    const sent = await deps.sendResponse(convId, message);
    if (!sent.success) { res.failed++; continue; } // não avança o estado; tenta de novo no próximo run

    const advanced = advanceState(state, now);
    await persistFollowup(supabase, deal.id as string, cf, advanced, advanced.stopped === true, (deal.tags as string[] | null) ?? []);
    res.processed++;
    if (wasReset) res.reset++;
  }

  return res;
}

async function persistFollowup(
  supabase: SupabaseClient, dealId: string, existingCf: CF, state: FollowupState, addTag: boolean, tags: string[] = []
): Promise<void> {
  const patch: CF = { custom_fields: { ...existingCf, followup: state }, updated_at: new Date().toISOString() };
  if (addTag) patch.tags = [...new Set([...tags, FOLLOWUP_TAG])];
  const { error } = await supabase.from('deals').update(patch).eq('id', dealId);
  if (error) console.error('[followup] persist falhou p/ deal', dealId, error);
}
