/**
 * POST /api/deals/[dealId]/meeting-held — par positivo do No-show.
 *
 * Marca a CALL agendada como completed (alimenta a métrica de reuniões
 * realizadas) e grava custom_fields.reuniao_realizada. NÃO move de board
 * (diferente do no-show: fechamento positivo, sem mensagem de resgate).
 * Lead sem agendamento da Ana (indicação/orgânico) → cria MEETING completed
 * (nunca CALL — índice único uniq_consultant_call_slot). Idempotente.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';

export const maxDuration = 30;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // RLS é o gate de autorização (só vê deals da própria org).
    const { data: deal, error: dealErr } = await supabase
      .from('deals')
      .select('id, organization_id, owner_id, custom_fields')
      .eq('id', dealId)
      .single();
    if (dealErr || !deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });

    const existingCf = (deal.custom_fields as Record<string, unknown> | null) ?? {};
    const already = existingCf.reuniao_realizada as { realizada?: boolean } | undefined;
    if (already?.realizada) return NextResponse.json({ dealId, already_marked: true }, { status: 200 });

    const nowIso = new Date().toISOString();
    const admin = createStaticAdminClient();
    const orgId = deal.organization_id as string;
    const ownerId = (deal.owner_id as string | null) ?? user.id;
    const agendada = existingCf.reuniao_agendada as { activity_id?: string } | undefined;

    if (agendada?.activity_id) {
      await admin.from('activities').update({ completed: true }).eq('id', agendada.activity_id);
    } else {
      // Lead sem agendamento da Ana → MEETING completed (não colide com o índice de CALL).
      await admin.from('activities').insert({
        organization_id: orgId, deal_id: dealId, owner_id: ownerId,
        type: 'MEETING', title: 'Reunião realizada', description: 'Marcada manualmente pelo consultor',
        date: nowIso, completed: true,
      });
    }

    // custom_fields é REPLACE total → spread obrigatório.
    const { error: updErr } = await supabase
      .from('deals')
      .update({
        custom_fields: { ...existingCf, reuniao_realizada: { realizada: true, at: nowIso, by: user.id } },
        updated_at: nowIso,
      })
      .eq('id', dealId);
    if (updErr) {
      if ((updErr as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'Conflito ao marcar reunião.' }, { status: 409 });
      }
      console.error('[meeting-held] deal update failed:', updErr.message);
      return NextResponse.json({ error: 'Failed to mark meeting held' }, { status: 500 });
    }

    return NextResponse.json({ dealId, marked: true }, { status: 200 });
  } catch (error) {
    console.error('[meeting-held]', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
