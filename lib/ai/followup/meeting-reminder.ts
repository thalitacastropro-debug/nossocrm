/**
 * @fileoverview Cadência 3 — lembrete anti-no-show da Ana. Copy FIXA (zero IA) + orquestrador.
 * Ancora em `activities`, NÃO em custom_fields.reuniao_agendada — ver spec §3.
 * @module lib/ai/followup/meeting-reminder
 */
import { firstName } from './copy';

/**
 * Copy fixa. Sem IA de propósito: o conteúdo é um horário que já vem pronto do
 * slotLabelFromIso, e em 07-15 a IA alucinou "[estado/cidade]" num toque quente
 * (ana-tuning-log #7). Bolhas curtas, sem emoji, sem travessão, "consultor" nunca "vendedor".
 */
export const TOQUES_COPY: Record<'vespera' | 'ativacao', string[]> = {
  // Véspera — 17h do último dia útil antes. Data ABSOLUTA (nunca "amanhã"): a véspera de uma
  // reunião de segunda sai na sexta, e o texto precisa continuar verdadeiro.
  vespera: [
    '{nome}, passando pra confirmar: sua conversa com {consultor} é {label}.',
    'É uma ligação rápida, de uns 30 minutos. Se precisar mudar o horário, é só me falar por aqui.',
  ],
  // Ativação — 30min antes. O toque que de fato combate o no-show.
  ativacao: [
    '{nome}, {consultor} já vai te ligar, daqui a pouco.',
    'Deixa o telefone à mão.',
  ],
};

/**
 * A Ana NUNCA diz o nome de quem vai ligar — sempre "o consultor".
 *
 * Decisão da Thalita em 31/08/2026: *"em vez da Ana dizer que o Denilson vai
 * ligar, deixa só como consultor, pois agora temos mais colaboradores"*. O
 * lembrete lia o dono da atividade e mandava o primeiro nome dele, o que (a)
 * prometia uma pessoa específica num time que rodízia e (b) envelhecia mal
 * quando o card trocava de dono entre o agendamento e a véspera.
 */
export const CONSULTOR_GENERICO = 'o consultor';

export type ReminderVars = { nome: string; label: string; consultor: string };

/**
 * Interpola e junta as bolhas. NÃO usa o renderBubbles do copy.ts: ele só resolve {nome}
 * (copy.ts:50-58) e a assinatura nem recebe outras variáveis — seguir o design ao pé da letra
 * com ele entregaria "{label}" literal no WhatsApp, e isso COMPILA limpo (tsconfig strict:false,
 * no-unused-vars desligado). Não mexemos no renderBubbles pra não tocar no motor do B1.
 */
