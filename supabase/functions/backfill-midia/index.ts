/**
 * @fileoverview Backfill das mídias que o webhook nunca baixou.
 *
 * **Por que existe:** até 25/08/2026 o webhook da UAZAPI descartava a mídia e
 * gravava `mediaUrl: ""`. Ficaram **137 arquivos inalcançáveis** no CRM — 75
 * áudios (30 deles do próprio consultor, que não conseguia reouvir o que mandou),
 * 44 imagens e 18 documentos. O `uazapi_message_id` foi preservado em todas, e é
 * por ele que dá para recuperar: `POST /message/download { id }`.
 *
 * **Contrato da UAZAPI** (docs.uazapi.com/endpoint/post/message~download):
 *   `{ id, return_base64?, generate_mp3?, return_link?, transcribe? }`
 *   -> `{ fileURL, mimetype, base64Data, transcription }`
 *
 * **Retenção não é garantida:** mídia velha pode não existir mais no provider.
 * Por isso o processamento vai da mais NOVA para a mais antiga — se a janela de
 * retenção cortar, corta no material menos relevante.
 *
 * **Uso** (`limite` para ir aos poucos; comece com 1 para conferir):
 *   POST /functions/v1/backfill-midia
 *   header `x-backfill-secret: <BACKFILL_SECRET>`
 *   body { "limite": 1, "tipos": ["audio"] }
 *
 * Idempotente: só toca em mensagem com `mediaUrl` vazio.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

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

const ANO_EM_SEGUNDOS = 60 * 60 * 24 * 365;

Deno.serve(async (req) => {
  const segredoEsperado = Deno.env.get("BACKFILL_SECRET");
  if (!segredoEsperado || req.headers.get("x-backfill-secret") !== segredoEsperado) {
    return new Response(JSON.stringify({ error: "nao autorizado" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("CRM_SUPABASE_SECRET_KEY") ??
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "sem credenciais do supabase" }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const corpo = await req.json().catch(() => ({})) as { limite?: number; tipos?: string[] };
  const limite = Math.min(Math.max(corpo.limite ?? 10, 1), 200);
  const tipos = corpo.tipos ?? ["audio", "image", "document", "video", "sticker"];

  const { data: canal } = await supabase
    .from("messaging_channels")
    .select("organization_id, credentials")
    .eq("provider", "uazapi")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  const credenciais = canal?.credentials as Record<string, string> | undefined;
  const serverUrl = String(credenciais?.serverUrl ?? "").replace(/\/$/, "");
  const token = credenciais?.apiKey;

  if (!serverUrl || !token) {
    return new Response(JSON.stringify({ error: "canal uazapi sem serverUrl/apiKey" }), { status: 500 });
  }

  // Da mais nova para a mais antiga: a retenção do provider corta o rabo.
  const { data: pendentes, error: erroBusca } = await supabase
    .from("messaging_messages")
    .select("id, conversation_id, external_id, content, content_type")
    .in("content_type", tipos)
    .not("external_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limite);

  if (erroBusca) {
    return new Response(JSON.stringify({ error: erroBusca.message }), { status: 500 });
  }

  const semArquivo = (pendentes ?? []).filter(
    (m) => !(m.content as Record<string, unknown>)?.mediaUrl,
  );

  const relatorio: Array<Record<string, unknown>> = [];
  let recuperadas = 0;

  for (const msg of semArquivo) {
    const content = (msg.content ?? {}) as Record<string, unknown>;
    try {
      const res = await fetch(`${serverUrl}/message/download`, {
        method: "POST",
        headers: { "content-type": "application/json", token },
        body: JSON.stringify({ id: msg.external_id, generate_mp3: true, return_link: true }),
      });

      if (!res.ok) {
        relatorio.push({ id: msg.id, tipo: msg.content_type, resultado: `HTTP ${res.status}` });
        continue;
      }

      const json = await res.json() as Record<string, unknown>;
      const url = json.fileURL ?? json.fileUrl ?? json.url;
      const base64 = json.base64Data ?? json.base64;
      const mime = String(json.mimetype ?? "");

      let bytes: Uint8Array | null = null;
      if (typeof url === "string" && /^https?:\/\//.test(url)) {
        const arquivo = await fetch(url);
        if (arquivo.ok) bytes = new Uint8Array(await arquivo.arrayBuffer());
      } else if (typeof base64 === "string" && base64.length > 100) {
        const limpo = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
        bytes = Uint8Array.from(atob(limpo), (c) => c.charCodeAt(0));
      }

      if (!bytes || bytes.byteLength === 0) {
        relatorio.push({
          id: msg.id,
          tipo: msg.content_type,
          resultado: `sem arquivo (chaves: ${Object.keys(json).slice(0, 8).join(",")})`,
        });
        continue;
      }

      const ext = EXTENSAO_POR_MIME[mime.split(";")[0].trim()] ?? "bin";
      const caminho = `${canal!.organization_id}/${msg.conversation_id}/${msg.id}.${ext}`;

      const { error: erroUpload } = await supabase.storage
        .from("messaging-media")
        .upload(caminho, bytes, { contentType: mime || "application/octet-stream", upsert: true });

      if (erroUpload) {
        relatorio.push({ id: msg.id, tipo: msg.content_type, resultado: `upload: ${erroUpload.message}` });
        continue;
      }

      const { data: assinada } = await supabase.storage
        .from("messaging-media")
        .createSignedUrl(caminho, ANO_EM_SEGUNDOS);

      await supabase
        .from("messaging_messages")
        .update({
          content: {
            ...content,
            mediaUrl: assinada?.signedUrl ?? "",
            mediaPath: caminho,
            mimeType: mime || undefined,
            _backfill: new Date().toISOString(),
          },
        })
        .eq("id", msg.id);

      recuperadas++;
      relatorio.push({
        id: msg.id,
        tipo: msg.content_type,
        resultado: `OK (${bytes.byteLength} bytes, ${mime || "sem mime"})`,
      });
    } catch (e) {
      relatorio.push({
        id: msg.id,
        tipo: msg.content_type,
        resultado: `erro: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return new Response(
    JSON.stringify({
      examinadas: semArquivo.length,
      recuperadas,
      relatorio,
    }, null, 2),
    { headers: { "content-type": "application/json" } },
  );
});
