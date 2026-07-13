/**
 * Upload server-side de um arquivo de deal pro bucket privado `deal-files`.
 * O dealFilesService (client de navegador) não serve em rota; aqui usamos o
 * static admin client (write de sistema). Mesma convenção de path/registro.
 *
 * NOTA: `deal_files` NÃO tem coluna organization_id (schema_init) — o path
 * `{dealId}/…` já isola por deal; espelhamos exatamente as colunas do client.
 */
import { createStaticAdminClient } from './staticAdminClient';

const BUCKET_NAME = 'deal-files';

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
};

export async function uploadDealAudioServer(opts: {
  dealId: string;
  buffer: Buffer;
  mimeType: string;
  createdBy?: string | null;
}): Promise<{ filePath: string | null; error: Error | null }> {
  const admin = createStaticAdminClient();
  const ext = MIME_TO_EXT[opts.mimeType.split(';')[0]] ?? 'audio';
  const filePath = `${opts.dealId}/voice/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET_NAME)
    .upload(filePath, opts.buffer, { contentType: opts.mimeType });
  if (uploadError) return { filePath: null, error: uploadError as Error };

  const { error: insertError } = await admin.from('deal_files').insert({
    deal_id: opts.dealId,
    file_name: filePath.split('/').pop(),
    file_path: filePath,
    file_size: opts.buffer.length,
    mime_type: opts.mimeType,
    created_by: opts.createdBy ?? null,
  });
  if (insertError) return { filePath, error: insertError as Error };

  return { filePath, error: null };
}

/** Signed URL de 1h pro áudio (usado pelo card de revisão / player). */
export async function getDealAudioSignedUrl(filePath: string): Promise<string | null> {
  const admin = createStaticAdminClient();
  const { data } = await admin.storage.from(BUCKET_NAME).createSignedUrl(filePath, 3600);
  return data?.signedUrl ?? null;
}
