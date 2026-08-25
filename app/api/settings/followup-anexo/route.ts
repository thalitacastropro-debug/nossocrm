/**
 * @fileoverview Anexo dos toques de follow-up (hoje: o vídeo do 3º toque).
 *
 * GET  — devolve o anexo configurado (sem exigir admin: quem vê a Central de I.A
 *        já é admin, e o dado não é segredo).
 * POST — sobe o arquivo no bucket `messaging-media` e grava a configuração.
 * DELETE — remove o anexo (a cadência volta a ser só texto).
 *
 * O arquivo vai para `${organization_id}/followup/…` — fora das pastas de
 * conversa, porque ele não pertence a nenhuma: é material da operação, reusado em
 * todo lead que chegar ao toque configurado.
 *
 * A URL é **assinada por 5 anos**: quem baixa o arquivo é a UAZAPI, no momento do
 * disparo, e um vídeo institucional fica no ar por muito tempo. Bucket privado
 * continua privado — sem a assinatura, ninguém acessa.
 *
 * @module app/api/settings/followup-anexo/route
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

export const maxDuration = 60;

/** 25 MB — o mesmo teto do bucket. Vídeo de WhatsApp acima disso trava no envio. */
const TAMANHO_MAXIMO = 25 * 1024 * 1024;

const TIPOS_ACEITOS: Record<string, 'video' | 'image' | 'audio' | 'document'> = {
  'video/mp4': 'video',
  'image/jpeg': 'image',
  'image/png': 'image',
  'audio/mpeg': 'audio',
  'audio/ogg': 'audio',
  'application/pdf': 'document',
};

const EXTENSAO: Record<string, string> = {
  'video/mp4': 'mp4',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
};

const ANOS_5 = 60 * 60 * 24 * 365 * 5;

/** Sessão + papel admin. A escrita mexe na cadência de todo mundo. */
async function exigirAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) };

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) {
    return { erro: NextResponse.json({ error: 'Perfil não encontrado' }, { status: 404 }) };
  }
  if (profile.role !== 'admin') {
    return { erro: NextResponse.json({ error: 'Apenas administradores' }, { status: 403 }) };
  }

  return { organizationId: profile.organization_id as string };
}

export async function GET() {
  const auth = await exigirAdmin();
  if (auth.erro) return auth.erro;

  const admin = createStaticAdminClient();
  const { data } = await admin
    .from('organization_settings')
    .select('followup_anexo')
    .eq('organization_id', auth.organizationId)
    .maybeSingle();

  return NextResponse.json({ anexo: data?.followup_anexo ?? null });
}

export async function POST(request: NextRequest) {
  const auth = await exigirAdmin();
  if (auth.erro) return auth.erro;

  const form = await request.formData();
  const file = form.get('file') as File | null;
  const toqueIndex = Number(form.get('toqueIndex') ?? 2);
  const legenda = String(form.get('legenda') ?? '').trim();
  const comoGravacao = String(form.get('comoGravacao') ?? '') === 'true';

  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 });
  if (file.size > TAMANHO_MAXIMO) {
    return NextResponse.json({ error: 'Arquivo acima de 25 MB' }, { status: 400 });
  }

  const tipo = TIPOS_ACEITOS[file.type];
  if (!tipo) {
    return NextResponse.json(
      { error: `Tipo não aceito (${file.type}). Use MP4, JPG, PNG, MP3 ou PDF.` },
      { status: 400 },
    );
  }
  if (!Number.isInteger(toqueIndex) || toqueIndex < 0 || toqueIndex > 3) {
    return NextResponse.json({ error: 'Toque inválido' }, { status: 400 });
  }

  const admin = createStaticAdminClient();
  const caminho = `${auth.organizationId}/followup/toque-${toqueIndex}-${Date.now()}.${EXTENSAO[file.type]}`;

  const { error: erroUpload } = await admin.storage
    .from('messaging-media')
    .upload(caminho, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: true,
    });

  if (erroUpload) {
    console.error('[followup-anexo] upload:', erroUpload);
    return NextResponse.json({ error: 'Falha ao subir o arquivo' }, { status: 500 });
  }

  const { data: assinada, error: erroUrl } = await admin.storage
    .from('messaging-media')
    .createSignedUrl(caminho, ANOS_5);

  if (erroUrl || !assinada?.signedUrl) {
    return NextResponse.json({ error: 'Falha ao gerar o link do arquivo' }, { status: 500 });
  }

  const anexo = {
    url: assinada.signedUrl,
    caminho,
    tipo,
    toqueIndex,
    fileName: file.name,
    ...(legenda ? { legenda } : {}),
    ...(comoGravacao ? { comoGravacao: true } : {}),
  };

  const { error: erroSalvar } = await admin
    .from('organization_settings')
    .update({ followup_anexo: anexo, updated_at: new Date().toISOString() })
    .eq('organization_id', auth.organizationId);

  if (erroSalvar) {
    return NextResponse.json({ error: erroSalvar.message }, { status: 500 });
  }

  return NextResponse.json({ anexo });
}

export async function DELETE() {
  const auth = await exigirAdmin();
  if (auth.erro) return auth.erro;

  const admin = createStaticAdminClient();
  const { error } = await admin
    .from('organization_settings')
    .update({ followup_anexo: null, updated_at: new Date().toISOString() })
    .eq('organization_id', auth.organizationId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // O arquivo fica no bucket de propósito: se ela remover por engano, o histórico
  // de quem já recebeu continua abrindo a mídia.
  return NextResponse.json({ anexo: null });
}
