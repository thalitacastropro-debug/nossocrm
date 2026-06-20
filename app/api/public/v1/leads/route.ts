import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { normalizeEmail, normalizePhone, normalizeText } from '@/lib/public-api/sanitize';
import { resolveBoardIdFromKey, resolveFirstStageId } from '@/lib/public-api/resolve';
import { sanitizeUUID } from '@/lib/supabase/utils';
import { getChannelRouter } from '@/lib/messaging/channel-router.service';

export const runtime = 'nodejs';

/**
 * @fileoverview Lead Intake (form-agnóstico) — entrada de leads de anúncio.
 *
 * Recebe um lead de fonte externa (Meta Lead Ads via Make hoje; Meta direto depois),
 * cria/atualiza contato + deal no board SDR, guarda TODOS os campos do formulário num
 * jsonb (`deals.custom_fields.lead_form`) para a Ana ler, pré-cria a conversa de
 * mensageria (para aparecer no Inbox e dar contexto à Ana) e dispara a 1ª mensagem
 * via WhatsApp (UazAPI) com lógica de horário.
 *
 * POR QUE PRÉ-CRIAR A CONVERSA: o `external_contact_id` é o telefone em E.164 (mesma
 * normalização do webhook de inbound `messaging-webhook-uazapi`). Assim, quando o lead
 * responder, o webhook encontra ESTA conversa (UNIQUE channel_id+external_contact_id) e
 * NÃO cria deal/conversa duplicados — e a Ana acha o deal via `metadata.deal_id`.
 *
 * Auth: header `X-API-Key` (`ncrm_...`), igual às demais rotas públicas.
 *
 * Config por env (com fallback para body / lead_routing_rules):
 *   - LEAD_INTAKE_CHANNEL_ID  → canal de mensageria de saída (UazAPI)
 *   - LEAD_INTAKE_BOARD_ID / LEAD_INTAKE_STAGE_ID → destino do deal (fallback)
 *
 * @module app/api/public/v1/leads/route
 */

// Horário comercial (replica a regra do DataCrazy): seg–sex 08:00–17:30 (timezone da org).
const BUSINESS_HOURS = { start: '08:00', end: '17:30', daysOfWeek: [1, 2, 3, 4, 5] };

// Greetings padrão (PLACEHOLDERS). O ideal é o chamador (Make) enviar os templates
// aprovados pela Niva em `greeting_in_hours` / `greeting_after_hours`. Suportam {nome}.
const DEFAULT_GREETING_IN_HOURS =
  'Oi {nome}, tudo bem? Aqui é da Niva 👋 Recebi seus dados e já te ajudo por aqui.';
const DEFAULT_GREETING_AFTER_HOURS =
  'Oi {nome}, tudo bem? Aqui é da Niva 👋 Recebi seus dados! Nosso atendimento já encerrou por hoje, mas amanhã cedo eu te retorno por aqui, combinado?';

// Campos de controle/roteamento — NÃO fazem parte dos "campos do formulário".
const CONTROL_KEYS = new Set([
  'name', 'nome', 'phone', 'telefone', 'email',
  'channel_id', 'board_id', 'board_key', 'stage_id',
  'source', 'title', 'greeting_in_hours', 'greeting_after_hours',
]);

// Schema permissivo (.passthrough()): o formulário é AGNÓSTICO — qualquer campo extra
// que vier é preservado e guardado em custom_fields.lead_form.
const LeadIntakeSchema = z
  .object({
    name: z.string().optional(),
    nome: z.string().optional(),
    phone: z.string().optional(),
    telefone: z.string().optional(),
    email: z.string().optional(),
    channel_id: z.string().uuid().optional(),
    board_id: z.string().uuid().optional(),
    board_key: z.string().min(1).optional(),
    stage_id: z.string().uuid().optional(),
    source: z.string().optional(),
    title: z.string().optional(),
    greeting_in_hours: z.string().optional(),
    greeting_after_hours: z.string().optional(),
  })
  .passthrough();

/**
 * Verifica se AGORA está dentro do horário comercial no timezone informado.
 * Mesma técnica do agente nativo (Intl.DateTimeFormat por timezone).
 */
function isWithinBusinessHours(timezone: string): boolean {
  try {
    const now = new Date();

    const dayStr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const currentDay = dayMap[dayStr] ?? now.getUTCDay();
    if (!BUSINESS_HOURS.daysOfWeek.includes(currentDay)) return false;

    const [hourStr, minuteStr] = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(now)
      .split(':');
    const currentMinutes = parseInt(hourStr) * 60 + parseInt(minuteStr);

    const [sH, sM] = BUSINESS_HOURS.start.split(':').map(Number);
    const [eH, eM] = BUSINESS_HOURS.end.split(':').map(Number);
    return currentMinutes >= sH * 60 + sM && currentMinutes <= eH * 60 + eM;
  } catch {
    return true; // em caso de erro de timezone, não bloqueia o atendimento
  }
}

