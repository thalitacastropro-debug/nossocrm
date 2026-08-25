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
import { sendAIResponse, sendAIMedia } from '@/lib/ai/agent/agent.service';
import { runLeadFollowup, type AnexoDeToque } from '@/lib/ai/followup/run';
import { generateWarmFollowupBubbles } from '@/lib/ai/followup/generate';
import { runMeetingReminder } from '@/lib/ai/followup/meeting-reminder';
import { runHandoffSla } from '@/lib/ai/followup/handoff-sla-run';
import { formatHandoffEscalationMessage, sendTelegramMessage } from '@/lib/notifications/telegram';

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
  const sendResponse = (conversationId: string, message: string) =>
    sendAIResponse({ supabase, conversationId, response: message }).then((r) => ({ success: r.success }));

  // Anexo do toque (o vídeo do 3º toque frio). Guardado em
  // `organization_settings.followup_anexo`; ausente = cadência só com texto.
  const { data: cfgAnexo } = await supabase
    .from('organization_settings')
    .select('followup_anexo')
    .maybeSingle();

  const anexo = (cfgAnexo?.followup_anexo ?? null) as AnexoDeToque | null;

  const followup = await runLeadFollowup({
    supabase,
    now,
    sendResponse,
    anexo,
    sendMedia: (conversationId, a) =>
      sendAIMedia({
        supabase,
        conversationId,
        mediaUrl: a.url,
        contentType: a.tipo,
        caption: a.legenda,
        fileName: a.fileName,
        comoGravacao: a.comoGravacao,
      }).then((r) => ({ success: r.success })),
    generateWarm: (args) => generateWarmFollowupBubbles({ supabase, ...args }),
  });

  // Cadência 3 (lembrete anti-no-show). Módulo separado: seleção, matemática e parada são
  // outras — e ela ignora de propósito dois `if` que são a espinha do runLeadFollowup.
  const reminder = await runMeetingReminder({ supabase, now, sendResponse });

  // SLA do handoff (P0.4, 4ª causa): lead entregue ao humano que ninguém pegou.
  // 2h úteis sem ninguém assumir → 2º aviso (chat do time + o da dona). NÃO há retomada da Ana:
  // uma vez entregue, o lead é do consultor (regra da Thalita, 21/08) — e o card já saiu do funil
  // dela. Pendurado aqui de propósito: reusa o gate de horário comercial e o job pg_cron.
  const handoffSla = await runHandoffSla({
    supabase,
    now,
    notify: async ({ dealId, contactName, dealTitle, horasUteis, lastMessage }) => {
      const { data: cfg } = await supabase
        .from('organization_settings')
        .select('telegram_bot_token, telegram_chat_id, telegram_chat_id_alerts')
        .maybeSingle();
      if (!cfg?.telegram_bot_token) return;

      const message = formatHandoffEscalationMessage({
        contactName,
        dealTitle,
        horasUteis,
        lastMessage,
        appUrl: process.env.NEXT_PUBLIC_APP_URL,
        dealId: dealId ?? undefined,
      });

      // Chat do time + chat da dona (quando configurado). Set evita mandar 2x se forem o mesmo.
      const destinos = new Set(
        [cfg.telegram_chat_id, cfg.telegram_chat_id_alerts].filter(Boolean) as string[]
      );
      await Promise.all(
        [...destinos].map((chatId) =>
          sendTelegramMessage(cfg.telegram_bot_token as string, chatId, message).catch((err: unknown) =>
            console.error('[Cron:handoff-sla] Telegram falhou (não-fatal):', chatId, err)
          )
        )
      );
    },
  });

  console.log('[Cron:lead-followup]', JSON.stringify({ followup, reminder, handoffSla }));
  return json({ followup, reminder, handoffSla });
}
