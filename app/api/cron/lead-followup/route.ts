/**
 * GET /api/cron/lead-followup
 *
 * Reengaja leads da Ana que pararam de responder (cadência fria e quente). Protegido por
 * CRON_SECRET (Bearer). Chamado a cada 15 min pelo pg_cron (migration
 * 20260713140000_lead_followup_cron.sql).
 *
 * Núcleo em lib/ai/followup/run.ts (testado isoladamente). Aqui: auth + os dois gates de janela +
 * injeção das deps reais (admin client, sendAIResponse, geração quente, relógio).
 *
 * DUAS JANELAS desde 09/09/2026 — antes era uma só, e este endpoint era "a autoridade do horário
 * comercial" para tudo que pendura aqui:
 *   - `JANELA_ANA` (08:00–21:00, seg–sáb): a Ana falando com o LEAD. Mora em followup/schedule.ts.
 *   - `EXPEDIENTE_HUMANO` (08:00–17:30, seg–sex): o que vira aviso para uma PESSOA.
 * Separar foi obrigatório ao alargar a primeira: sem isso, escalação de handoff sairia às 21h de
 * um sábado.
 */
import { createStaticAdminClient } from '@/lib/supabase/server';
import { sendAIResponse, sendAIMedia } from '@/lib/ai/agent/agent.service';
import { runLeadFollowup, type AnexoDeToque } from '@/lib/ai/followup/run';
import { anaPodeFalar } from '@/lib/ai/followup/schedule';
import { generateWarmFollowupBubbles } from '@/lib/ai/followup/generate';
import { runMeetingReminder } from '@/lib/ai/followup/meeting-reminder';
import { runHandoffSla } from '@/lib/ai/followup/handoff-sla-run';
import {
  formatHandoffEscalationMessage,
  formatFollowupFalhasMessage,
  sendTelegramMessage,
} from '@/lib/notifications/telegram';

export const maxDuration = 60;

// A janela em que a Ana pode falar mora em `JANELA_ANA` (lib/ai/followup/schedule.ts), junto com o
// resto da lógica pura da cadência e com teste próprio. Estava duplicada aqui como texto ('08:00',
// '17:30') — e era ESTA cópia que decidia de verdade, então a regra real não aparecia em lugar
// nenhum que alguém fosse ler ao mexer na cadência.
//
// ⚠️ NÃO unificar com o expediente HUMANO abaixo: aquele governa o prazo que o consultor tem para
// pegar o lead ("2 horas úteis", "1 dia útil = 9h30", ver handoff-sla.ts). Os dois já tiveram os
// mesmos números por coincidência, e juntá-los faria o segundo aviso de handoff disparar às 21h de
// um sábado — justamente o bug da Mônica que aquele arquivo existe para prevenir.

/**
 * Expediente HUMANO: 08:00–17:30, seg–sex. Governa o que vira aviso para uma PESSOA (SLA do
 * handoff) e o lembrete de reunião. Espelha a régua de `handoff-sla.ts`, que faz a matemática de
 * hora útil — aqui só decidimos se é hora de disparar.
 */
const EXPEDIENTE_HUMANO = { inicioMin: 8 * 60, fimMin: 17 * 60 + 30, dias: [1, 2, 3, 4, 5] };
const TZ_OFFSET_HOURS = -3; // America/Sao_Paulo, offset fixo (igual à lib/ai/scheduling)

