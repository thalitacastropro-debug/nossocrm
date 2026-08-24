/**
 * @fileoverview Cron do monitor de silêncio — avisa quando a entrada de leads para.
 *
 * A entrada de leads depende de uma automação que roda na conta da AGÊNCIA de
 * tráfego. Quando ela para, nada no CRM acusa: o funil só fica quieto. Em
 * 21/08/2026 as chamadas cessaram às 06:22 e a Niva levou três dias para notar.
 *
 * Roda uma vez por dia útil, de manhã. Uma vez por dia é de propósito: é o
 * anti-spam mais simples que existe — sem tabela de estado, sem dedupe, sem mais
 * uma coluna para manter. Um alarme por dia é o suficiente para uma parada que
 * custa lead, e é pouco o bastante para ninguém aprender a ignorar.
 *
 * A regra de decisão e o porquê dos limites estão em `lib/monitoring/silencio`.
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}`, igual aos outros crons.
 *
 * @module app/api/cron/monitor-silencio/route
 */

import { createStaticAdminClient } from '@/lib/supabase/server';
import { sendTelegramMessage } from '@/lib/notifications/telegram';
import { avaliarSilencio, horasUteisEntre } from '@/lib/monitoring/silencio';

export const runtime = 'nodejs';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET(req: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabase = createStaticAdminClient();
  const agora = new Date();

  // Último lead que entrou pela esteira. Filtro por `lead_form` e não pelo título:
  // o título muda de agência para agência, o formato do payload não.
  const { data: ultimoLead } = await supabase
    .from('deals')
    .select('created_at')
    .not('custom_fields->lead_form', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Última mensagem RECEBIDA. É a prova de vida da esteira: quando entra lead, a
  // Ana escreve e a pessoa responde.
  const { data: ultimaMensagem } = await supabase
    .from('messaging_messages')
    .select('created_at')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Base nunca populada: não há silêncio a medir, e alarmar aqui seria ruído puro.
  if (!ultimoLead?.created_at || !ultimaMensagem?.created_at) {
    return json({ nivel: 'ok', motivo: 'sem histórico suficiente para medir silêncio' });
  }

  const horasSemLead = horasUteisEntre(new Date(ultimoLead.created_at as string), agora);
  const horasSemMensagem = horasUteisEntre(new Date(ultimaMensagem.created_at as string), agora);

  const veredicto = avaliarSilencio({ horasSemLead, horasSemMensagem });

  const resultado = {
    nivel: veredicto.nivel,
    motivo: veredicto.motivo,
    horasSemLead,
    horasSemMensagem,
    ultimoLead: ultimoLead.created_at,
    ultimaMensagem: ultimaMensagem.created_at,
    avisado: false,
  };

  if (veredicto.nivel === 'ok') return json(resultado);

  const { data: cfg } = await supabase
    .from('organization_settings')
    .select('telegram_bot_token, telegram_chat_id')
    .limit(1)
    .maybeSingle();

  if (cfg?.telegram_bot_token && cfg?.telegram_chat_id) {
    try {
      await sendTelegramMessage(
        cfg.telegram_bot_token as string,
        cfg.telegram_chat_id as string,
        veredicto.mensagem,
      );
      resultado.avisado = true;
    } catch (erro) {
      // Falha de aviso não pode derrubar o cron — mas tem que aparecer no log,
      // senão o monitor fica mudo do mesmo jeito que o problema que ele vigia.
      console.error('[monitor-silencio] Telegram falhou:', erro instanceof Error ? erro.message : erro);
    }
  } else {
    console.warn('[monitor-silencio] Sem token/chat do Telegram configurado — alarme não enviado.');
  }

  return json(resultado);
}