export function renderReminder(bolhas: string[], vars: ReminderVars): string {
  return bolhas
    .map((b) => {
      let out = b;
      for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
      return out.replace(/\s{2,}/g, ' ').replace(/\s+([,!?.])/g, '$1').replace(/^,\s*/, '').trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

export { firstName };

import type { SupabaseClient } from '@supabase/supabase-js';
import { slotLabelFromIso } from '../scheduling/availability';
import { deveEnviar, type Toque } from './meeting-reminder-schedule';

/** Horizonte da query: a véspera mais distante é a de uma reunião de segunda (sexta 17h = 3d). */
const HORIZONTE_DIAS = 4;
const SP_UTC_OFFSET = '-03:00';

export interface MeetingReminderDeps {
  supabase: SupabaseClient;
  now: Date;
  sendResponse: (conversationId: string, message: string) => Promise<{ success: boolean }>;
}

export interface MeetingReminderResult { processed: number; failed: number; skipped: number; }

/**
 * Estado por REUNIÃO (uma sub-entrada por activity). Fica dentro do MAP
 * custom_fields.meeting_reminder chaveado por activity_id — NÃO um registro único por deal.
 * Um deal pode ter 2 ligações abertas (ex.: Josiane, com JSON de schema divergente que o guard
 * do booker não pega, + uma marcada pela Ana): com registro único, processar a 2ª no mesmo tick
 * apagava o _sent_at da 1ª e o lembrete reenviava (risco de ban). O mapa isola cada reunião.
 */
interface SubEstado {
  date: string;
  vespera_sent_at?: string | null;
  ativacao_sent_at?: string | null;
}

type EstadoMap = Record<string, SubEstado>;

type CF = Record<string, unknown>;

export async function runMeetingReminder(deps: MeetingReminderDeps): Promise<MeetingReminderResult> {
  const { supabase, now } = deps;
  const res: MeetingReminderResult = { processed: 0, failed: 0, skipped: 0 };

  // 1. FONTE DA VERDADE = activities. O JSON reuniao_agendada é podre (status terminal,
  //    schema divergente quando agendado por SQL, dessincronizado do calendário). Ver spec §3.
  const ateIso = new Date(now.getTime() + HORIZONTE_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const { data: acts } = await supabase
    .from('activities')
    .select('id, deal_id, date, created_at, owner_id')
    .eq('type', 'CALL')
    .is('deleted_at', null)
    .eq('completed', false)
    .gte('date', now.toISOString())
    .lte('date', ateIso)
    .not('deal_id', 'is', null);

  if (!acts || acts.length === 0) return res;

  const dealIds = [...new Set(acts.map((a) => a.deal_id as string))];
  const { data: deals } = await supabase
    .from('deals')
    .select('id, organization_id, contact_id, custom_fields')
    .in('id', dealIds)
    .eq('is_won', false)
    .eq('is_lost', false)
    .is('deleted_at', null);
  const dealById = new Map((deals ?? []).map((d) => [d.id as string, d]));

  const contactIds = [...new Set((deals ?? []).map((d) => d.contact_id as string).filter(Boolean))];
  if (contactIds.length === 0) return res;

  // Conversa MAIS RECENTE do contato (achado #3 da revisão do B1: contato multi-canal).
  const { data: convs } = await supabase
    .from('messaging_conversations')
    .select('id, contact_id, last_message_at')
    .in('contact_id', contactIds)
    .order('last_message_at', { ascending: false });
  const convByContact = new Map<string, Record<string, unknown>>();
  for (const c of convs ?? []) {
    const cid = c.contact_id as string | null;
    if (!cid || convByContact.has(cid)) continue;
    convByContact.set(cid, c);
  }

  const { data: contacts } = await supabase.from('contacts').select('id, name').in('id', contactIds);
  const contactById = new Map((contacts ?? []).map((c) => [c.id as string, c]));

  // Não lemos mais `profiles` aqui: o lembrete fala sempre "o consultor"
  // (ver CONSULTOR_GENERICO), então o dono da atividade não entra na copy.

  for (const act of acts) {
    const deal = dealById.get(act.deal_id as string);
    if (!deal) { res.skipped++; continue; }
    const contactId = deal.contact_id as string | null;
    const conv = contactId ? convByContact.get(contactId) : null;
    const contact = contactId ? contactById.get(contactId) : null;
    if (!conv || !contact) { res.skipped++; continue; }

    // NÃO checamos contact.ai_paused: o lembrete é aviso operacional de hora marcada, não
    // conversa (spec §2, decisão 3). Nem last_message_direction: o gatilho aqui é hora
    // marcada, não silêncio (decisão 4).

    const cf = (deal.custom_fields as CF | null) ?? {};

    // Guard do no-show — o único que a activities não resolve (a rota de no-show não toca na
    // activity, só grava no JSON). Comparar com created_at e NUNCA `no_show === true` flat:
    // ninguém limpa no_show, então o flat mataria o lembrete de todo lead que remarcou.
    const noShowAt = Date.parse(String(cf.no_show_at ?? ''));
    const criadaEmMs = Date.parse(act.created_at as string);
    if (Number.isFinite(noShowAt) && Number.isFinite(criadaEmMs) && noShowAt > criadaEmMs) {
      res.skipped++; continue;
    }

    const dataHora = act.date as string;
    const actId = act.id as string;
    // O mapa é lido do custom_fields ATUAL do deal — que pode ter sido atualizado em memória
    // por uma activity IRMÃ já processada neste mesmo tick (write-back abaixo). Sem isso, a 2ª
    // reunião do mesmo deal leria o snapshot pré-tick e apagaria o _sent_at da 1ª.
    const mapa = (cf.meeting_reminder as EstadoMap | undefined) ?? {};
    const anterior = mapa[actId];
    // Sub-estado só vale pra ESTA data: date novo na MESMA activity (edição manual na página de
    // Atividades) ⇒ recomeça. Remarcação pelo booker cria activity nova ⇒ chave nova, fresca.
    const sub: SubEstado = anterior && anterior.date === dataHora ? anterior : { date: dataHora };

    const toque: Toque | null =
      deveEnviar({ toque: 'ativacao', dataHora, criadaEm: act.created_at as string, agora: now, enviadoEm: sub.ativacao_sent_at })
        ? 'ativacao'
        : deveEnviar({ toque: 'vespera', dataHora, criadaEm: act.created_at as string, agora: now, enviadoEm: sub.vespera_sent_at })
          ? 'vespera'
          : null;
    if (!toque) { res.skipped++; continue; }

    const msg = renderReminder(TOQUES_COPY[toque], {
      nome: firstName((contact.name as string | null) ?? ''),
      label: slotLabelFromIso(dataHora, SP_UTC_OFFSET),
      consultor: CONSULTOR_GENERICO,
    });

    // Idempotência: PERSISTE ANTES de enviar (lição do B1). Se morrer entre gravar e mandar, o
    // lead perde um lembrete; ao contrário, levaria o mesmo a cada 15min — em canal com risco
    // de ban, erra pro lado do silêncio. Merge preservando as OUTRAS reuniões do deal.
    const avancado: SubEstado = { ...sub, [`${toque}_sent_at`]: now.toISOString() };
    const novoCf: CF = { ...cf, meeting_reminder: { ...mapa, [actId]: avancado } };
    const okPersist = await persistir(supabase, deal.id as string, novoCf);
    if (!okPersist) { res.failed++; continue; }
    // Write-back em memória: uma activity irmã do MESMO deal, mais adiante neste tick, vê a
    // gravação (o objeto `deal` é o mesmo do dealById).
    deal.custom_fields = novoCf;

    const sent = await deps.sendResponse(conv.id as string, msg);
    if (!sent.success) {
      // Reverte SÓ esta reunião, mantendo as irmãs já avançadas neste tick (best-effort).
      const revertCf: CF = { ...cf, meeting_reminder: { ...mapa, [actId]: sub } };
      await persistir(supabase, deal.id as string, revertCf);
      deal.custom_fields = revertCf;
      res.failed++;
      continue;
    }
    res.processed++;
  }

  return res;
}

async function persistir(supabase: SupabaseClient, dealId: string, novoCf: CF): Promise<boolean> {
  // novoCf já vem com o spread do existente + meeting_reminder mesclado. custom_fields é REPLACE
  // TOTAL no update, então gravamos o objeto inteiro.
  const { error } = await supabase
    .from('deals')
    .update({ custom_fields: novoCf, updated_at: new Date().toISOString() })
    .eq('id', dealId);
  if (error) { console.error('[meeting-reminder] persist falhou p/ deal', dealId, error); return false; }
  return true;
}
