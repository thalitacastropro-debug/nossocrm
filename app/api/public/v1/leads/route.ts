import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { normalizeEmail, normalizePhone, normalizeText } from '@/lib/public-api/sanitize';
import { resolveBoardIdFromKey, resolveFirstStageId } from '@/lib/public-api/resolve';
import { sanitizeUUID } from '@/lib/supabase/utils';
import {
  montarBolhasDoPrimeiroToque,
  sendGreetingBubbles,
  mergeDealFirstTouch,
  jaHouveContato,
} from '@/lib/ai/lead-intake/envio-primeiro-toque';
import { seedTierFromLeadForm } from '@/lib/ai/extraction/domain/niva-health';
import { brPhoneVariants } from '@/lib/phone';

export const runtime = 'nodejs';
// O envio em bolhas com pequeno stagger pode levar alguns segundos — dá folga ao limite serverless.
export const maxDuration = 30;

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

// Horário comercial (seg–sex 08:00–17:30, timezone da org) — usado SÓ como informação
// (`within_business_hours` na resposta/registro do toque). NÃO é gate: a Ana engaja 24/7.
const BUSINESS_HOURS = { start: '08:00', end: '17:30', daysOfWeek: [1, 2, 3, 4, 5] };

// Campos de controle/roteamento — NÃO fazem parte dos "campos do formulário".
const CONTROL_KEYS = new Set([
  'name', 'nome', 'phone', 'telefone', 'email',
  'channel_id', 'board_id', 'board_key', 'stage_id',
  'source', 'title', 'greeting',
]);

// Schema permissivo (.passthrough()): o formulário é AGNÓSTICO — qualquer campo extra
// que vier é preservado e guardado em custom_fields.lead_form.
// Integrações (Make/n8n/Meta) às vezes mandam telefone como NÚMERO (sem aspas) ou
// null. Aceitamos número→string e tratamos null/undefined como ausente, pra não
// rejeitar o payload por um detalhe de tipagem do conector.
const looseString = z.preprocess(
  (v) => (v === null || v === undefined ? undefined : typeof v === 'number' ? String(v) : v),
  z.string().optional()
);

const LeadIntakeSchema = z
  .object({
    name: looseString,
    nome: looseString,
    phone: looseString,
    telefone: looseString,
    email: looseString,
    channel_id: z.string().uuid().optional(),
    board_id: z.string().uuid().optional(),
    board_key: z.string().min(1).optional(),
    stage_id: z.string().uuid().optional(),
    source: z.string().optional(),
    title: z.string().optional(),
    greeting: z.string().optional(),
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
  // Telefone casa pelas VARIANTES do 9º dígito: o form do Meta manda o celular COM o 9
  // e o JID do WhatsApp (DDD > 30) manda sem. Igualdade exata duplicava a MESMA pessoa em
  // dois contatos/deals/conversas — casos Ruberleide (DDD 66) e Robson (DDD 65).
  // Ver `brPhoneVariants` em lib/phone.ts. A GRAVAÇÃO segue usando o telefone recebido.
  const phoneVariants = brPhoneVariants(phone);
  if (email && phoneVariants.length) {
    lookup = lookup.or(`email.eq.${email},phone.in.(${phoneVariants.join(',')})`);
  } else if (email) {
    lookup = lookup.eq('email', email);
  } else if (phoneVariants.length) {
    lookup = lookup.in('phone', phoneVariants);
  } else {
    lookup = lookup.eq('phone', phone as string);
  }

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
    // Detalha QUAL campo falhou (ex.: "channel_id: Invalid uuid") — sem isso, o
    // integrador (Make/n8n) só via "Invalid payload" e ficava no escuro.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`);
    return NextResponse.json(
      { error: 'Invalid payload', code: 'VALIDATION_ERROR', issues },
      { status: 422 }
    );
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
    // Só conta como tocado o 1º toque que SAIU (ou que outro contato já superou). Era
    // `Boolean(prevLeadForm.first_touch)`: a CHAVE existir bastava, inclusive com status
    // 'failed' — e o lead cujo 1º toque falhou ficava "tocado" para sempre (giani e Flávia
    // Muniz, WhatsApp fora de 06 a 08/10). Ver lib/ai/lead-intake/envio-primeiro-toque.ts.
    const statusAnterior = (prevLeadForm.first_touch as { status?: string } | undefined)?.status;
    alreadyTouched = statusAnterior === 'greeted' || statusAnterior === 'superado';
    await sb
      .from('deals')
      .update({
        custom_fields: { ...prevCustom, lead_form: { ...prevLeadForm, ...leadFormBase } },
        updated_at: now,
      })
      .eq('id', dealId);
  } else {
    const title = normalizeText(body.title ?? null) || `${name || phone} — Lead Meta Ads`;
    // Tier PROVISÓRIO já na criação (CNPJ + idades + valor do formulário) → o card nasce com selo
    // em vez de "layout antigo sem tier". Só grava quando dá pra cravar ouro/prata/bronze; sem
    // dados suficientes, não grava (a Ana recomputa na conversa). Ver seedTierFromLeadForm.
    const seededTier = seedTierFromLeadForm({ lead_form: leadFormBase });
    const initialCustomFields: Record<string, unknown> = { lead_form: leadFormBase };
    if (seededTier) initialCustomFields.tier = seededTier;
    const { data: newDeal, error: dealErr } = await sb
      .from('deals')
      .insert({
        organization_id: auth.organizationId,
        title,
        value: 0,
        board_id: boardId,
        stage_id: stageId,
        contact_id: contactId,
        custom_fields: initialCustomFields,
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
    // Contato DE VERDADE, não `message_count > 0`: a tentativa falhada também grava mensagem, e
    // contá-la era a segunda metade do mesmo buraco.
    if (await jaHouveContato(sb, conversationId)) alreadyTouched = true;
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

  // 8. Saudação em bolhas. A Ana engaja 24/7 — o MESMO opener imediato a qualquer hora/dia.
  //    `withinHours` fica só como informação (analytics / registro do toque), não gate.
  //    1º toque INTELIGENTE: a IA lê o lead_form e NÃO re-pergunta o que já sabe.
  //    Prioridade: override do body (`greeting`) > opener da IA > DEFAULT_GREETING fixo.
  const timezone = await getOrgTimezone(sb, auth.organizationId);
  const withinHours = isWithinBusinessHours(timezone);

  // Montagem e envio moram em lib/ai/lead-intake/envio-primeiro-toque.ts — o MESMO código que o
  // cron usa para tentar de novo um 1º toque que falhou.
  const bubbles = await montarBolhasDoPrimeiroToque({
    supabase: sb,
    organizationId: auth.organizationId,
    boardId,
    firstName: name,
    leadForm: leadFormBase,
    greeting: body.greeting,
  });
  const touchStatus = 'greeted';

  // 9. Enviar a saudação em BOLHAS (várias mensagens curtas, estilo WhatsApp)
  const send = await sendGreetingBubbles({
    conversationId,
    channelId,
    to: phone,
    bubbles,
  });

  // 10. Registrar o resultado do toque no deal. 'failed' NÃO é o fim: o cron de follow-up
  //     (a cada 15 min, dentro da janela da Ana) tenta de novo — ver retentarPrimeirosToques.
  await mergeDealFirstTouch(sb, dealId, {
    status: send.success ? touchStatus : 'failed',
    within_business_hours: withinHours,
    message_id: send.messageId ?? null,
    sent_at: send.success ? new Date().toISOString() : null,
    error: send.error?.message ?? null,
    tentativas: 1,
    ultima_tentativa_em: new Date().toISOString(),
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
