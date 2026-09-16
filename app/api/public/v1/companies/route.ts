import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authPublicApi } from '@/lib/public-api/auth';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { decodeOffsetCursor, encodeOffsetCursor, parseLimit } from '@/lib/public-api/cursor';
import { sanitizePostgrestValue } from '@/lib/utils/sanitize';
import { normalizeText, normalizeUrl } from '@/lib/public-api/sanitize';

export const runtime = 'nodejs';

const CompanyUpsertSchema = z.object({
  name: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
}).strict();

export async function GET(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const name = normalizeText(url.searchParams.get('name'));
  const website = normalizeUrl(url.searchParams.get('website'));
  const limit = parseLimit(url.searchParams.get('limit'));
  const offset = decodeOffsetCursor(url.searchParams.get('cursor'));

  const sb = createStaticAdminClient();
  let query = sb
    .from('crm_companies')
    .select('id,name,website,industry,created_at,updated_at', { count: 'exact' })
    .eq('organization_id', auth.organizationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (website) query = query.eq('website', website);
  if (name) query = query.ilike('name', name);
  if (q) {
    const safeQ = sanitizePostgrestValue(q)
    if (safeQ) query = query.or(`name.ilike.%${safeQ}%,website.ilike.%${safeQ}%`);
  }

  const from = offset;
  const to = offset + limit - 1;
  const { data, count, error } = await query.range(from, to);
  if (error) {
    console.error('[API] Database error:', error)
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 })
  }

  const total = count ?? 0;
  const nextOffset = to + 1;
  const nextCursor = nextOffset < total ? encodeOffsetCursor(nextOffset) : null;

  return NextResponse.json({
    data: (data || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      website: c.website ?? null,
      industry: c.industry ?? null,
      created_at: c.created_at,
      updated_at: c.updated_at,
    })),
    nextCursor,
  });
}

export async function POST(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const body = await request.json().catch(() => null);
  const parsed = CompanyUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const name = normalizeText(parsed.data.name);
  const website = normalizeUrl(parsed.data.website);
  const industry = normalizeText(parsed.data.industry);

  if (!website && !name) {
    return NextResponse.json({ error: 'Provide website or name', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const sb = createStaticAdminClient();

  let lookup = sb
    .from('crm_companies')
    .select('id')
    .eq('organization_id', auth.organizationId)
    .is('deleted_at', null);

  if (website) lookup = lookup.eq('website', website);
  else if (name) lookup = lookup.ilike('name', name);

  const existing = await lookup.maybeSingle();
  if (existing.error) {
    console.error('[API] Database error:', existing.error)
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 })
  }

  const now = new Date().toISOString();
  const payload: any = {
    organization_id: auth.organizationId,
    name: name || '',
    website,
    industry,
    updated_at: now,
  };

  if (existing.data?.id) {
    if (!payload.name) delete payload.name;
    const { data, error } = await sb
      .from('crm_companies')
      .update(payload)
      .eq('id', existing.data.id)
      .select('id,name,website,industry,created_at,updated_at')
      .single();
    if (error) {
      console.error('[API] Database error:', error)
      return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 })
    }
    return NextResponse.json({ data, action: 'updated' });
  }

  if (!name) {
    return NextResponse.json({ error: 'Name is required to create a new company', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  const insertPayload = {
    organization_id: auth.organizationId,
    name,
    website,
    industry,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await sb
    .from('crm_companies')
    .insert(insertPayload)
    .select('id,name,website,industry,created_at,updated_at')
    .single();
  if (error) {
    // 23505 = o índice `crm_companies_nome_unico_por_org` pegou (16/09/2026). Acontece quando a
    // busca lá em cima foi feita por WEBSITE — que tem precedência — e não achou, mas já existe
    // empresa com o MESMO NOME e outro site. Antes do índice isso criava uma duplicata em
    // silêncio; sem este tratamento viraria 500 PERMANENTE, porque repetir dá exatamente no mesmo.
    // O certo é o que o endpoint promete ser: upsert. Cai para a busca por nome e atualiza.
    if (String((error as { code?: string }).code ?? '') === '23505') {
      const porNome = await sb
        .from('crm_companies')
        .select('id')
        .eq('organization_id', auth.organizationId)
        .is('deleted_at', null)
        .ilike('name', name)
        .limit(1)
        .maybeSingle();
      if (porNome.data?.id) {
        const { data: atualizada, error: erroUpdate } = await sb
          .from('crm_companies')
          .update(payload)
          .eq('id', porNome.data.id)
          .select('id,name,website,industry,created_at,updated_at')
          .single();
        if (!erroUpdate) return NextResponse.json({ data: atualizada, action: 'updated' });
        console.error('[API] Database error:', erroUpdate)
      }
      // Não achou nem por nome: 409 diz ao integrador que o pedido conflita com o que já existe —
      // 500 diria "erro nosso, tente de novo", e tentar de novo não resolveria nunca.
      return NextResponse.json(
        { error: 'A company with this name already exists', code: 'CONFLICT' },
        { status: 409 },
      );
    }
    console.error('[API] Database error:', error)
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 })
  }
  return NextResponse.json({ data, action: 'created' }, { status: 201 });
}

