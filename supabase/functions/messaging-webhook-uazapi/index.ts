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
/**
 * Normaliza o id de mensagem da UazAPI pra forma PURA (sem o prefixo do
 * remetente, ex.: "5511988209448:3EB0..." → "3EB0..."). O provider do lado do
 * app já guarda o id puro; aplicar aqui também deixa o dedup SIMÉTRICO e robusto
 * caso a UazAPI passe a mandar o eco/status com o id prefixado. Hoje o eco vem
 * puro, então isto é um no-op defensivo. Espelha normalizeUazApiMessageId do
 * provider (lib/messaging/providers/whatsapp/uazapi.provider.ts).
 */
function normalizeExternalMessageId(id: string): string {
  const m = id.match(/^\d+:(.+)$/);
  return m ? m[1] : id;
}

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
 * Formas EQUIVALENTES de um celular brasileiro por causa do 9º dígito.
 *
 * O JID do WhatsApp para DDD > 30 chega SEM o 9 do celular, enquanto o formulário
 * do Meta traz COM. Como o lookup de conversa (`external_contact_id`) e o de contato
 * (`phone`) eram igualdade EXATA, a mesma pessoa virava duas conversas, dois contatos
 * e dois deals — a Ana atendia num card sem o formulário (que estava no outro) e a
 * cadência de follow-up rodava sozinha no card órfão. Casos reais: Ruberleide Petry
 * Odahara (DDD 66) e Robson Carlos Alves (DDD 65).
 *
 * ESPELHA `brPhoneVariants` de lib/phone.ts (esta função roda em Deno e não consegue
 * importar do app) — mesmo padrão já usado em `normalizeExternalMessageId`.
 * Se mudar aqui, mude lá, e vice-versa. Os testes vivem em lib/phone.test.ts.
 *
 * Só LOOKUP. A gravação continua usando o telefone que chegou no evento.
 */
function brPhoneVariants(e164: string): string[] {
  if (!e164) return [];
  const variants = [e164];

  const br = e164.match(/^\+55(\d{2})(\d{8,9})$/);
  if (!br) return variants; // não é BR ou tamanho fora do padrão

  const ddd = br[1];
  const subscriber = br[2];

  if (subscriber.length === 9) {
    // Celular com o 9 → gera a forma antiga (como o WhatsApp costuma mandar).
    if (subscriber.startsWith("9")) variants.push(`+55${ddd}${subscriber.slice(1)}`);
  } else if (/^[6-9]/.test(subscriber)) {
    // 8 dígitos começando em 6–9 = celular antigo → gera a forma com o 9.
    // Fixo (2–5) NÃO ganha variante: viraria o número de outra pessoa.
    variants.push(`+55${ddd}9${subscriber}`);
  }

  return variants;
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
/**
 * Monta a parte de mídia do `content` a partir do que o adaptador preservou.
 *
 * `mediaUrl` é o campo que o player do CRM lê (`MessageBubble`): ele já está
 * pronto — waveform, play/pause, seek — e só fica desabilitado porque a URL vem
 * vazia. Se a UAZAPI mandar a URL no webhook, o áudio passa a tocar sem mais
 * nenhuma mudança de código. Se não mandar, `_camposRecebidos` diz o que ela
 * manda de fato, e é por ali que o download será implementado.
 */
function conteudoDeMidia(obj: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!obj) return { mediaUrl: "" };

  // `content` pode ser a própria URL (string) ou um objeto com ela dentro — foi o
  // campo que sobrou no payload real do áudio de 25/08.
  const doContent = typeof obj.content === "string"
    ? obj.content
    : (obj.content as Record<string, unknown> | undefined)?.url
      ?? (obj.content as Record<string, unknown> | undefined)?.mediaUrl;

  const url = obj.mediaUrl ?? obj.mediaurl ?? obj.url ?? obj.fileURL ?? obj.fileUrl ??
    obj.downloadUrl ?? doContent;

  // Só aceita como mídia o que REALMENTE parece um endereço de arquivo: `content`
  // de mensagem de texto guarda o texto, e ele não pode virar `mediaUrl`.
  const ehEndereco = typeof url === "string" && /^(https?:)?\/\//.test(url);

  const out: Record<string, unknown> = {
    mediaUrl: ehEndereco ? url : "",
  };

  if (obj.mediaType) out.mediaType = obj.mediaType;

  if (obj.mimetype || obj.mimeType) out.mimeType = obj.mimetype ?? obj.mimeType;
  if (obj.seconds) out.seconds = obj.seconds;
  if (obj.fileLength) out.fileLength = obj.fileLength;

  // Trilha de diagnóstico — some quando o download definitivo estiver no ar.
  if (obj._camposRecebidos) out._camposRecebidos = obj._camposRecebidos;
  if (obj._chavesDoPayload) out._chavesDoPayload = obj._chavesDoPayload;

  return out;
}

