/**
 * @fileoverview Cron do SLA de handoff — vigia lead entregue ao humano que ninguém pegou.
 *
 * A matemática e a decisão vivem em `handoff-sla.ts` (puras, testadas). Aqui só I/O:
 * seleção, envio e persistência. Mesmo desenho de `run.ts` / `meeting-reminder.ts`.
 *
 * Roda dentro do cron `lead-followup` (a cada 15 min, já gateado por horário comercial) —
 * não precisa de job novo no pg_cron.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveHandoffSla, type HandoffSlaState } from './handoff-sla';

export interface HandoffSlaDeps {
  supabase: SupabaseClient;
  now: Date;
  /** Dispara o segundo aviso. O chamador decide os destinos (consultor + dona). */
  notify: (args: {
    conversationId: string;
    dealId: string | null;
    contactName: string;
    dealTitle: string;
    horasUteis: number;
    lastMessage: string;
  }) => Promise<void>;
}

export interface HandoffSlaResultado {
  vigiados: number;
  encerrados: number;
  avisados: number;
}

/**
 * A ANA NÃO VOLTA A ATENDER (regra da Thalita, 21/08).
 *
 * A 1ª versão deste módulo tinha um terceiro degrau: depois de 1 dia útil sem ninguém assumir, a
 * Ana retomaria a conversa. A dona derrubou, e com dois argumentos que eu não tinha:
 *
 *  1. Se a Ana entrega, o lead é responsabilidade do CONSULTOR — ela não volta. Um lead com dois
 *     donos não tem dono.
 *  2. Mais grave: o consultor **não enxerga o funil da Ana**. Enquanto o `notify_team` só escrevia
 *     uma flag e mandava um Telegram, o card ficava com ela e ninguém do outro lado via nada. Não
 *     havia entrega nenhuma — só um bilhete. A pergunta que eu ia fazer ao lead ("o consultor já
 *     falou com você?") era sobre algo que era IMPOSSÍVEL ter acontecido.
 *
 * O fix de verdade ficou em `lib/ai/scheduling/handoff.ts`: o handoff MOVE o card pro funil do
 * consultor. Aqui sobrou só o escalonamento do aviso.
 */
const BATCH = 50;

export async function runHandoffSla(deps: HandoffSlaDeps): Promise<HandoffSlaResultado> {
  const { supabase, now, notify } = deps;
  const res: HandoffSlaResultado = { vigiados: 0, encerrados: 0, avisados: 0 };

  // 1. Conversas com handoff pendente. A flag existe desde sempre — o que faltava era alguém LER.
  const { data: convs } = await supabase
    .from('messaging_conversations')
    .select('id, contact_id, metadata')
    .eq('metadata->>ai_handoff_pending', 'true')
    .limit(BATCH);

  if (!convs?.length) return res;
  res.vigiados = convs.length;

  for (const conv of convs) {
    const meta = (conv.metadata ?? {}) as Record<string, unknown>;
    const handoffAt = meta.ai_handoff_at as string | undefined;
    // Sem carimbo não dá pra medir prazo. Não inventa "agora" — isso zeraria o relógio a cada
    // tick e o lead nunca venceria o SLA. Só ignora (handoffs legados).
    if (!handoffAt) continue;

    // 2. Alguém do time falou DEPOIS do handoff? (sender_type != 'ai' = humano)
    const { data: humanReply } = await supabase
      .from('messaging_messages')
      .select('created_at')
      .eq('conversation_id', conv.id)
      .eq('direction', 'outbound')
      .neq('sender_type', 'ai')
      .gt('created_at', handoffAt)
      .order('created_at')
      .limit(1)
      .maybeSingle();

    const state: HandoffSlaState = {
      handoffAt,
      segundoAvisoAt: (meta.ai_handoff_sla_aviso_at as string | null) ?? null,
      humanRepliedAt: humanReply?.created_at ?? null,
    };

    const { acao, minutosUteis } = resolveHandoffSla(state, now);
    if (acao === 'nada') continue;

    if (acao === 'encerrar') {
      await patchMeta(supabase, conv.id, meta, { ai_handoff_pending: false });
      res.encerrados++;
      continue;
    }

    // Dados do card só são buscados quando há ação — evita N+1 no caminho comum.
    const info = await fetchCardInfo(supabase, conv.id, conv.contact_id as string | null);

    if (acao === 'segundo_aviso') {
      await notify({
        conversationId: conv.id,
        dealId: info.dealId,
        contactName: info.contactName,
        dealTitle: info.dealTitle,
        horasUteis: Math.floor(minutosUteis / 60),
        lastMessage: info.lastMessage,
      });
      await patchMeta(supabase, conv.id, meta, { ai_handoff_sla_aviso_at: now.toISOString() });
      res.avisados++;
    }
  }

  return res;
}

/** Merge raso no metadata — nunca sobrescreve o objeto inteiro (outras chaves vivem ali). */
async function patchMeta(
  supabase: SupabaseClient,
  conversationId: string,
  atual: Record<string, unknown>,
  patch: Record<string, unknown>
): Promise<void> {
  await supabase
    .from('messaging_conversations')
    .update({ metadata: { ...atual, ...patch } })
    .eq('id', conversationId);
}

async function fetchCardInfo(
  supabase: SupabaseClient,
  conversationId: string,
  contactId: string | null
): Promise<{ dealId: string | null; dealTitle: string; contactName: string; lastMessage: string }> {
  const [deal, contact, msg] = await Promise.all([
    contactId
      ? supabase
          .from('deals')
          .select('id, title')
          .eq('contact_id', contactId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    contactId
      ? supabase.from('contacts').select('name, phone').eq('id', contactId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('messaging_messages')
      .select('content')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const c = contact.data as { name?: string; phone?: string } | null;
  const content = (msg.data as { content?: Record<string, unknown> } | null)?.content;

  return {
    dealId: (deal.data as { id?: string } | null)?.id ?? null,
    dealTitle: (deal.data as { title?: string } | null)?.title ?? 'Deal',
    contactName: c?.name || c?.phone || 'Lead',
    lastMessage: (content?.text as string) || '[mensagem]',
  };
}
