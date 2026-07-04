/**
 * UazAPI API Webhook Handler
 *
 * Recebe eventos da UazAPI API (mensagens, status, etc.) e processa:
 * - Mensagens recebidas → cria/atualiza conversa + insere mensagem
 * - Status updates → atualiza status da mensagem
 * - Connection updates → atualiza status do canal
 *
 * Rota:
 * - `POST /functions/v1/messaging-webhook-uazapi/<channel_id>`
 *
 * Autenticação:
 * - Header `x-api-key`/`apikey` OU query param `?key=` (a UAZAPI não manda headers
 *   customizados no webhook — autentica pela URL), verificado contra
 *   `UAZAPI_WEBHOOK_SECRET` (global) ou, se ausente, contra o `apiKey` nos
 *   credentials do canal. Nunca aceita sem auth (default-deny).
 *
 * Deploy:
 * - Esta função deve ser deployada com `--no-verify-jwt` pois recebe
 *   chamadas externas da UazAPI API sem JWT do Supabase.
 * - Exemplo: `supabase functions deploy messaging-webhook-uazapi --no-verify-jwt`
 */
import { createClient } from "npm:@supabase/supabase-js@2";

// =============================================================================
// TYPES
// =============================================================================

interface UazAPIMessageKey {
  remoteJid: string;
  id: string;
  fromMe: boolean;
}

interface UazAPIMessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string };
  audioMessage?: Record<string, unknown>;
  videoMessage?: { caption?: string };
  documentMessage?: { fileName?: string };
  stickerMessage?: Record<string, unknown>;
  locationMessage?: { degreesLatitude?: number; degreesLongitude?: number };
}

interface UazAPIMessageData {
  key: UazAPIMessageKey;
  pushName?: string;
  senderPn?: string;
  message?: UazAPIMessageContent;
  messageType?: string;
  messageTimestamp?: number;
}

interface UazAPIUpdateData {
  key: UazAPIMessageKey;
  update: { status?: number };
}

interface UazAPIUpsertPayload {
  event: "messages.upsert";
  instance: string;
  data: UazAPIMessageData;
}

interface UazAPIUpdatePayload {
  event: "messages.update";
  instance: string;
  data: UazAPIUpdateData[];
}

interface UazAPIConnectionUpdatePayload {
  event: "connection.update";
  instance: string;
  data: { state?: string };
}

type UazAPIPayload =
  | UazAPIUpsertPayload
  | UazAPIUpdatePayload
  | UazAPIConnectionUpdatePayload
  | { event: string; instance: string; data: unknown };

// =============================================================================
// HELPERS
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, apikey",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function getApiKeyFromRequest(req: Request, url: URL): string {
  const xApiKey = req.headers.get("x-api-key") || "";
  if (xApiKey.trim()) return xApiKey.trim();

  const apikey = req.headers.get("apikey") || "";
  if (apikey.trim()) return apikey.trim();

  // A UAZAPI não suporta headers customizados no webhook — ela autentica pela URL.
  // Aceitamos o segredo como query param (?key=...), comparado timing-safe como os headers.
  const urlKey = url.searchParams.get("key") || "";
  if (urlKey.trim()) return urlKey.trim();

  return "";
}

/**
 * Timing-safe string comparison to prevent timing oracle attacks on API key checks.
 * Falls back to constant-time XOR if subtle crypto is unavailable.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  // Length must match; pad shorter to length of longer with fixed byte
  const len = Math.max(aBytes.length, bBytes.length);
  const aPadded = new Uint8Array(len);
  const bPadded = new Uint8Array(len);
  aPadded.set(aBytes);
  bPadded.set(bBytes);
  try {
    // Import both as HMAC keys and compare — subtleCrypto provides constant-time
    const key = await crypto.subtle.importKey(
      "raw", aPadded, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, bPadded);
    const sigBytes = new Uint8Array(sig);
    // Verify: sign bPadded with key derived from aPadded, then check it's consistent
    // Simpler: XOR fallback is acceptable when lengths differ (already detected above)
    let result = aBytes.length === bBytes.length ? 0 : 1;
    for (let i = 0; i < len; i++) result |= (aPadded[i] ^ bPadded[i]);
    return result === 0 && sigBytes.length > 0;
  } catch {
    // Constant-time XOR fallback
    let result = aBytes.length === bBytes.length ? 0 : 1;
    for (let i = 0; i < len; i++) result |= (aPadded[i] ^ bPadded[i]);
    return result === 0;
  }
}

/**
 * Normalize remoteJid to a clean phone number.
 * Handles @s.whatsapp.net and @lid suffixes.
 * Falls back to senderPn when @lid is detected (UazAPI bug).
 */
