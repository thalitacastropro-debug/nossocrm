/**
 * @fileoverview Cancelar reunião
 *
 * POST /api/deals/[dealId]/cancel-meeting
 *
 * Cancela a reunião marcada: soft-delete da activity (CALL) + reuniao_agendada.status='cancelada'
 * + remove a tag. Existe porque NÃO havia nenhum caminho de cancelamento no CRM: `cancelMeeting`
 * só era alcançável pela conversa da Ana no board dela (config.ts:26-29 → scheduling.service.ts
 * :45-48), então 'confirmada' era estado terminal. Sem isto, a cadência 3 anunciaria uma reunião
 * cancelada — e como o lembrete ignora `ai_paused`, o consultor não teria kill switch.
 *
 * NÃO move board e NÃO marca perdido: cancelar não é perder — o lead quer remarcar.
 * Idempotente: cancelar de novo devolve 200 { already_cancelled: true }.
 *
 * @module app/api/deals/[dealId]/cancel-meeting/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { cancelMeeting } from '@/lib/ai/scheduling/booker';

export const maxDuration = 60;

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    // 1. Auth.
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch do deal — a RLS é o gate de autorização (só vê o que pode agir). Sem isto, user
    //    da org A cancelaria reunião de deal da org B (foi HIGH multi-tenant na revisão do áudio→CRM).
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, custom_fields')
      .eq('id', dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const existingCf = (deal.custom_fields as Record<string, unknown> | null) ?? {};
    const ra = (existingCf.reuniao_agendada as Record<string, unknown> | null) ?? null;

    // Idempotência: já cancelada → no-op.
    if (ra?.status === 'cancelada') {
      return NextResponse.json({ dealId, already_cancelled: true }, { status: 200 });
    }

    // Admin client (service role) pro write de sistema — cancelMeeting mexe em activities e deals.
    const admin = createStaticAdminClient();

    // 3. Resolve o activity_id. Preferência: o do JSON. Fallback (deal legado / agendado à mão,
    //    ex.: Josiane): a activity CALL aberta do deal.
    let activityId = (ra?.activity_id as string | undefined) ?? undefined;
    if (!activityId) {
      const { data: call } = await admin
        .from('activities')
        .select('id')
        .eq('deal_id', dealId)
        .eq('type', 'CALL')
        .is('deleted_at', null)
        .eq('completed', false)
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle();
      activityId = (call?.id as string | undefined) ?? undefined;
    }

    // Nada pra cancelar (sem activity nem status confirmado) → idempotente.
    if (!activityId) {
      return NextResponse.json({ dealId, already_cancelled: true, note: 'no activity' }, { status: 200 });
    }

    // 4. cancelMeeting (booker.ts:164) faz soft-delete da activity + status='cancelada' + remove
    //    a tag 'reuniao:agendada'. NÃO reimplementar.
    await cancelMeeting({ supabase: admin, dealId, activityId });

    return NextResponse.json({ dealId, cancelled: true }, { status: 200 });
  } catch (error) {
    console.error('[cancel-meeting]', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
