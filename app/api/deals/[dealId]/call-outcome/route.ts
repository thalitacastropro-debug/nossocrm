/**
 * POST /api/deals/[dealId]/call-outcome
 *
 * Duas entradas, a mesma saída { transcricao, desfecho, audioFilePath }:
 *   • multipart `audio`        → gravação NOVA: sobe pro bucket `deal-files` e transcreve;
 *   • JSON `{ audioFilePath }` → RETOMAR uma gravação já salva que não virou desfecho.
 * NÃO grava desfecho (isso é o /apply). Guard: org sem chave Google → 422.
 *
 * GET /api/deals/[dealId]/call-outcome → { pendentes } — gravações do card que ainda não
 * viraram desfecho, com o motivo da última falha e um link de 1h para ouvir.
 *
 * POR QUE RETOMAR EXISTE (09/10/2026): o áudio sobe ANTES da transcrição. Qualquer coisa que
 * falhasse depois — a IA, o limite de 60s, o modal fechado antes do Confirmar — deixava o arquivo
 * no storage e nada dizia que aquela reunião ficou sem desfecho. Caso Alan Ferreira, 08/10 17:59:
 * gravado, nunca aplicado, e o log da Vercel (1 hora no Hobby) já não existia para dizer por quê.
 * Agora a gravação nasce `pendente`, a falha fica gravada na linha, e o card oferece "Retomar".
 *
 * SEGURANÇA: o deal é lido com o client SSR (RLS) ANTES de qualquer write
 * service-role — um dealId de outra org retorna 404 aqui, senão o upload
 * bypassaria a policy deal_files_org_isolate (achado da revisão adversarial).
 * No retomar, o path vem do navegador: precisa ser `{dealId}/voice/…` E existir em `deal_files`
 * deste card — senão daria para transcrever o áudio de outro card passando o path dele.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';
import { transcribeAudio } from '@/lib/ai/call-outcome/transcribe';
import { extractCallOutcome } from '@/lib/ai/call-outcome/call-outcome.service';
import {
  uploadDealAudioServer,
  gravacoesPendentes,
  lerGravacao,
  baixarAudioDoDeal,
  registrarTranscricao,
  registrarFalhaDesfecho,
  getDealAudioSignedUrl,
  pathDeGravacaoDoDeal,
} from '@/lib/supabase/dealFilesServer';

export const maxDuration = 60;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Usuário logado + deal visível pela RLS. Devolve a resposta de erro ou o contexto. */
async function autorizar(dealId: string) {
  if (!dealId || !uuidRegex.test(dealId)) {
    return { erro: NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 }) };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  // Gate de autorização: a RLS de deals só devolve deals da org do caller.
  // Sem isso, o upload service-role abaixo gravaria em deal de OUTRA org.
  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id, organization_id')
    .eq('id', dealId)
    .single();
  if (dealErr || !deal) return { erro: NextResponse.json({ error: 'Deal not found' }, { status: 404 }) };

  return { supabase, user };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const auth = await autorizar(dealId);
  if ('erro' in auth) return auth.erro;

  const pendentes = await gravacoesPendentes(dealId);
  // Link para ouvir antes de decidir — limitado às 5 mais novas (cada uma é uma chamada ao storage).
  const comLink = await Promise.all(
    pendentes.map(async (g, i) => ({
      audioFilePath: g.audioFilePath,
      criadoEm: g.criadoEm,
      erro: g.erro,
      erroEm: g.erroEm,
      temTranscricao: Boolean(g.transcricao),
      audioUrl: i < 5 ? await getDealAudioSignedUrl(g.audioFilePath) : null,
    })),
  );
  return NextResponse.json({ pendentes: comLink }, { status: 200 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const auth = await autorizar(dealId);
  if ('erro' in auth) return auth.erro;
  const { supabase, user } = auth;

  // --- Qual gravação: a nova (multipart) ou uma já salva (JSON) ---------------
  const retomando = (request.headers.get('content-type') ?? '').includes('application/json');
  let novoAudio: File | null = null;
  let pathRetomado: string | null = null;

  if (retomando) {
    const body = (await request.json().catch(() => ({}))) as { audioFilePath?: unknown };
    if (!pathDeGravacaoDoDeal(dealId, body.audioFilePath)) {
      return NextResponse.json({ error: 'audioFilePath inválido para este card' }, { status: 400 });
    }
    pathRetomado = body.audioFilePath;
  } else {
    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json({ error: 'audio file is required' }, { status: 400 });
    }
    novoAudio = audio;
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

  // --- Áudio em mãos + path no storage ---------------------------------------
  let buffer: Buffer | null = null;
  let mimeType: string;
  let filePath: string;
  let transcricaoSalva: string | null = null;

  if (pathRetomado) {
    const gravacao = await lerGravacao(dealId, pathRetomado);
    if (!gravacao) return NextResponse.json({ error: 'Gravação não encontrada neste card' }, { status: 404 });
    if (gravacao.status === 'aplicado') {
      return NextResponse.json({ error: 'Esta gravação já virou desfecho.' }, { status: 409 });
    }
    filePath = pathRetomado;
    mimeType = gravacao.mimeType || 'audio/mpeg';
    transcricaoSalva = gravacao.transcricao;
    // Com a transcrição guardada, nem precisa baixar: só a leitura do desfecho é refeita.
    if (!transcricaoSalva) {
      buffer = await baixarAudioDoDeal(pathRetomado);
      if (!buffer) {
        return NextResponse.json({ error: 'Não foi possível ler o áudio salvo' }, { status: 502 });
      }
    }
  } else {
    const audio = novoAudio as File;
    buffer = Buffer.from(await audio.arrayBuffer());
    mimeType = audio.type || 'audio/webm';
    const { filePath: salvo, error: uploadErr } = await uploadDealAudioServer({
      dealId,
      buffer,
      mimeType,
      createdBy: user.id,
    });
    if (uploadErr || !salvo) {
      console.error('[call-outcome] upload failed:', uploadErr?.message);
      return NextResponse.json({ error: 'O áudio não foi salvo. Tente enviar de novo.' }, { status: 500 });
    }
    filePath = salvo;
  }

  // --- Transcrição (pula se já existe) + extração ----------------------------
  // Cada etapa registra a própria falha: "a transcrição falhou" e "a leitura do desfecho falhou"
  // pedem coisas diferentes de quem vai investigar.
  let transcricao = transcricaoSalva;
  if (!transcricao) {
    try {
      transcricao = await transcribeAudio({
        apiKey: aiConfig.structuredApiKey,
        model: aiConfig.structuredModel,
        audioBase64: (buffer as Buffer).toString('base64'),
        mimeType,
      });
      await registrarTranscricao(dealId, filePath, transcricao);
    } catch (err) {
      const motivo = `Transcrição falhou: ${mensagemDe(err)}`;
      console.error('[call-outcome]', motivo);
      await registrarFalhaDesfecho(dealId, filePath, motivo);
      return NextResponse.json(
        { error: 'A IA não conseguiu transcrever o áudio. Ele ficou salvo no card — dá para tentar de novo.', audioFilePath: filePath },
        { status: 502 },
      );
    }
  }

  try {
    const { desfecho } = await extractCallOutcome({ aiConfig, transcricao });
    return NextResponse.json({ transcricao, desfecho, audioFilePath: filePath }, { status: 200 });
  } catch (err) {
    const motivo = `Leitura do desfecho falhou: ${mensagemDe(err)}`;
    console.error('[call-outcome]', motivo);
    await registrarFalhaDesfecho(dealId, filePath, motivo);
    return NextResponse.json(
      { error: 'A IA transcreveu, mas não conseguiu ler o desfecho. O áudio ficou salvo no card — dá para tentar de novo.', audioFilePath: filePath },
      { status: 502 },
    );
  }
}
