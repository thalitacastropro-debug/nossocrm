/**
 * @fileoverview Garante a conversa de WhatsApp de um deal (find-or-create).
 *
 * POST /api/deals/[dealId]/whatsapp-conversation
 *
 * Usado pelo modal de WhatsApp do card: quando o lead ainda NÃO tem conversa
 * (ex.: base fria do backfill, criada a partir do histórico sem conversa), este
 * endpoint resolve o telefone do deal, garante o contato, acha o canal WhatsApp
 * da org e faz find-or-create da conversa (mesma chave dos webhooks: channel_id
 * + external_contact_id em E.164), vinculando `metadata.deal_id`. Retorna o id
 * da conversa pra o modal abrir a thread e permitir mandar a 1ª mensagem.
 *
 * @module app/api/deals/[dealId]/whatsapp-conversation/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

export const maxDuration = 30;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normaliza um telefone para E.164 (+55...), mesma chave usada pelos webhooks/route. */
function toE164(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  // Não confunde um título comum ("Empresa X") com telefone.
  if (!/^\+?[\d\s()-]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid dealId' }, { status: 400 });
  }

  // Auth por sessão (RLS garante que o usuário só vê deals da própria org).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id, organization_id, contact_id, title, custom_fields')
    .eq('id', dealId)
    .maybeSingle();
  if (dealErr || !deal) {
    return NextResponse.json({ error: 'Deal não encontrado' }, { status: 404 });
  }

  const admin = createStaticAdminClient();
  const orgId = deal.organization_id as string;
  const custom = (deal.custom_fields as Record<string, unknown>) || {};

  // 1. Resolve telefone: custom_fields.phone → contato → título (backfill antigo).
  let phone = toE164(custom.phone);
  let contactId = (deal.contact_id as string | null) ?? null;
  let contactName: string | null = null;

  if (contactId) {
    const { data: c } = await admin
      .from('contacts')
      .select('phone, name')
      .eq('id', contactId)
      .maybeSingle();
    if (c) {
      phone = phone || toE164(c.phone);
      contactName = (c.name as string) ?? null;
    }
  }
  if (!phone) phone = toE164(deal.title);
  if (!phone) {
    return NextResponse.json({ error: 'Lead sem telefone válido', code: 'NO_PHONE' }, { status: 422 });
  }

  // 2. Canal WhatsApp conectado da org.
  const { data: channel } = await admin
    .from('messaging_channels')
    .select('id, business_unit_id')
    .eq('organization_id', orgId)
    .eq('channel_type', 'whatsapp')
    .in('status', ['connected', 'active'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!channel) {
    return NextResponse.json({ error: 'Sem canal WhatsApp conectado', code: 'NO_CHANNEL' }, { status: 422 });
  }

  // 3. Garante o contato (cria se o deal do backfill não tinha).
  if (!contactId) {
    const { data: existing } = await admin
      .from('contacts')
      .select('id, name')
      .eq('organization_id', orgId)
      .eq('phone', phone)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      contactId = existing.id as string;
      contactName = (existing.name as string) ?? null;
    } else {
      const { data: nc } = await admin
        .from('contacts')
        .insert({ organization_id: orgId, name: (deal.title as string) || phone, phone, source: 'whatsapp' })
        .select('id, name')
        .single();
      contactId = nc?.id ?? null;
      contactName = (nc?.name as string) ?? null;
    }
    if (contactId) await admin.from('deals').update({ contact_id: contactId }).eq('id', dealId);
  }

  // 4. Find-or-create conversa (channel + telefone E.164) e vincula o deal.
  const { data: existingConv } = await admin
    .from('messaging_conversations')
    .select('id, metadata')
    .eq('channel_id', channel.id)
    .eq('external_contact_id', phone)
    .maybeSingle();

  if (existingConv?.id) {
    const meta = (existingConv.metadata as Record<string, unknown>) || {};
    if (meta.deal_id !== dealId || !contactId) {
      await admin
        .from('messaging_conversations')
        .update({ metadata: { ...meta, deal_id: dealId }, contact_id: contactId })
        .eq('id', existingConv.id);
    }
    return NextResponse.json({ conversationId: existingConv.id });
  }

  const { data: newConv, error: convErr } = await admin
    .from('messaging_conversations')
    .insert({
      organization_id: orgId,
      channel_id: channel.id,
      business_unit_id: channel.business_unit_id,
      external_contact_id: phone,
      external_contact_name: contactName || (deal.title as string) || phone,
      contact_id: contactId,
      status: 'open',
      priority: 'normal',
      metadata: { deal_id: dealId, opened_from: 'board_modal' },
    })
    .select('id')
    .single();
  if (convErr || !newConv) {
    console.error('[whatsapp-conversation] insert error:', convErr);
    return NextResponse.json({ error: 'Falha ao criar conversa' }, { status: 500 });
  }

  return NextResponse.json({ conversationId: newConv.id });
}
