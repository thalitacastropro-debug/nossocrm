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
    // Nasce PENDENTE: até o Confirmar, esta gravação é trabalho do consultor que ainda não virou
    // nada no card. ⚠️ Coluna da migration 20261009180000 — ela sobe ANTES deste código, senão
    // o insert falha e nenhum áudio é salvo.
    desfecho_status: 'pendente',
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

// ─── Estado da gravação de desfecho ──────────────────────────────────────────
//
// O áudio sobe ANTES da transcrição. Sem um estado na linha do arquivo, toda falha posterior
// (IA, limite de 60s, modal fechado, aba recarregada) deixava a gravação no storage sem que
// ninguém soubesse — caso Alan Ferreira, 08/10. Ver a migration 20261009180000.

export type DesfechoStatus = 'pendente' | 'aplicado' | 'substituido' | 'descartado';

export interface GravacaoPendente {
  audioFilePath: string;
  mimeType: string | null;
  criadoEm: string;
  transcricao: string | null;
  erro: string | null;
  erroEm: string | null;
}

/** `null` conta como pendente: é o que o código anterior à coluna grava no upload. */
const AINDA_PENDENTE = 'desfecho_status.is.null,desfecho_status.eq.pendente';
const COLUNAS_GRAVACAO =
  'file_path, mime_type, created_at, desfecho_status, desfecho_transcricao, desfecho_erro, desfecho_erro_em';

/** Só aceita path de gravação DESTE card — o path vem do navegador. */
export function pathDeGravacaoDoDeal(dealId: string, audioFilePath: unknown): audioFilePath is string {
  return typeof audioFilePath === 'string'
    && audioFilePath.startsWith(`${dealId}/voice/`)
    && !audioFilePath.includes('..');
}

function linhaParaGravacao(r: Record<string, unknown>): GravacaoPendente {
  return {
    audioFilePath: r.file_path as string,
    mimeType: (r.mime_type as string | null) ?? null,
    criadoEm: r.created_at as string,
    transcricao: (r.desfecho_transcricao as string | null) ?? null,
    erro: (r.desfecho_erro as string | null) ?? null,
    erroEm: (r.desfecho_erro_em as string | null) ?? null,
  };
}

/** Gravações do card que ainda não viraram desfecho, da mais nova para a mais antiga. */
export async function gravacoesPendentes(dealId: string): Promise<GravacaoPendente[]> {
  const admin = createStaticAdminClient();
  const { data, error } = await admin
    .from('deal_files')
    .select(COLUNAS_GRAVACAO)
    .eq('deal_id', dealId)
    .like('file_path', `${dealId}/voice/%`)
    .or(AINDA_PENDENTE)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(linhaParaGravacao);
}

/** Uma gravação do card, em qualquer estado. `null` se o path não é deste card. */
export async function lerGravacao(
  dealId: string,
  audioFilePath: string,
): Promise<(GravacaoPendente & { status: DesfechoStatus | null }) | null> {
  const admin = createStaticAdminClient();
  const { data } = await admin
    .from('deal_files')
    .select(COLUNAS_GRAVACAO)
    .eq('deal_id', dealId)
    .eq('file_path', audioFilePath)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return { ...linhaParaGravacao(r), status: (r.desfecho_status as DesfechoStatus | null) ?? null };
}

/** Baixa o áudio já salvo — é o que permite retomar sem regravar. */
export async function baixarAudioDoDeal(audioFilePath: string): Promise<Buffer | null> {
  const admin = createStaticAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_NAME).download(audioFilePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Transcrição que deu certo: guarda o texto (retomar não paga de novo) e limpa o erro. */
export async function registrarTranscricao(dealId: string, audioFilePath: string, transcricao: string) {
  const admin = createStaticAdminClient();
  await admin
    .from('deal_files')
    .update({ desfecho_transcricao: transcricao, desfecho_erro: null, desfecho_erro_em: null })
    .eq('deal_id', dealId)
    .eq('file_path', audioFilePath);
}

/** Falha: o motivo fica no banco, porque o log da Vercel some em 1 hora. */
export async function registrarFalhaDesfecho(dealId: string, audioFilePath: string, erro: string) {
  const admin = createStaticAdminClient();
  await admin
    .from('deal_files')
    .update({ desfecho_erro: erro.slice(0, 500), desfecho_erro_em: new Date().toISOString() })
    .eq('deal_id', dealId)
    .eq('file_path', audioFilePath);
}

/**
 * Tira a gravação da lista de pendentes. Só mexe em quem ainda está pendente: uma gravação já
 * aplicada não vira "descartada" por um clique atrasado.
 */
export async function resolverGravacao(
  dealId: string,
  audioFilePath: string,
  status: Exclude<DesfechoStatus, 'pendente'>,
  quando: string = new Date().toISOString(),
) {
  const admin = createStaticAdminClient();
  return admin
    .from('deal_files')
    .update({ desfecho_status: status, desfecho_resolvido_em: quando })
    .eq('deal_id', dealId)
    .eq('file_path', audioFilePath)
    .or(AINDA_PENDENTE);
}

/**
 * Ao aplicar uma gravação, as tentativas ANTERIORES do mesmo card nos 30 minutos antes dela
 * viram "substituido". É o padrão real de uso: gravou, não gostou, gravou de novo em 1-2 min.
 * Sem isto, toda regravação deixaria a primeira tentativa pendurada no card como trabalho perdido.
 *
 * 30 minutos, e não "todas as anteriores": duas reuniões do mesmo lead no mesmo dia acontecem, e
 * a gravação perdida da primeira não pode sumir só porque a segunda deu certo.
 */
export async function substituirTentativasAnteriores(
  dealId: string,
  audioFilePathAplicado: string,
  quando: string = new Date().toISOString(),
) {
  const aplicada = await lerGravacao(dealId, audioFilePathAplicado);
  if (!aplicada) return;
  const inicio = new Date(new Date(aplicada.criadoEm).getTime() - 30 * 60 * 1000).toISOString();
  const admin = createStaticAdminClient();
  await admin
    .from('deal_files')
    .update({ desfecho_status: 'substituido', desfecho_resolvido_em: quando })
    .eq('deal_id', dealId)
    .like('file_path', `${dealId}/voice/%`)
    .neq('file_path', audioFilePathAplicado)
    .gte('created_at', inicio)
    .lt('created_at', aplicada.criadoEm)
    .or(AINDA_PENDENTE);
}