function normalizeRemoteJid(remoteJid: string, senderPn?: string): string | null {
  if (!remoteJid) return null;
  // @lid bug: UazAPI às vezes retorna lid em vez do número real
  if (remoteJid.includes("@lid") && senderPn) {
    const digits = senderPn.replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  const phone = remoteJid.split("@")[0];
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

/**
 * Extract text preview from UazAPI API message by messageType.
 * Used only for last_message_preview (string field).
 */
function extractMessageText(data: UazAPIMessageData): string {
  const { messageType, message } = data;
  if (!message) return "[mensagem]";

  switch (messageType) {
    case "conversation":
      return message.conversation || "[mensagem]";
    case "extendedTextMessage":
      return message.extendedTextMessage?.text || "[mensagem]";
    case "imageMessage":
      return (message.imageMessage as Record<string, unknown>)?.caption as string || "[imagem]";
    case "audioMessage":
      return "[áudio]";
    case "videoMessage":
      return (message.videoMessage as Record<string, unknown>)?.caption as string || "[vídeo]";
    case "documentMessage":
      return (message.documentMessage as Record<string, unknown>)?.fileName as string || "[documento]";
    case "stickerMessage":
      return "[sticker]";
    case "locationMessage": {
      const lat = message.locationMessage?.degreesLatitude ?? 0;
      const lng = message.locationMessage?.degreesLongitude ?? 0;
      return `[localização: ${lat}, ${lng}]`;
    }
    default:
      return "[mensagem]";
  }
}

/**
 * Extract structured content from UazAPI API message by messageType.
 * Returns { contentType, content } to preserve the real media type.
 */
function extractMessageContent(data: UazAPIMessageData): { contentType: string; content: Record<string, unknown> } {
  const { messageType, message } = data;
  if (!message) return { contentType: "text", content: { type: "text", text: "[mensagem]" } };

  switch (messageType) {
    case "conversation":
      return { contentType: "text", content: { type: "text", text: message.conversation || "[mensagem]" } };
    case "extendedTextMessage":
      return { contentType: "text", content: { type: "text", text: message.extendedTextMessage?.text || "[mensagem]" } };
    case "imageMessage":
      return {
        contentType: "image",
        content: { type: "image", mediaUrl: "", caption: (message.imageMessage as Record<string, unknown>)?.caption as string },
      };
    case "audioMessage":
      return { contentType: "audio", content: { type: "audio", mediaUrl: "" } };
    case "videoMessage":
      return {
        contentType: "video",
        content: { type: "video", mediaUrl: "", caption: (message.videoMessage as Record<string, unknown>)?.caption as string },
      };
    case "documentMessage": {
      const doc = message.documentMessage as Record<string, unknown>;
      return { contentType: "document", content: { type: "document", mediaUrl: "", fileName: doc?.fileName as string } };
    }
    case "stickerMessage":
      return { contentType: "sticker", content: { type: "sticker", mediaUrl: "" } };
    case "locationMessage": {
      const loc = message.locationMessage as Record<string, unknown>;
      return {
        contentType: "location",
        content: { type: "location", latitude: loc?.degreesLatitude ?? 0, longitude: loc?.degreesLongitude ?? 0 },
      };
    }
    default:
      return { contentType: "text", content: { type: "text", text: `[${messageType || "mensagem"}]` } };
  }
}

/**
 * Map UazAPI API numeric status to internal string status.
 * 3 → sent, 4 → delivered, 5 → read
 */
function mapNumericStatus(status: number): string | null {
  const map: Record<number, string> = {
    3: "sent",
    4: "delivered",
    5: "read",
  };
  return map[status] ?? null;
}

/**
 * Generate stable event ID for audit logging and deduplication.
 * Produces unique, deterministic IDs per event type:
 * - messages.upsert: evo_msg_{messageId}
 * - messages.update: evo_status_{messageId}_{numericStatus}
 * - connection.update: evo_conn_{channelId}_{state}
 * - other: evo_{event}_{timestamp}
 */
function generateStableEventId(
  payload: UazAPIPayload,
  channelId: string,
  eventNorm: string
): string {
  if (eventNorm === "messages.upsert") {
    const data = (payload as UazAPIUpsertPayload).data;
    return `evo_msg_${data?.key?.id ?? Date.now()}`;
  }

  if (eventNorm === "messages.update") {
    const updates = (payload as UazAPIUpdatePayload).data;
    if (Array.isArray(updates) && updates.length > 0) {
      const first = updates[0];
      const status = first?.update?.status ?? "unknown";
      return `evo_status_${first?.key?.id ?? "unknown"}_${status}`;
    }
    return `evo_status_unknown_${Date.now()}`;
  }

  if (eventNorm === "connection.update") {
    const state = (payload as UazAPIConnectionUpdatePayload).data?.state ?? "unknown";
    return `evo_conn_${channelId}_${state}`;
  }

  // Fallback for unhandled events
  return `evo_${eventNorm.replace(/\./g, "_")}_${Date.now()}`;
}

/**
 * Determine event type string for audit logging.
 */
function determineEventType(eventNorm: string): string {
  return eventNorm || "unknown";
}

/**
 * Adapta o payload NATIVO da UAZAPI (formato { EventType, message, owner, ... })
 * para o formato interno estilo Evolution ({ event, instance, data.key... }).
 *
 * A UAZAPI real NÃO manda `event`/`data` — descoberto no cutover (2026-07-04):
 * o payload nativo derrubava a função com 500 antes mesmo da auditoria.
 * Campos observados em /message/find e /chat/find: message.chatid, message.text,
 * message.fromMe, message.messageType ("Conversation", "ExtendedTextMessage", ...),
 * message.messageTimestamp (em MILISSEGUNDOS), message.senderName, message.sender.
 */
function adaptUazapiNative(raw: Record<string, unknown>): UazAPIUpsertPayload | null {
  const m = raw?.message as Record<string, unknown> | undefined;
  if (!m || typeof m !== "object") return null;

  const chatid = String(m.chatid ?? m.remoteJid ?? "");
  if (!chatid) return null;

  const tsRaw = Number(m.messageTimestamp ?? 0);
  const tsSec = tsRaw > 1e12 ? Math.floor(tsRaw / 1000) : tsRaw;
  const text = String(m.text ?? (m.content as Record<string, unknown>)?.text ?? "");
  const mtypeRaw = String(m.messageType ?? "").toLowerCase();

  let messageType = "conversation";
  let message: UazAPIMessageContent = { conversation: text };
  if (mtypeRaw.includes("extendedtext")) {
    messageType = "extendedTextMessage";
    message = { extendedTextMessage: { text } };
  } else if (mtypeRaw.includes("image")) {
    messageType = "imageMessage";
    message = { imageMessage: { caption: String(m.caption ?? text) } };
  } else if (mtypeRaw.includes("audio") || mtypeRaw.includes("ptt")) {
    messageType = "audioMessage";
    message = { audioMessage: {} };
  } else if (mtypeRaw.includes("video")) {
    messageType = "videoMessage";
    message = { videoMessage: { caption: String(m.caption ?? text) } };
  } else if (mtypeRaw.includes("document")) {
    messageType = "documentMessage";
    message = { documentMessage: { fileName: String(m.fileName ?? m.filename ?? "") } };
  } else if (mtypeRaw.includes("sticker")) {
    messageType = "stickerMessage";
    message = { stickerMessage: {} };
  }

  return {
    event: "messages.upsert",
    instance: String(raw.owner ?? raw.instance ?? ""),
    data: {
      key: {
        remoteJid: chatid,
        id: String(m.messageid ?? m.id ?? `uaz_${Date.now()}`),
        fromMe: m.fromMe === true,
      },
      pushName: (m.senderName ?? m.pushName ?? m.notifyName) as string | undefined,
      senderPn: m.sender ? String(m.sender).split("@")[0] : undefined,
      message,
      messageType,
      messageTimestamp: tsSec || undefined,
    },
  };
}

/**
 * Trigger AI Agent processing for inbound message.
 * Fire-and-forget: errors are logged but don't fail the webhook.
 */
async function triggerAIProcessing(params: {
  supabase: ReturnType<typeof createClient>;
  conversationId: string;
  organizationId: string;
  messageText: string;
  messageId?: string;
}): Promise<void> {
  // Config preferida: organization_settings (handshake via banco — o runtime das
  // Edge Functions não tem os envs do Vercel). Env fica como fallback.
  let appUrl = Deno.env.get("APP_URL") || Deno.env.get("CRM_APP_URL") || "";
  let internalSecret = Deno.env.get("INTERNAL_API_SECRET") || "";

  const { data: orgSettings } = await params.supabase
    .from("organization_settings")
    .select("app_base_url, internal_api_secret")
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (orgSettings?.app_base_url) appUrl = orgSettings.app_base_url as string;
  if (orgSettings?.internal_api_secret) internalSecret = orgSettings.internal_api_secret as string;

  if (!appUrl || !internalSecret) {
    console.warn("[UazAPI] app_base_url/internal_api_secret ausentes (banco e env), skipping AI processing");
    return;
  }

  const endpoint = `${appUrl.replace(/\/$/, "")}/api/messaging/ai/process`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": internalSecret,
      },
      body: JSON.stringify({
        conversationId: params.conversationId,
        organizationId: params.organizationId,
        messageText: params.messageText,
        messageId: params.messageId,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[UazAPI] AI processing failed: ${response.status} ${text}`);
      return;
    }

    const result = await response.json();
    console.log("[UazAPI] AI processing result:", result);
  } catch (error) {
    console.error("[UazAPI] AI processing fetch error:", error);
  }
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Método não permitido" });
  }

  // Extract channelId from URL path (multi-tenant auth pattern)
  // Supports both /{channelId} and /{channelId}/{eventName} (webhookByEvents mode)
  const url = new URL(req.url);
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const channelId = url.pathname.match(uuidRegex)?.[0] ?? null;
  if (!channelId) {
    return json(400, { error: "channel_id ausente na URL" });
  }

  // Parse payload
  let payload: UazAPIPayload;
  try {
    payload = (await req.json()) as UazAPIPayload;
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  // Setup Supabase client
  const supabaseUrl =
    Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("CRM_SUPABASE_SECRET_KEY") ??
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "Supabase não configurado no runtime" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Fetch channel by ID (not by instance name — avoids attacker-controlled lookup)
  const { data: channel, error: channelErr } = await supabase
    .from("messaging_channels")
    .select("id, organization_id, business_unit_id, external_identifier, status, credentials")
    .eq("id", channelId)
    .in("status", ["connected", "active"])
    .maybeSingle();

  if (channelErr) {
    console.error("[UazAPI] Error fetching channel:", channelErr);
    return json(200, { ok: false, error: "Erro ao buscar canal" });
  }

  if (!channel) {
    return json(200, { ok: false, error: "Canal não encontrado" });
  }

  // Auth default-deny: try global UAZAPI_WEBHOOK_SECRET first,
  // then fall back to apiKey stored in channel credentials.
  // Never accept without auth.
  const webhookSecret =
    Deno.env.get("UAZAPI_WEBHOOK_SECRET") ??
    (channel.credentials as Record<string, string>)?.apiKey;
  const providedKey = getApiKeyFromRequest(req, url);

  if (!webhookSecret || !providedKey || !(await timingSafeEqual(providedKey, webhookSecret))) {
    return json(401, { error: "API key inválida" });
  }

  // Log instance name from payload (truncated to prevent log injection)
  const instanceName = (payload as { instance?: string }).instance ?? "";

  // Normalize event name. Aceita `event` (estilo Evolution) e `EventType` (UAZAPI nativo);
  // NUNCA deixa undefined derrubar a função (o 500 de 2026-07-04 morria aqui).
  const rawEvent =
    (payload as Record<string, unknown>).event ??
    (payload as Record<string, unknown>).EventType ??
    "";
  let eventNorm = String(rawEvent).toLowerCase().replace(/_/g, ".");

  // Payload nativo da UAZAPI ("messages" + message{}) → adapta pro formato interno.
  if ((eventNorm === "messages" || eventNorm === "messages.upsert") && !(payload as Record<string, unknown>).data) {
    const adapted = adaptUazapiNative(payload as Record<string, unknown>);
    if (adapted) {
      payload = adapted;
      eventNorm = "messages.upsert";
    }
  }
  // Nomes nativos → nomes internos (updates/conexão seguem só auditados por ora).
  if (eventNorm === "messages") eventNorm = "messages.upsert";

  // =========================================================================
  // AUDIT LOGGING & DEDUPLICATION
  // =========================================================================
  const externalEventId = generateStableEventId(payload, channelId, eventNorm);

  const { error: eventInsertErr } = await supabase
    .from("messaging_webhook_events")
    .insert({
      channel_id: channelId,
      event_type: determineEventType(eventNorm),
      external_event_id: externalEventId,
      payload: payload as unknown as Record<string, unknown>,
      processed: false,
    });

  // If duplicate (already processed), return early with success
  if (eventInsertErr?.message?.toLowerCase().includes("duplicate")) {
    console.log(`[UazAPI] Duplicate event ignored: ${externalEventId}`);
    return json(200, { ok: true, duplicate: true, event_id: externalEventId });
  }

  if (eventInsertErr) {
    // Log but don't fail — audit logging is best-effort
    console.error("[UazAPI] Error logging webhook event:", eventInsertErr);
  }

  try {
    if (eventNorm === "messages.upsert") {
      await handleMessagesUpsert(supabase, channel, payload as UazAPIUpsertPayload);
    } else if (eventNorm === "messages.update") {
      await handleMessagesUpdate(supabase, channel, payload as UazAPIUpdatePayload);
    } else if (eventNorm === "connection.update") {
      await handleConnectionUpdate(supabase, channel, payload as UazAPIConnectionUpdatePayload);
    } else {
      console.log(`[UazAPI] Unhandled event: ${payload.event} instance: ${instanceName.slice(0, 64)}`);
    }

    // Mark event as processed
    await supabase
      .from("messaging_webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("channel_id", channelId)
      .eq("external_event_id", externalEventId);

    return json(200, { ok: true, event: payload.event });
  } catch (error) {
    console.error("[UazAPI] Webhook processing error:", error);

    // Log error in webhook event
    await supabase
      .from("messaging_webhook_events")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      })
      .eq("channel_id", channelId)
      .eq("external_event_id", externalEventId);

    // Always return 200 to avoid retry storms
    return json(200, {
      ok: false,
      error: "Erro ao processar webhook",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// =============================================================================
// EVENT HANDLERS
// =============================================================================

async function handleMessagesUpsert(
  supabase: ReturnType<typeof createClient>,
  channel: {
    id: string;
    organization_id: string;
    business_unit_id: string;
    external_identifier: string;
  },
  payload: UazAPIUpsertPayload
) {
  const { data } = payload;

  const remoteJid = data.key.remoteJid;

  // Skip groups and broadcast — not supported for now
  if (remoteJid.includes("@g.us")) return;
  if (remoteJid === "status@broadcast") return;

  const isFromMe = data.key.fromMe === true;
  const direction = isFromMe ? "outbound" : "inbound";

  // Pass senderPn for @lid fallback (UazAPI bug workaround)
  const phone = normalizeRemoteJid(remoteJid, data.senderPn);
  if (!phone) {
    console.warn(`[UazAPI] Could not normalize remoteJid: ${remoteJid}`);
    return;
  }

  const externalMessageId = data.key.id;
  const { contentType, content } = extractMessageContent(data);
  const messageText = extractMessageText(data); // for last_message_preview only
  const pushName = data.pushName;
  const timestamp = data.messageTimestamp
    ? new Date(data.messageTimestamp * 1000)
    : new Date();

  // Find existing conversation
  const { data: existingConv, error: convFindErr } = await supabase
    .from("messaging_conversations")
    .select("id, contact_id")
    .eq("channel_id", channel.id)
    .eq("external_contact_id", phone)
    .maybeSingle();

  if (convFindErr) throw convFindErr;

  let conversationId: string;
  let contactId: string | null = null;

  if (existingConv) {
    conversationId = existingConv.id;
    contactId = existingConv.contact_id;
  } else {
    // Find or create contact
    const { data: existingContact, error: contactLookupErr } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", channel.organization_id)
      .eq("phone", phone)
      .is("deleted_at", null)
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (contactLookupErr) {
      console.error("[UazAPI] Error looking up existing contact:", contactLookupErr);
      throw contactLookupErr;
    }

    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const contactName = pushName || phone;

      const { data: newContact, error: contactCreateErr } = await supabase
        .from("contacts")
        .insert({
          organization_id: channel.organization_id,
          name: contactName,
          phone: phone,
          source: "whatsapp",
        })
        .select("id")
        .single();

      if (contactCreateErr) {
        console.error("[UazAPI] Error auto-creating contact:", contactCreateErr);
      } else {
        contactId = newContact.id;
        console.log(`[UazAPI] Auto-created contact: ${contactId} for phone ${phone}`);
      }
    }

    // Create conversation
    const { data: newConv, error: convCreateErr } = await supabase
      .from("messaging_conversations")
      .insert({
        organization_id: channel.organization_id,
        channel_id: channel.id,
        business_unit_id: channel.business_unit_id,
        external_contact_id: phone,
        external_contact_name: pushName || phone,
        contact_id: contactId,
        status: "open",
        priority: "normal",
      })
      .select("id")
      .single();

    if (convCreateErr) throw convCreateErr;
    conversationId = newConv.id;

    // Auto-create deal if lead routing rule exists
    if (contactId) {
      const routingRule = await getLeadRoutingRule(supabase, channel.id);
      if (routingRule) {
        await autoCreateDeal(supabase, {
          organizationId: channel.organization_id,
          contactId,
          boardId: routingRule.boardId,
          stageId: routingRule.stageId,
          conversationId,
          contactName: pushName || phone,
        });
      }
    }
  }

  // Insert message (inbound or outbound from WhatsApp app)
  // Preserve real content type instead of always saving as 'text'
  const { data: insertedMsg, error: msgErr } = await supabase
    .from("messaging_messages")
    .insert({
      conversation_id: conversationId,
      external_id: externalMessageId,
      direction,
      content_type: contentType,
      content,
      status: direction === "outbound" ? "sent" : "delivered",
      ...(direction === "outbound"
        ? { sent_at: timestamp.toISOString() }
        : { delivered_at: timestamp.toISOString() }),
      sender_name: isFromMe ? null : pushName,
      metadata: {
        uazapi_message_id: externalMessageId,
        message_type: data.messageType,
        timestamp: data.messageTimestamp,
      },
    })
    .select("id")
    .maybeSingle();

  if (msgErr) {
    if (!msgErr.message.toLowerCase().includes("duplicate")) {
      throw msgErr;
    }
    console.log(`[UazAPI] Duplicate message ignored: ${externalMessageId}`);
    return;
  }

  // Update conversation — only reopen (status: open) for inbound messages
  const { error: convUpdateErr } = await supabase
    .from("messaging_conversations")
    .update({
      last_message_at: timestamp.toISOString(),
      last_message_preview: messageText.slice(0, 100),
      last_message_direction: direction,
      ...(isFromMe ? {} : { status: "open" }),
    })
    .eq("id", conversationId);

  if (convUpdateErr) {
    console.error("[UazAPI] Failed to update conversation:", convUpdateErr, { conversationId });
  }

  // Only trigger AI for inbound text messages
  // insertedMsg.id is the internal UUID from the insert — never fall back to
  // externalMessageId (an UazAPI message key, not a UUID) or the AI endpoint
  // will reject the request silently.
  if (!isFromMe && contentType === "text" && insertedMsg?.id) {
    const textContent = content.text as string | undefined;
    if (textContent) {
      triggerAIProcessing({
        supabase,
        conversationId,
        organizationId: channel.organization_id,
        messageText: textContent,
        messageId: insertedMsg.id,
      }).catch((err) => {
        console.error("[UazAPI] AI processing trigger error:", err);
      });
    }
  }
}

async function handleMessagesUpdate(
  supabase: ReturnType<typeof createClient>,
  channel: { id: string },
  payload: UazAPIUpdatePayload
) {
  const updates = payload.data;
  if (!Array.isArray(updates)) return;

  for (const update of updates) {
    // Only process outbound message status updates
    if (!update.key.fromMe) continue;

    const externalId = update.key.id;
    const numericStatus = update.update?.status;
    if (numericStatus === undefined) continue;

    const newStatus = mapNumericStatus(numericStatus);
    if (!newStatus) {
      console.log(`[UazAPI] Unmapped status code: ${numericStatus} for ${externalId}`);
      continue;
    }

    // Scope update to this channel (tenant isolation — defense-in-depth beyond RLS)
    const { data: msgRow } = await supabase
      .from("messaging_messages")
      .select("id, messaging_conversations!inner(channel_id)")
      .eq("external_id", externalId)
      .eq("messaging_conversations.channel_id", channel.id)
      .maybeSingle();

    if (!msgRow) {
      console.log(`[UazAPI] Status update ignored: message ${externalId} not found in channel ${channel.id}`);
      continue;
    }

    const { error } = await supabase
      .from("messaging_messages")
      .update({
        status: newStatus,
        ...(newStatus === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
        ...(newStatus === "read" ? { read_at: new Date().toISOString() } : {}),
      })
      .eq("id", (msgRow as { id: string }).id);

    if (error) {
      console.error(`[UazAPI] Error updating status for ${externalId}:`, error);
    } else {
      console.log(`[UazAPI] Status updated: ${externalId} → ${newStatus}`);
    }
  }
}

async function handleConnectionUpdate(
  supabase: ReturnType<typeof createClient>,
  channel: { id: string; credentials: Record<string, string> },
  payload: UazAPIConnectionUpdatePayload
) {
  // "connecting" is intentionally omitted — writing it would break the channel
  // lookup (which only accepts "connected"/"active"), silently dropping all
  // subsequent webhooks until the status is manually fixed.
  const stateMap: Record<string, string> = {
    open: "connected",
    close: "disconnected",
  };

  const state = payload.data?.state;
  if (!state) return;

  const newStatus = stateMap[state];
  if (!newStatus) return;

  // When connecting, try to fetch the phone number from UazAPI API and save
  // it as settings.displayPhone so the UI can show it like Z-API does.
  const updatePayload: Record<string, unknown> = { status: newStatus };

  if (newStatus === "connected") {
    const phone = await fetchUazAPIPhone(channel.credentials);
    if (phone) {
      // Merge displayPhone into existing settings to avoid overwriting other fields
      const { data: current } = await supabase
        .from("messaging_channels")
        .select("settings")
        .eq("id", channel.id)
        .maybeSingle();
      updatePayload.settings = { ...(current?.settings ?? {}), displayPhone: phone };
      console.log(`[UazAPI] Fetched phone for channel ${channel.id}: ${phone}`);
    }
  }

  const { error } = await supabase
    .from("messaging_channels")
    .update(updatePayload)
    .eq("id", channel.id);

  if (error) {
    console.error("[UazAPI] Failed to update channel status:", error, { state, channelId: channel.id });
  } else {
    console.log(`[UazAPI] Channel ${channel.id} status → ${newStatus}`);
  }
}

/**
 * Fetch the WhatsApp phone number connected to an UazAPI instance.
 * Returns "+5521982219966" style string, or null on failure.
 */
async function fetchUazAPIPhone(
  credentials: Record<string, string>
): Promise<string | null> {
  const { serverUrl, apiKey, instanceName } = credentials;
  if (!serverUrl || !apiKey || !instanceName) return null;

  try {
    const res = await fetch(
      `${serverUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
      { headers: { apikey: apiKey } }
    );
    if (!res.ok) return null;

    const data = await res.json() as Array<{ ownerJid?: string; instance?: { owner?: string } }>;
    // UazAPI v2 uses ownerJid at root level; older versions use instance.owner
    const owner = data[0]?.ownerJid ?? data[0]?.instance?.owner; // e.g. "5521982219966@s.whatsapp.net"
    if (!owner) return null;

    const digits = owner.split("@")[0].replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  } catch {
    return null;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

async function getLeadRoutingRule(
  supabase: ReturnType<typeof createClient>,
  channelId: string
): Promise<{ boardId: string; stageId: string | null } | null> {
  const { data, error } = await supabase
    .from("lead_routing_rules")
    .select("board_id, stage_id, enabled")
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error) {
    console.error("[UazAPI] Error fetching lead routing rule:", error);
    return null;
  }

  if (!data || !data.enabled || !data.board_id) return null;

  return { boardId: data.board_id, stageId: data.stage_id };
}

async function autoCreateDeal(
  supabase: ReturnType<typeof createClient>,
  params: {
    organizationId: string;
    contactId: string;
    boardId: string;
    stageId?: string | null;
    conversationId: string;
    contactName: string;
  }
) {
  try {
    let stageId = params.stageId;

    if (!stageId) {
      const { data: firstStage, error: stageErr } = await supabase
        .from("board_stages")
        .select("id")
        .eq("board_id", params.boardId)
        .order("order", { ascending: true })
        .limit(1)
        .single();

      if (stageErr || !firstStage) {
        console.error("[UazAPI] Could not find first stage for auto-create deal:", stageErr);
        return;
      }
      stageId = firstStage.id;
    }

    const { data: newDeal, error: dealErr } = await supabase
      .from("deals")
      .insert({
        organization_id: params.organizationId,
        board_id: params.boardId,
        stage_id: stageId,
        contact_id: params.contactId,
        title: `${params.contactName} - WhatsApp`,
        value: 0,
      })
      .select("id")
      .single();

    if (dealErr) {
      console.error("[UazAPI] Error auto-creating deal:", dealErr);
      return;
    }

    console.log(`[UazAPI] Auto-created deal: ${newDeal.id} for contact ${params.contactId}`);

    // Update conversation metadata with deal reference — abort on read error
    // to avoid wiping existing JSONB data with a bad merge.
    const { data: conv, error: convMetaErr } = await supabase
      .from("messaging_conversations")
      .select("metadata")
      .eq("id", params.conversationId)
      .maybeSingle();

    if (convMetaErr) {
      console.error("[UazAPI] Failed to read conversation metadata:", convMetaErr);
      // Do not proceed with update to avoid losing existing metadata
      return;
    }

    const { error: metaUpdateErr } = await supabase
      .from("messaging_conversations")
      .update({
        metadata: {
          ...((conv?.metadata as Record<string, unknown>) || {}),
          deal_id: newDeal.id,
          auto_created_deal: true,
        },
      })
      .eq("id", params.conversationId);

    if (metaUpdateErr) {
      console.error("[UazAPI] Failed to update conversation metadata:", metaUpdateErr);
    }
  } catch (error) {
    console.error("[UazAPI] Unexpected error in autoCreateDeal:", error);
  }
}
