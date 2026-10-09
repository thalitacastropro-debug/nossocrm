/**
 * POST /api/deals/[dealId]/call-outcome/discard  { audioFilePath }
 *
 * O consultor disse que NÃO quer esta gravação: ela sai da lista de pendentes do card.
 * O arquivo FICA no storage — descartar aqui é "não me mostre mais", não apagar.
 *
 * Só existe porque a gravação agora nasce `pendente` (ver ../route.ts): sem um jeito explícito de
 * dizer "esta não", o botão Descartar da revisão deixaria a gravação pendurada no card para sempre.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { pathDeGravacaoDoDeal, resolverGravacao } from '@/lib/supabase/dealFilesServer';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!dealId || !uuidRegex.test(dealId)) {
    return NextResponse.json({ error: 'Invalid or missing dealId' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { audioFilePath?: unknown };
  if (!pathDeGravacaoDoDeal(dealId, body.audioFilePath)) {
    return NextResponse.json({ error: 'audioFilePath inválido para este card' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // RLS de deals é o gate — a escrita abaixo é service-role.
  const { data: deal, error: dealErr } = await supabase
    .from('deals').select('id').eq('id', dealId).single();
  if (dealErr || !deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });

  const { error } = await resolverGravacao(dealId, body.audioFilePath, 'descartado');
  if (error) {
    console.error('[call-outcome/discard] update failed:', error.message);
    return NextResponse.json({ error: 'Não foi possível descartar a gravação' }, { status: 500 });
  }
  return NextResponse.json({ dealId, discarded: true }, { status: 200 });
}