function dentroDoExpedienteHumano(now: Date): boolean {
  const local = new Date(now.getTime() + TZ_OFFSET_HOURS * 60 * 60 * 1000);
  if (!EXPEDIENTE_HUMANO.dias.includes(local.getUTCDay())) return false;
  const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutos >= EXPEDIENTE_HUMANO.inicioMin && minutos <= EXPEDIENTE_HUMANO.fimMin;
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export async function GET(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) return json({ error: 'Unauthorized' }, 401);

  const now = new Date();
  // DUAS janelas, de propósito (09/09/2026). A da Ana é larga (08:00–21:00, seg–sáb) porque ela é
  // uma IA falando com o lead; a humana continua 08:00–17:30 seg–sex porque governa aviso que cai
  // no colo de uma pessoa. Antes era um gate só, e alargá-lo mandaria escalação de handoff pro
  // time às 21h de sábado.
  // A humana é subconjunto da da Ana, então basta ela como porteira externa.
  const podeFalar = anaPodeFalar(now);
  if (!podeFalar) return json({ skipped: true, reason: 'Fora da janela de atendimento da Ana' });
  const expedienteHumano = dentroDoExpedienteHumano(now);

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

  /**
   * Manda um aviso pro chat do time E pro da dona (quando configurado). Usado pelos dois
   * alarmes deste cron. Nunca joga: alarme que derruba o lote é pior que alarme perdido.
   */
  const avisarNoTelegram = async (message: string, origem: string) => {
    const { data: cfg } = await supabase
      .from('organization_settings')
      .select('telegram_bot_token, telegram_chat_id, telegram_chat_id_alerts')
      .maybeSingle();
    if (!cfg?.telegram_bot_token) return;
    // Set evita mandar 2x quando o chat do time e o da dona são o mesmo.
    const destinos = new Set(
      [cfg.telegram_chat_id, cfg.telegram_chat_id_alerts].filter(Boolean) as string[]
    );
    await Promise.all(
      [...destinos].map((chatId) =>
        sendTelegramMessage(cfg.telegram_bot_token as string, chatId, message).catch((err: unknown) =>
          console.error(`[Cron:${origem}] Telegram falhou (não-fatal):`, chatId, err)
        )
      )
    );
  };

  const followup = await runLeadFollowup({
    supabase,
    now,
    sendResponse,
    anexo,
    // Cadência parada por falhas seguidas de envio: quase sempre é a instância do
    // WhatsApp caída, não o lead. Sem este aviso a Ana retentava calada (28/08/2026).
    notify: ({ dealId, contactName, falhas }) =>
      avisarNoTelegram(
        formatFollowupFalhasMessage({
          contactName,
          falhas,
          appUrl: process.env.NEXT_PUBLIC_APP_URL,
          dealId,
        }),
        'lead-followup'
      ),
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
  // Segue no EXPEDIENTE HUMANO: ancora em reunião marcada com consultor, então alargar a janela
  // aqui só produziria lembrete de reunião no sábado à noite para um compromisso de segunda.
  const reminder = expedienteHumano
    ? await runMeetingReminder({ supabase, now, sendResponse })
    : { enviados: 0, pulados: 0, erros: 0, skipped: 'fora_do_expediente_humano' as const };

  // SLA do handoff (P0.4, 4ª causa): lead entregue ao humano que ninguém pegou.
  // 2h úteis sem ninguém assumir → 2º aviso (chat do time + o da dona). NÃO há retomada da Ana:
  // uma vez entregue, o lead é do consultor (regra da Thalita, 21/08) — e o card já saiu do funil
  // dela. Pendurado aqui de propósito: reusa o job pg_cron.
  // Roda SÓ no expediente humano: é aviso que cai no colo de uma pessoa. Quando a janela da Ana
  // foi alargada para 21h/sábado (09/09/2026), este gate deixou de poder ser o mesmo.
  const handoffSla = !expedienteHumano ? null : await runHandoffSla({
    supabase,
    now,
    notify: ({ dealId, contactName, dealTitle, horasUteis, lastMessage }) =>
      avisarNoTelegram(
        formatHandoffEscalationMessage({
          contactName,
          dealTitle,
          horasUteis,
          lastMessage,
          appUrl: process.env.NEXT_PUBLIC_APP_URL,
          dealId: dealId ?? undefined,
        }),
        'handoff-sla'
      ),
  });

  console.log('[Cron:lead-followup]', JSON.stringify({ followup, reminder, handoffSla }));
  return json({ followup, reminder, handoffSla });
}