/** Interpola {nome} (primeiro nome) e limpa pontuação órfã quando não há nome. */
function renderGreeting(template: string, name: string | null): string {
  const firstName = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return template
    .replaceAll('{nome}', firstName)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,!?.])/g, '$1')
    .trim();
}

/** Upsert de contato por email/telefone (mesma estratégia da rota /deals). */
async function upsertContact(opts: {
  organizationId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
}): Promise<string> {
  const sb = createStaticAdminClient();
  const { organizationId, name, email, phone, source } = opts;
  if (!email && !phone) throw new Error('Informe email ou telefone');

  let lookup = sb
    .from('contacts')
    .select('id')
    .eq('organization_id', organizationId)
    .is('deleted_at', null);
  if (email && phone) lookup = lookup.or(`email.eq.${email},phone.eq.${phone}`);
  else if (email) lookup = lookup.eq('email', email);
  else lookup = lookup.eq('phone', phone as string);

  const existing = await lookup.order('created_at').limit(1).maybeSingle();
  if (existing.error) throw existing.error;

  const now = new Date().toISOString();

  if (existing.data?.id) {
    const update: Record<string, unknown> = { updated_at: now };
    if (name) update.name = name;
    if (email) update.email = email;
    if (phone) update.phone = phone;
    const { error } = await sb.from('contacts').update(update).eq('id', existing.data.id);
    if (error) throw error;
    return existing.data.id as string;
  }

  if (!name && !phone) throw new Error('Nome obrigatório para criar contato novo');
  const { data, error } = await sb
    .from('contacts')
    .insert({
      organization_id: organizationId,
      name: name || (phone as string),
      email,
      phone,
      source: source || 'meta_lead_ads',
      status: 'ACTIVE',
      stage: 'LEAD',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function POST(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const rawBody = await request.json().catch(() => null);
  const parsed = LeadIntakeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  const body = parsed.data;

  const sb = createStaticAdminClient();

  // 1. Resolver canal (body → env)
  const channelId = sanitizeUUID(body.channel_id) || sanitizeUUID(process.env.LEAD_INTAKE_CHANNEL_ID);
  if (!channelId) {
    return NextResponse.json(
      { error: 'Informe channel_id (ou configure LEAD_INTAKE_CHANNEL_ID)', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  const { data: channel, error: channelErr } = await sb
    .from('messaging_channels')
    .select('id, organization_id, business_unit_id, status')
    .eq('id', channelId)
    .is('deleted_at', null)
    .maybeSingle();
  if (channelErr || !channel) {
    return NextResponse.json({ error: 'Canal não encontrado', code: 'CHANNEL_NOT_FOUND' }, { status: 404 });
  }
  if (channel.organization_id !== auth.organizationId) {
    return NextResponse.json({ error: 'Canal não pertence à organização', code: 'FORBIDDEN' }, { status: 403 });
  }

  // 2. Dados do lead
  const name = normalizeText(body.name ?? body.nome ?? null);
  const email = normalizeEmail(body.email ?? null);
  const phone = normalizePhone(body.phone ?? body.telefone ?? null); // E.164 — bate com o webhook
  const source = normalizeText(body.source ?? null) || 'meta_lead_ads';
  if (!phone) {
    return NextResponse.json(
      { error: 'telefone (phone) é obrigatório para enviar a 1ª mensagem', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  // 3. Resolver board/stage: body → lead_routing_rules(canal) → env
  let boardId = sanitizeUUID(body.board_id);
  let stageId = sanitizeUUID(body.stage_id);
  if (!boardId && body.board_key) {
    boardId = await resolveBoardIdFromKey({ organizationId: auth.organizationId, boardKey: body.board_key });
  }
  if (!boardId) {
    const { data: rule } = await sb
      .from('lead_routing_rules')
      .select('board_id, stage_id, enabled')
      .eq('channel_id', channelId)
      .maybeSingle();
    if (rule?.enabled && rule.board_id) {
      boardId = rule.board_id;
      if (!stageId) stageId = rule.stage_id || null;
    }
  }
  if (!boardId) boardId = sanitizeUUID(process.env.LEAD_INTAKE_BOARD_ID);
  if (!stageId) stageId = sanitizeUUID(process.env.LEAD_INTAKE_STAGE_ID);
  if (!boardId) {
    return NextResponse.json(
      { error: 'Não foi possível resolver o board (informe board_id/board_key, configure lead_routing_rules ou LEAD_INTAKE_BOARD_ID)', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }
  if (!stageId) {
    stageId = await resolveFirstStageId({ organizationId: auth.organizationId, boardId });
  }
  if (!stageId) {
    return NextResponse.json({ error: 'Board sem estágios', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  // 4. Upsert contato
  let contactId: string;
  try {
    contactId = await upsertContact({ organizationId: auth.organizationId, name, email, phone, source });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Contato inválido', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  const now = new Date().toISOString();

  // Snapshot do formulário (form-agnóstico): guarda o body inteiro, sem as chaves de controle.
  const formFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!CONTROL_KEYS.has(k)) formFields[k] = v;
  }
  const leadFormBase = {
    source,
    received_at: now,
    mapped: { name, email, phone },
    fields: formFields,
    raw: rawBody,
  };

  // 5. Find-or-create deal (idempotente: reusa deal ABERTO do contato no board)
  const { data: existingDeal } = await sb
    .from('deals')
    .select('id, custom_fields')
    .eq('organization_id', auth.organizationId)
    .eq('board_id', boardId)
    .eq('contact_id', contactId)
    .eq('is_won', false)
    .eq('is_lost', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let dealId: string;
  let alreadyTouched = false;
  if (existingDeal?.id) {
    dealId = existingDeal.id;
    const prevCustom = (existingDeal.custom_fields as Record<string, unknown>) || {};
    const prevLeadForm = (prevCustom.lead_form as Record<string, unknown>) || {};
    alreadyTouched = Boolean(prevLeadForm.first_touch);
    await sb
      .from('deals')
      .update({
        custom_fields: { ...prevCustom, lead_form: { ...prevLeadForm, ...leadFormBase } },
        updated_at: now,
      })
      .eq('id', dealId);
  } else {
    const title = normalizeText(body.title ?? null) || `${name || phone} — Lead Meta Ads`;
    const { data: newDeal, error: dealErr } = await sb
      .from('deals')
      .insert({
        organization_id: auth.organizationId,
        title,
        value: 0,
        board_id: boardId,
        stage_id: stageId,
        contact_id: contactId,
        custom_fields: { lead_form: leadFormBase },
        is_won: false,
        is_lost: false,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();
    if (dealErr) {
      console.error('[LeadIntake] deal insert error:', dealErr);
      return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
    }
    dealId = newDeal.id;
  }

  // 6. Find-or-create conversa (UNIQUE channel_id + external_contact_id). external_contact_id
  //    = telefone E.164, idêntico ao webhook → evita conversa/deal duplicados na resposta.
  const { data: existingConv } = await sb
    .from('messaging_conversations')
    .select('id, metadata, message_count')
    .eq('channel_id', channelId)
    .eq('external_contact_id', phone)
    .maybeSingle();

  let conversationId: string;
  if (existingConv?.id) {
    conversationId = existingConv.id;
    const prevMeta = (existingConv.metadata as Record<string, unknown>) || {};
    if (prevMeta.deal_id !== dealId || !prevMeta.contact_id) {
      await sb
        .from('messaging_conversations')
        .update({ metadata: { ...prevMeta, deal_id: dealId, lead_source: source }, contact_id: contactId })
        .eq('id', conversationId);
    }
    if ((existingConv.message_count ?? 0) > 0) alreadyTouched = true;
  } else {
    const { data: newConv, error: convErr } = await sb
      .from('messaging_conversations')
      .insert({
        organization_id: auth.organizationId,
        channel_id: channelId,
        business_unit_id: channel.business_unit_id,
        external_contact_id: phone,
        external_contact_name: name || phone,
        contact_id: contactId,
        status: 'open',
        priority: 'normal',
        metadata: { deal_id: dealId, lead_source: source },
      })
      .select('id')
      .single();
    if (convErr) {
      console.error('[LeadIntake] conversation insert error:', convErr);
      return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
    }
    conversationId = newConv.id;
  }

  // 7. 1ª mensagem (idempotente: não reenvia se já houve toque)
  if (alreadyTouched) {
    return NextResponse.json(
      {
        data: { deal_id: dealId, contact_id: contactId, conversation_id: conversationId },
        first_touch: 'skipped_already_touched',
        action: existingDeal?.id ? 'updated' : 'created',
      },
      { status: existingDeal?.id ? 200 : 201 },
    );
  }

  // 8. Lógica de horário → escolhe a saudação e o status do toque
  const timezone = await getOrgTimezone(sb, auth.organizationId);
  const withinHours = isWithinBusinessHours(timezone);
  const template = withinHours
    ? body.greeting_in_hours || DEFAULT_GREETING_IN_HOURS
    : body.greeting_after_hours || DEFAULT_GREETING_AFTER_HOURS;
  const greeting = renderGreeting(template, name);
  const touchStatus = withinHours ? 'greeted' : 'acked_after_hours';

  // 9. Enviar 1ª mensagem (mesmo padrão do agente: insert outbound → router → update)
  const send = await sendFirstMessage({
    conversationId,
    channelId,
    to: phone,
    text: greeting,
  });

  // 10. Registrar o resultado do toque no deal (para o cron de follow-up de manhã)
  await mergeDealFirstTouch(sb, dealId, {
    status: send.success ? touchStatus : 'failed',
    within_business_hours: withinHours,
    message_id: send.messageId ?? null,
    sent_at: send.success ? new Date().toISOString() : null,
    error: send.error?.message ?? null,
  });

  return NextResponse.json(
    {
      data: {
        deal_id: dealId,
        contact_id: contactId,
        conversation_id: conversationId,
        message_id: send.messageId ?? null,
      },
      first_touch: {
        sent: send.success,
        within_business_hours: withinHours,
        status: send.success ? touchStatus : 'failed',
        error: send.error?.message ?? null,
      },
      action: existingDeal?.id ? 'updated' : 'created',
    },
    // 201 mesmo se o envio falhar: os registros foram criados; evita retry-spam do Make.
    { status: existingDeal?.id ? 200 : 201 },
  );
}

/** Busca o timezone da organização (default America/Sao_Paulo). */
async function getOrgTimezone(
  sb: ReturnType<typeof createStaticAdminClient>,
  organizationId: string,
): Promise<string> {
  const { data } = await sb
    .from('organization_settings')
    .select('timezone')
    .eq('organization_id', organizationId)
    .maybeSingle();
  return data?.timezone || 'America/Sao_Paulo';
}

/** Mescla o resultado do 1º toque em custom_fields.lead_form.first_touch (sem sobrescrever o resto). */
async function mergeDealFirstTouch(
  sb: ReturnType<typeof createStaticAdminClient>,
  dealId: string,
  firstTouch: Record<string, unknown>,
): Promise<void> {
  const { data } = await sb.from('deals').select('custom_fields').eq('id', dealId).maybeSingle();
  const custom = (data?.custom_fields as Record<string, unknown>) || {};
  const leadForm = (custom.lead_form as Record<string, unknown>) || {};
  await sb
    .from('deals')
    .update({
      custom_fields: { ...custom, lead_form: { ...leadForm, first_touch: firstTouch } },
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);
}

interface SendResult {
  success: boolean;
  messageId?: string;
  error?: { code: string; message: string };
}

/**
 * Insere a mensagem outbound e a envia pelo ChannelRouter — mesmo fluxo de
 * `sendAIResponse` (lib/ai/agent/agent.service.ts). sender_type 'ai' + sent_by_ai:true
 * faz a Ana enxergar a própria saudação (não re-cumprimenta) no histórico.
 */
async function sendFirstMessage(params: {
  conversationId: string;
  channelId: string;
  to: string;
  text: string;
}): Promise<SendResult> {
  const { conversationId, channelId, to, text } = params;
  const sb = createStaticAdminClient();

  const { data: message, error: insertError } = await sb
    .from('messaging_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      content_type: 'text',
      content: { type: 'text', text },
      status: 'pending',
      sender_type: 'ai',
      metadata: { sent_by_ai: true, source: 'lead_intake', first_touch: true },
    })
    .select('id')
    .single();
  if (insertError) {
    return { success: false, error: { code: 'INSERT_FAILED', message: insertError.message } };
  }

  try {
    const router = getChannelRouter();
    const result = await router.sendMessage(channelId, {
      conversationId,
      to,
      content: { type: 'text', text },
    });

    if (result.success) {
      await sb
        .from('messaging_messages')
        .update({ external_id: result.externalMessageId, status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', message.id);
      return { success: true, messageId: message.id };
    }

    await sb
      .from('messaging_messages')
      .update({
        status: 'failed',
        error_code: result.error?.code || 'SEND_FAILED',
        error_message: result.error?.message || 'Unknown error',
        failed_at: new Date().toISOString(),
      })
      .eq('id', message.id);
    return {
      success: false,
      messageId: message.id,
      error: { code: result.error?.code || 'SEND_FAILED', message: result.error?.message || 'Falha ao enviar' },
    };
  } catch (error) {
    await sb
      .from('messaging_messages')
      .update({
        status: 'failed',
        error_code: 'PROVIDER_ERROR',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        failed_at: new Date().toISOString(),
      })
      .eq('id', message.id);
    return {
      success: false,
      messageId: message.id,
      error: { code: 'PROVIDER_ERROR', message: error instanceof Error ? error.message : 'Erro ao enviar' },
    };
  }
}
