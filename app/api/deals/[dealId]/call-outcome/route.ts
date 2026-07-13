/**
 * POST /api/deals/[dealId]/call-outcome
 *
 * Recebe o áudio da call (multipart `audio`), sobe pro bucket `deal-files`,
 * transcreve no Gemini e devolve { transcricao, desfecho, audioFilePath }.
 * NÃO grava desfecho (isso é o /apply). Guard: org sem chave Google → 422.
 *
 * SEGURANÇA: o deal é lido com o client SSR (RLS) ANTES de qualquer write
 * service-role — um dealId de outra org retorna 404 aqui, senão o upload
 * bypassaria a policy deal_files_org_isolate (achado da revisão adversarial).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import { transcribeAudio } from '@/lib/ai/call-outcome/transcribe';
import { extractCallOutcome } from '@/lib/ai/call-outcome/call-outcome.service';
import { uploadDealAudioServer } from '@/lib/supabase/dealFilesServer';

export const maxDuration = 60;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Gate de autorização: a RLS de deals só devolve deals da org do caller.
  // Sem isso, o upload service-role abaixo gravaria em deal de OUTRA org.
  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id, organization_id')
    .eq('id', dealId)
    .single();
  if (dealErr || !deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });

  const form = await request.formData();
  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'audio file is required' }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from('profiles').select('organization_id').eq('id', user.id).maybeSingle();
  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const aiConfig = await getOrgAIConfig(supabase, profile.organization_id);
  if (!aiConfig || !aiConfig.structuredApiKey) {
    return NextResponse.json({ error: 'Google AI key not configured' }, { status: 422 });
  }

  const buffer = Buffer.from(await audio.arrayBuffer());
  const mimeType = audio.type || 'audio/webm';

  const { filePath, error: uploadErr } = await uploadDealAudioServer({
    dealId,
    buffer,
    mimeType,
    createdBy: user.id,
  });
  if (uploadErr || !filePath) {
    console.error('[call-outcome] upload failed:', uploadErr?.message);
    return NextResponse.json({ error: 'Failed to store audio' }, { status: 500 });
  }

  try {
    const transcricao = await transcribeAudio({
      apiKey: aiConfig.structuredApiKey,
      model: aiConfig.structuredModel,
      audioBase64: buffer.toString('base64'),
      mimeType,
    });
    const { desfecho } = await extractCallOutcome({ aiConfig, transcricao });
    return NextResponse.json({ transcricao, desfecho, audioFilePath: filePath }, { status: 200 });
  } catch (err) {
    console.error('[call-outcome] transcription/extraction failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Transcription failed' }, { status: 502 });
  }
}