/** Tipos de conteúdo que têm arquivo para baixar. */
const CONTEUDOS_COM_ARQUIVO = new Set(["audio", "image", "video", "document", "sticker"]);

const EXTENSAO_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

/**
 * Baixa o arquivo da mídia na UAZAPI e guarda no Storage.
 *
 * **Por que existe:** o webhook da UAZAPI não manda o arquivo — provado com os
 * áudios de teste da Thalita em 25/08/2026: vêm `id`, `content` e
 * `mediaType: "ptt"`, e nenhuma URL nem base64. Sem baixar, o player fica mudo e
 * o consultor não ouve o próprio histórico (137 mídias assim no banco).
 *
 * **Como:** tenta os endpoints prováveis de download em sequência e aceita as
 * três formas de resposta que essas APIs usam — binário direto, JSON com URL, ou
 * JSON com base64. O que der certo vira arquivo no bucket `messaging-media`
 * (privado) e uma URL assinada em `mediaUrl`, que é o campo que o player lê.
 *
 * **À prova de falha:** qualquer erro aqui devolve o content original. Mídia sem
 * arquivo é o que já acontecia; derrubar o webhook por causa dela seria pior — é
 * o mesmo caminho por onde passam as mensagens de texto da Ana.
 *
 * O campo `_download` registra o que aconteceu em cada tentativa: é o que dirá,
 * sem outro deploy, qual endpoint a UAZAPI aceita.
 */
