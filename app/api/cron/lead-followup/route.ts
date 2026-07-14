/**
 * GET /api/cron/lead-followup
 *
 * Reengaja leads da Ana que pararam de responder (cadência fria e quente). Protegido por
 * CRON_SECRET (Bearer). Chamado a cada 15 min pelo pg_cron (migration
 * 20260713140000_lead_followup_cron.sql). Este endpoint é a AUTORIDADE do horário comercial.
 *
 * Núcleo em lib/ai/followup/run.ts (testado isoladamente). Aqui: auth + gate de horário +
 * injeção das deps reais (admin client, sendAIResponse, geração quente, relógio).
 */
import { createStaticAdminClient } from '@/lib/supabase/server';
import { sendAIResponse } from '@/lib/ai/agent/agent.service';
import { runLeadFollowup } from '@/lib/ai/followup/run';
import { generateWarmFollowupBubbles } from '@/lib/ai/followup/generate';

export const maxDuration = 60;

const BUSINESS_HOURS = { start: '08:00', end: '17:30', daysOfWeek: [1, 2, 3, 4, 5] };
const TZ_OFFSET_HOURS = -3; // America/Sao_Paulo, offset fixo (igual à lib/ai/scheduling)

function isWithinBusinessHours(now: Date): boolean {
  const local = new Date(now.getTime() + TZ_OFFSET_HOURS * 60 * 60 * 1000);
  const day = local.getUTCDay();
  if (!BUSINESS_HOURS.daysOfWeek.includes(day)) return false;
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const [sH, sM] = BUSINESS_HOURS.start.split(':').map(Number);
  const [eH, eM] = BUSINESS_HOURS.end.split(':').map(Number);
  return minutes >= sH * 60 + sM && minutes <= eH * 60 + eM;
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export async function GET(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) return json({ error: 'Unauthorized' }, 401);

  const now = new Date();
  if (!isWithinBusinessHours(now)) return json({ skipped: true, reason: 'Fora do horário comercial' });

  const supabase = createStaticAdminClient();
  const result = await runLeadFollowup({
    supabase,
    now,
    sendResponse: (conversationId, message) =>
      sendAIResponse({ supabase, conversationId, response: message }).then((r) => ({ success: r.success })),
    generateWarm: (args) => generateWarmFollowupBubbles({ supabase, ...args }),
  });

  console.log('[Cron:lead-followup]', JSON.stringify(result));
  return json(result);
}