async function baixarEGuardarMidia(
  supabase: ReturnType<typeof createClient>,
  credenciais: Record<string, string> | undefined,
  contentType: string,
  conteudoOriginal: Record<string, unknown>,
  ctx: { organizationId: string; conversationId: string; messageId: string },
): Promise<Record<string, unknown>> {
  let content = conteudoOriginal;
  if (!CONTEUDOS_COM_ARQUIVO.has(contentType)) return content;
  if (content.mediaUrl) return content; // já veio pronta

  const serverUrl = String(credenciais?.serverUrl ?? "").replace(/\/$/, "");
  const token = credenciais?.apiKey;
  const id = content.id ?? content.messageid ?? ctx.messageId;
  if (!serverUrl || !token || !id) {
    return { ...content, _download: "sem servidor, token ou id" };
  }

  // Contrato lido na documentação oficial em 25/08/2026
  // (docs.uazapi.com/endpoint/post/message~download):
  //   POST /message/download { id, return_base64?, generate_mp3?, return_link?,
  //                            transcribe?, openai_apikey?, download_quoted? }
  //   -> { fileURL, mimetype, base64Data, transcription }
  //
  // `generate_mp3: true` (o padrão da UAZAPI) é o que queremos: MP3 toca em
  // qualquer navegador; OGG do WhatsApp não toca em todos.
  // `transcribe` fica de fora: exige chave da OpenAI, e a Niva usa Google e
  // Anthropic. É o caminho para a Ana ENTENDER áudio — anotado no roadmap.
  const tentativas: Array<{ rota: string; body: Record<string, unknown> }> = [
    { rota: "/message/download", body: { id, generate_mp3: true, return_link: true } },
    { rota: "/message/download", body: { id, return_base64: true, return_link: false } },
  ];

  const diario: string[] = [];

  for (const { rota, body } of tentativas) {
    try {
      const res = await fetch(`${serverUrl}${rota}`, {
        method: "POST",
        headers: { "content-type": "application/json", token },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        diario.push(`${rota} -> HTTP ${res.status}`);
        continue;
      }

      const tipoResposta = res.headers.get("content-type") ?? "";
      let bytes: Uint8Array | null = null;
      let mime = String(content.mimeType ?? "");

      if (tipoResposta.includes("application/json")) {
        const json = await res.json() as Record<string, unknown>;
        const url = json.fileURL ?? json.fileUrl ?? json.url ?? json.mediaUrl;
        // `base64Data` é o nome no contrato da UAZAPI — os outros ficam como rede
        // de segurança para variações entre versões.
        const base64 = json.base64Data ?? json.base64 ?? json.fileBase64 ?? json.data;
        mime = String(json.mimetype ?? json.mimeType ?? mime);
        if (typeof json.transcription === "string" && json.transcription.trim()) {
          content = { ...content, transcription: json.transcription };
        }

        if (typeof url === "string" && /^https?:\/\//.test(url)) {
          const arquivo = await fetch(url);
          if (!arquivo.ok) {
            diario.push(`${rota} -> url devolvida deu HTTP ${arquivo.status}`);
            continue;
          }
          bytes = new Uint8Array(await arquivo.arrayBuffer());
          mime = mime || (arquivo.headers.get("content-type") ?? "");
        } else if (typeof base64 === "string" && base64.length > 100) {
          const limpo = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
          bytes = Uint8Array.from(atob(limpo), (c) => c.charCodeAt(0));
        } else {
          diario.push(`${rota} -> json sem url/base64 (chaves: ${Object.keys(json).slice(0, 12).join(",")})`);
          continue;
        }
      } else {
        bytes = new Uint8Array(await res.arrayBuffer());
        mime = mime || tipoResposta;
      }

      if (!bytes || bytes.byteLength === 0) {
        diario.push(`${rota} -> arquivo vazio`);
        continue;
      }

      const ext = EXTENSAO_POR_MIME[mime.split(";")[0].trim()] ?? "bin";
      const caminho = `${ctx.organizationId}/${ctx.conversationId}/${ctx.messageId}.${ext}`;

      const { error: erroUpload } = await supabase.storage
        .from("messaging-media")
        .upload(caminho, bytes, { contentType: mime || "application/octet-stream", upsert: true });

      if (erroUpload) {
        diario.push(`${rota} -> upload falhou: ${erroUpload.message}`);
        continue;
      }

      // Assinatura longa: o player lê `mediaUrl` direto. `mediaPath` fica guardado
      // para reassinar sem precisar baixar de novo.
      const { data: assinada } = await supabase.storage
        .from("messaging-media")
        .createSignedUrl(caminho, 60 * 60 * 24 * 365);

      diario.push(`${rota} -> OK (${bytes.byteLength} bytes, ${mime || "sem mime"})`);

      return {
        ...content,
        mediaUrl: assinada?.signedUrl ?? "",
        mediaPath: caminho,
        mimeType: mime || undefined,
        _download: diario,
      };
    } catch (e) {
      diario.push(`${rota} -> erro: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ...content, _download: diario };
}

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
        content: {
          type: "image",
          caption: (message.imageMessage as Record<string, unknown>)?.caption as string,
          ...conteudoDeMidia(message.imageMessage as Record<string, unknown>),
        },
      };
    case "audioMessage":
      return {
        contentType: "audio",
        content: { type: "audio", ...conteudoDeMidia(message.audioMessage as Record<string, unknown>) },
      };
    case "videoMessage":
      return {
        contentType: "video",
        content: {
          type: "video",
          caption: (message.videoMessage as Record<string, unknown>)?.caption as string,
          ...conteudoDeMidia(message.videoMessage as Record<string, unknown>),
        },
      };
    case "documentMessage": {
      const doc = message.documentMessage as Record<string, unknown>;
      return {
        contentType: "document",
        content: { type: "document", fileName: doc?.fileName as string, ...conteudoDeMidia(doc) },
      };
    }
    case "stickerMessage":
      return {
        contentType: "sticker",
        content: { type: "sticker", ...conteudoDeMidia(message.stickerMessage as Record<string, unknown>) },
      };
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
/**
 * Campos de MÍDIA que o adaptador precisa preservar do payload cru.
 *
 * Até 24/08/2026 este adaptador montava `{ audioMessage: {} }` — descartava tudo
 * que a UAZAPI mandasse junto do áudio. Resultado: 137 mídias no banco (75
 * áudios, 44 imagens, 18 documentos) com `mediaUrl: ""`, o player desabilitado, e
 * o consultor sem conseguir ouvir o próprio histórico.
 *
 * Como a documentação da UAZAPI é uma SPA (não dá para ler o contrato) e o
 * payload cru nunca foi persistido, a estratégia aqui é: **copiar o que existir**,
 * entre os nomes que as APIs de WhatsApp costumam usar, e registrar em
 * `_camposRecebidos` QUAIS chaves vieram. Com o primeiro áudio real, o contrato
 * aparece no banco e o download definitivo pode ser escrito sem adivinhação.
 *
 * `base64` fica de fora de propósito: pode ter megabytes e não cabe numa coluna
 * de metadados — se for esse o caminho, o valor vira arquivo no Storage, não JSON.
 */
const CAMPOS_DE_MIDIA = [
  "mediaUrl",
  "mediaurl",
  "url",
  "fileURL",
  "fileUrl",
  "downloadUrl",
  "directPath",
  "mimetype",
  "mimeType",
  "fileName",
  "filename",
  "fileLength",
  "seconds",
  "mediaKey",
  "id",
  // Confirmados no áudio de teste de 25/08/2026: o payload real da UAZAPI NÃO
  // traz url nem base64 — traz `content`, `mediaType` e `convertOptions`. O
  // `content` é o candidato a carregar o arquivo (para texto ele guarda
  // `{ text }`), então entra aqui para revelar o formato de vez.
  "content",
  "mediaType",
  "convertOptions",
  "messageid",
] as const;

/** Copia os campos de mídia presentes no payload cru, sem inventar nenhum. */
function midiaDoPayload(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const recebidos: string[] = [];

  for (const campo of CAMPOS_DE_MIDIA) {
    const valor = m[campo];
    if (valor === undefined || valor === null || valor === "") continue;
    // Corta valores absurdos (base64 disfarçado de url, por exemplo).
    if (typeof valor === "string" && valor.length > 2000) {
      recebidos.push(`${campo}(>2000 chars)`);
      continue;
    }
    out[campo] = valor;
    recebidos.push(campo);
  }

  // Diagnóstico: todas as chaves que vieram no objeto da mensagem. É o que
  // responde "a UAZAPI manda URL, id ou base64?" sem precisar de outro deploy.
  out._camposRecebidos = recebidos;
  out._chavesDoPayload = Object.keys(m).slice(0, 40);

  return out;
}

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
    message = { audioMessage: { ...midiaDoPayload(m) } };
  } else if (mtypeRaw.includes("video")) {
    messageType = "videoMessage";
    message = { videoMessage: { caption: String(m.caption ?? text), ...midiaDoPayload(m) } };
  } else if (mtypeRaw.includes("document")) {
    messageType = "documentMessage";
    message = {
      documentMessage: { fileName: String(m.fileName ?? m.filename ?? ""), ...midiaDoPayload(m) },
    };
  } else if (mtypeRaw.includes("sticker")) {
    messageType = "stickerMessage";
    message = { stickerMessage: { ...midiaDoPayload(m) } };
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
    /** Necessário para baixar a mídia na UAZAPI (serverUrl + apiKey). */
    credentials?: Record<string, string>;
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

  const externalMessageId = normalizeExternalMessageId(data.key.id);
  const { contentType, content } = extractMessageContent(data);
  const messageText = extractMessageText(data); // for last_message_preview only
  const pushName = data.pushName;
  const timestamp = data.messageTimestamp
    ? new Date(data.messageTimestamp * 1000)
    : new Date();

  // Find existing conversation.
  // Casa pelas VARIANTES do 9º dígito (ver brPhoneVariants): a conversa pré-criada pelo
  // lead-intake usa o telefone DO FORMULÁRIO (com o 9) e o evento do WhatsApp chega sem.
  // `limit(1)` + `order` porque a base tem pares legados das duas formas — pega a mais antiga
  // (a do formulário, que carrega o lead_form) em vez de estourar no maybeSingle.
  const phoneLookup = brPhoneVariants(phone);
  const { data: existingConv, error: convFindErr } = await supabase
    .from("messaging_conversations")
    .select("id, contact_id, metadata")
    .eq("channel_id", channel.id)
    .in("external_contact_id", phoneLookup)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (convFindErr) throw convFindErr;

  let conversationId: string;
  let contactId: string | null = null;

  if (existingConv) {
    conversationId = existingConv.id;
    contactId = existingConv.contact_id;

    // Conversa existente SEM deal vinculado (órfã): roda o find-or-create também.
    // Cobre conversas criadas antes do fix e leads do backfill voltando a falar.
    // SÓ em mensagem INBOUND (!isFromMe): um eco de mensagem NOSSA (automação de
    // lead-intake / prospecção manual) não pode gerar card fantasma de SDR — o
    // card nasce quando o lead REALMENTE responde.
    const hasDeal = Boolean((existingConv.metadata as Record<string, unknown>)?.deal_id);
    if (!hasDeal && contactId && !isFromMe) {
      const routingRule = await getLeadRoutingRule(supabase, channel.id);
      if (routingRule) {
        await autoCreateDeal(supabase, {
          organizationId: channel.organization_id,
          contactId,
          boardId: routingRule.boardId,
          stageId: routingRule.stageId,
          conversationId,
          contactName: data.pushName || phone,
          phone,
        });
      }
    }
  } else {
    // Find or create contact
    const { data: existingContact, error: contactLookupErr } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", channel.organization_id)
      // Variantes do 9º dígito: o contato pode ter sido criado pelo formulário COM o 9.
      .in("phone", phoneLookup)
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

    // Auto-create deal if lead routing rule exists.
    // SÓ em mensagem INBOUND (!isFromMe): se a 1ª mensagem desta conversa for um
    // eco NOSSO (outbound), criamos contato + conversa (aparece no Inbox) mas NÃO
    // o card — senão vira card fantasma de SDR. O card nasce no ramo acima quando
    // o lead responde de verdade.
    if (contactId && !isFromMe) {
      const routingRule = await getLeadRoutingRule(supabase, channel.id);
      if (routingRule) {
        await autoCreateDeal(supabase, {
          organizationId: channel.organization_id,
          contactId,
          boardId: routingRule.boardId,
          stageId: routingRule.stageId,
          conversationId,
          contactName: pushName || phone,
          phone,
        });
      }
    }
  }

  // Eco de uma mensagem NOSSA (API/IA/automação de lead-intake) que ainda não
  // recebeu external_id: todo envio daqui insere a linha (status pending,
  // external_id NULL) ANTES de chamar o provider, só grava o external_id
  // DEPOIS que a UAZAPI responde — e esse webhook pode chegar antes desse
  // UPDATE terminar. Sem este check, o "duplicate" (que só olha external_id)
  // não pega essa corrida, e a mensagem cai como "reply manual" — pausando a
  // IA à toa logo depois do opener automático de todo lead novo.
  if (isFromMe) {
    const { data: inFlight } = await supabase
      .from("messaging_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .is("external_id", null)
      .in("status", ["pending", "queued"])
      .gte("created_at", new Date(timestamp.getTime() - 60_000).toISOString())
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (inFlight?.id) {
      await supabase
        .from("messaging_messages")
        .update({
          external_id: externalMessageId,
          status: "sent",
          sent_at: timestamp.toISOString(),
          metadata: {
            uazapi_message_id: externalMessageId,
            message_type: data.messageType,
            timestamp: data.messageTimestamp,
          },
        })
        .eq("id", inFlight.id);

      await supabase
        .from("messaging_conversations")
        .update({
          last_message_at: timestamp.toISOString(),
          last_message_preview: messageText.slice(0, 100),
          last_message_direction: "outbound",
        })
        .eq("id", conversationId);

      return; // backfill feito — não é reply manual, não insere linha nova, não pausa a IA
    }
  }

  // Mídia: baixa o arquivo na UAZAPI e guarda no Storage antes de gravar a
  // mensagem, para o player já nascer com som. Nunca lança: se falhar, entra como
  // entrava antes (sem arquivo) e o motivo fica em `content._download`.
  const conteudoFinal = await baixarEGuardarMidia(
    supabase,
    channel.credentials,
    contentType,
    content,
    {
      organizationId: channel.organization_id,
      conversationId,
      messageId: externalMessageId ?? crypto.randomUUID(),
    },
  );

  // Insert message (inbound or outbound from WhatsApp app)
  // Preserve real content type instead of always saving as 'text'
  const { data: insertedMsg, error: msgErr } = await supabase
    .from("messaging_messages")
    .insert({
      conversation_id: conversationId,
      external_id: externalMessageId,
      direction,
      content_type: contentType,
      content: conteudoFinal,
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

  // Consultor respondeu direto pelo celular (fora do CRM): se fosse um envio
  // da nossa API/IA, o external_id já teria sido gravado antes e caído no
  // "duplicate" acima. Chegar aqui = mensagem nova nunca vista → pausa a IA
  // pro contato (auto-serviço pra reativar: painel do contato no Inbox).
  if (isFromMe && contactId) {
    const { error: pauseErr } = await supabase
      .from("contacts")
      // Carimba QUANDO pausou (P0.4): sem isso a pausa era permanente e invisível — o Roger
      // ficou mudo 9 dias por causa de 2 mensagens de automação e ninguém sabia. O carimbo é o
      // que permite a pausa EXPIRAR (PAUSE_TTL_HOURS em lib/ai/agent/agent.service.ts).
      .update({ ai_paused: true, ai_paused_at: new Date().toISOString() })
      .eq("id", contactId)
      .eq("ai_paused", false);
    if (pauseErr) {
      console.error("[UazAPI] Failed to pause AI after manual reply:", pauseErr, { contactId });
    } else {
      console.log(`[UazAPI] AI paused for contact ${contactId} (consultant replied manually)`);
    }
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
  if (!isFromMe && insertedMsg?.id) {
    // MÍDIA TAMBÉM ACORDA A ANA (P0.4, 14/08).
    //
    // Antes o gatilho era `contentType === "text"`: áudio, imagem e documento entravam no banco
    // e a IA NUNCA era chamada — o lead falava e a Ana simplesmente ficava muda, sem nenhum
    // rastro. Foi o que aconteceu com a Mirella (respondeu com um DOCUMENTO em 04/08, no meio de
    // uma qualificação que ia bem, e nunca mais teve resposta) e com o Cleysson (imagem).
    // Eram 51 mídias inbound sem um único turno de IA nos 2 min seguintes.
    //
    // Ainda NÃO transcrevemos áudio (isso é o item de áudio→IA, separado, e depende de a mídia
    // passar a ser baixada — hoje o webhook grava mediaUrl vazio). Até lá, mandamos um
    // placeholder textual pra Ana saber que chegou algo e pedir por escrito, em vez de sumir.
    const textContent = content.text as string | undefined;
    const messageText = contentType === "text" ? textContent : mediaPlaceholder(contentType);

    if (messageText) {
      triggerAIProcessing({
        supabase,
        conversationId,
        organizationId: channel.organization_id,
        messageText,
        messageId: insertedMsg.id,
      }).catch((err) => {
        console.error("[UazAPI] AI processing trigger error:", err);
      });
    }
  }
}

/**
 * Texto que a Ana recebe no lugar de uma mídia que ainda não conseguimos ler.
 *
 * Vai como se fosse a mensagem do lead, então precisa deixar claro pra ela o que houve E o que
 * fazer — o objetivo é a Ana pedir por escrito e a conversa CONTINUAR, em vez de morrer no
 * silêncio. Retorna null pros tipos em que responder não faria sentido.
 */
function mediaPlaceholder(contentType: string): string | null {
  switch (contentType) {
    case "audio":
      return "[o lead mandou um áudio. Você ainda não consegue ouvir áudio: peça, com naturalidade e sem se desculpar demais, que ele mande o principal por escrito — e siga de onde vocês pararam.]";
    case "image":
      return "[o lead mandou uma imagem. Você ainda não consegue ver imagens: pergunte, de forma leve, o que tem nela — e siga de onde vocês pararam.]";
    case "document":
      return "[o lead mandou um documento. Você ainda não consegue abrir arquivos: diga que o consultor vê o documento na conversa e pergunte o essencial por escrito — e siga de onde vocês pararam.]";
    default:
      return null;
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

    const externalId = normalizeExternalMessageId(update.key.id);
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

/** Vincula a conversa a um deal via metadata (merge seguro do JSONB). */
async function linkConversationToDeal(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
  dealId: string,
  autoCreated: boolean,
) {
  const { data: conv, error: convMetaErr } = await supabase
    .from("messaging_conversations")
    .select("metadata")
    .eq("id", conversationId)
    .maybeSingle();

  if (convMetaErr) {
    console.error("[UazAPI] Failed to read conversation metadata:", convMetaErr);
    return;
  }

  const { error: metaUpdateErr } = await supabase
    .from("messaging_conversations")
    .update({
      metadata: {
        ...((conv?.metadata as Record<string, unknown>) || {}),
        deal_id: dealId,
        auto_created_deal: autoCreated,
      },
    })
    .eq("id", conversationId);

  if (metaUpdateErr) {
    console.error("[UazAPI] Failed to update conversation metadata:", metaUpdateErr);
  }
}

/**
 * Encontra um deal ABERTO já existente pra este lead (na org inteira) — evita
 * duplicar card de quem já está no CRM (backfill/consultor). Ordem de busca:
 * 1. deal vinculado ao contato; 2. custom_fields.phone = E.164 (backfill novo);
 * 3. título = telefone cru (backfill antigo sem nome). Adota o contato no deal
 * quando ele ainda não tem (cura os cards do backfill).
 */
async function findExistingOpenDeal(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  contactId: string,
  phone: string,
): Promise<string | null> {
  // 1. Pelo contato
  const { data: byContact } = await supabase
    .from("deals")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_won", false)
    .eq("is_lost", false)
    .is("deleted_at", null)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byContact?.id) return byContact.id as string;

  // 2. Pelo telefone em custom_fields.phone (deals do backfill, sem contato)
  const { data: byPhone } = await supabase
    .from("deals")
    .select("id, contact_id")
    .eq("organization_id", organizationId)
    .eq("is_won", false)
    .eq("is_lost", false)
    .is("deleted_at", null)
    .eq("custom_fields->>phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byPhone?.id) {
    if (!byPhone.contact_id) {
      await supabase.from("deals").update({ contact_id: contactId }).eq("id", byPhone.id);
    }
    return byPhone.id as string;
  }

  // 3. Pelo título = telefone cru (backfill antigo)
  const { data: byTitle } = await supabase
    .from("deals")
    .select("id, contact_id")
    .eq("organization_id", organizationId)
    .eq("is_won", false)
    .eq("is_lost", false)
    .is("deleted_at", null)
    .eq("title", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byTitle?.id) {
    if (!byTitle.contact_id) {
      await supabase.from("deals").update({ contact_id: contactId }).eq("id", byTitle.id);
    }
    return byTitle.id as string;
  }

  return null;
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
    phone: string;
  }
) {
  try {
    // 0. Lead já tem deal aberto no CRM? Vincula em vez de duplicar (o trigger
    //    check_deal_duplicate rejeitaria mesmo caminho contato+stage; e leads do
    //    backfill precisam CASAR com a conversa, não ganhar card novo).
    const existingDealId = await findExistingOpenDeal(
      supabase,
      params.organizationId,
      params.contactId,
      params.phone,
    );
    if (existingDealId) {
      await linkConversationToDeal(supabase, params.conversationId, existingDealId, false);
      console.log(`[UazAPI] Linked conversation ${params.conversationId} to existing deal ${existingDealId}`);
      return;
    }

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
        // phone no custom_fields: alimenta o botão de WhatsApp no card e o
        // find-or-link de conversas futuras (mesma chave do backfill).
        custom_fields: { phone: params.phone, source: "whatsapp-webhook" },
      })
      .select("id")
      .single();

    if (dealErr) {
      // Corrida com o trigger check_deal_duplicate: outro caminho criou o deal
      // entre a busca e o insert — re-busca e vincula em vez de perder a conversa.
      const retryId = await findExistingOpenDeal(supabase, params.organizationId, params.contactId, params.phone);
      if (retryId) {
        await linkConversationToDeal(supabase, params.conversationId, retryId, false);
        console.log(`[UazAPI] Insert rejeitado; linked to existing deal ${retryId}`);
        return;
      }
      console.error("[UazAPI] Error auto-creating deal:", dealErr);
      return;
    }

    console.log(`[UazAPI] Auto-created deal: ${newDeal.id} for contact ${params.contactId}`);
    await linkConversationToDeal(supabase, params.conversationId, newDeal.id as string, true);
  } catch (error) {
    console.error("[UazAPI] Unexpected error in autoCreateDeal:", error);
  }
}
