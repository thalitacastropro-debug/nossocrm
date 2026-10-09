/**
 * NOVA TENTATIVA do 1º toque que falhou (09/10/2026).
 *
 * Antes não existia: a rota de entrada tentava UMA vez e, falhando, gravava
 * `first_touch.status = 'failed'` e ninguém mais olhava. Com o WhatsApp fora de 06 a 08/10,
 * giani e Flávia Muniz entraram e nunca receberam nada — e a cadência de follow-up ainda tentou
 * mandar "ainda por aí?" para quem nunca recebeu a apresentação.
 *
 * Roda dentro do cron de follow-up (15 em 15 min, só na janela da Ana) e, para cada card aberto
 * com 1º toque falhado nos últimos 7 dias:
 *   - já houve contato de verdade na conversa (o lead escreveu ou alguém mandou) → `superado`,
 *     nada é enviado: a apresentação atrasada atropelaria a conversa que já começou;
 *   - erro permanente (número sem WhatsApp) ou tentativas esgotadas → `desistiu` + aviso ao time
 *     para LIGAR (caso Igor Moraes: 291 envios falhados para um número que não tem WhatsApp);
 *   - senão, manda a apresentação de novo, com o MESMO código da entrada.
 *
 * Se o envio falha para um lead, a rodada para ali: é quase sempre o canal fora, e insistir nos
 * outros só empilha falha. Deps injetadas (padrão do runLeadFollowup) para testar sem WhatsApp.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  jaHouveContato,
  erroPermanente,
  mergeDealFirstTouch,
  MAX_TENTATIVAS_PRIMEIRO_TOQUE,
  type SendResult,
} from './envio-primeiro-toque';

type CF = Record<string, unknown>;

/** Janela de busca: 1º toque que falhou há mais de uma semana já não é apresentação, é resgate. */
const JANELA_DIAS = 7;
/** Intervalo mínimo entre duas tentativas do mesmo card (o cron roda a cada 15 min). */
const INTERVALO_MIN_MS = 10 * 60 * 1000;
/** Quantos leads uma rodada tenta. Cada envio leva alguns segundos (bolhas com pausa) e o cron tem 60s. */
const POR_RODADA = 2;

export interface RetentarDeps {
  supabase: SupabaseClient;
  now: Date;
  montarBolhas: (args: {
    organizationId: string; boardId: string; firstName: string | null; leadForm: CF;
  }) => Promise<string[]>;
  enviar: (args: {
    conversationId: string; channelId: string; to: string; bubbles: string[];
  }) => Promise<SendResult>;
  /** Avisa o time que a apresentação não vai sair (alguém precisa LIGAR). Nunca deve jogar. */
  avisar?: (args: {
    dealId: string; contactName: string | null; motivo: string; tentativas: number;
  }) => Promise<void>;
  porRodada?: number;
}

export interface RetentarResult {
  enviados: number; falharam: number; desistiu: number; superados: number; pulados: number;
}

export async function retentarPrimeirosToques(deps: RetentarDeps): Promise<RetentarResult> {
  const { supabase, now } = deps;
  const res: RetentarResult = { enviados: 0, falharam: 0, desistiu: 0, superados: 0, pulados: 0 };
  const limite = deps.porRodada ?? POR_RODADA;

  const desde = new Date(now.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000).toISOString();
  const { data: deals } = await supabase
    .from('deals')
    .select('id, organization_id, board_id, contact_id, custom_fields, created_at')
    .eq('custom_fields->lead_form->first_touch->>status', 'failed')
    .eq('is_won', false)
    .eq('is_lost', false)
    .is('deleted_at', null)
    .not('contact_id', 'is', null)
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .limit(20);

  let tentadosNestaRodada = 0;

  for (const deal of deals ?? []) {
    const cf = (deal.custom_fields as CF | null) ?? {};
    const leadForm = (cf.lead_form as CF | null) ?? {};
    const ft = (leadForm.first_touch as CF | null) ?? {};
    const dealId = deal.id as string;
    const tentativas = (ft.tentativas as number | undefined) ?? 1;
    const ultima = ft.ultima_tentativa_em as string | undefined;

    if (ultima && now.getTime() - new Date(ultima).getTime() < INTERVALO_MIN_MS) {
      res.pulados++;
      continue;
    }

    const { data: conv } = await supabase
      .from('messaging_conversations')
      .select('id, channel_id, external_contact_id')
      .eq('contact_id', deal.contact_id as string)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!conv?.id || !conv.channel_id || !conv.external_contact_id) {
      res.pulados++;
      continue;
    }

    const { data: contato } = await supabase
      .from('contacts').select('name').eq('id', deal.contact_id as string).maybeSingle();
    const nome = (contato?.name as string | null) ?? null;

    const desistir = async (motivo: string, total: number, erro: string | null) => {
      await mergeDealFirstTouch(supabase, dealId, {
        ...ft, status: 'desistiu', desistiu_em: now.toISOString(), tentativas: total, error: erro,
      });
      res.desistiu++;
      if (deps.avisar) {
        await deps.avisar({ dealId, contactName: nome, motivo, tentativas: total })
          .catch((err: unknown) => console.error('[primeiro-toque] aviso nao saiu:', err));
      }
    };

    // Alguém já conversou: a apresentação atrasada atropelaria a conversa.
    if (await jaHouveContato(supabase, conv.id as string)) {
      await mergeDealFirstTouch(supabase, dealId, { ...ft, status: 'superado', superado_em: now.toISOString() });
      res.superados++;
      continue;
    }

    if (erroPermanente(ft.error as string | null)) {
      await desistir('o número não tem WhatsApp', tentativas, (ft.error as string | null) ?? null);
      continue;
    }
    if (tentativas >= MAX_TENTATIVAS_PRIMEIRO_TOQUE) {
      await desistir(`o envio falhou ${tentativas} vezes`, tentativas, (ft.error as string | null) ?? null);
      continue;
    }

    if (tentadosNestaRodada >= limite) {
      res.pulados++;
      continue;
    }
    tentadosNestaRodada++;

    const bubbles = await deps.montarBolhas({
      organizationId: deal.organization_id as string,
      boardId: deal.board_id as string,
      firstName: nome,
      leadForm,
    });
    const envio = await deps.enviar({
      conversationId: conv.id as string,
      channelId: conv.channel_id as string,
      to: conv.external_contact_id as string,
      bubbles,
    });

    const total = tentativas + 1;
    if (envio.success) {
      // `sent_at` = agora: é dele que a cadência de follow-up ancora o primeiro "ainda por aí?".
      await mergeDealFirstTouch(supabase, dealId, {
        ...ft,
        status: 'greeted',
        sent_at: now.toISOString(),
        message_id: envio.messageId ?? null,
        error: null,
        tentativas: total,
        ultima_tentativa_em: now.toISOString(),
        retomado_em: now.toISOString(),
      });
      res.enviados++;
      continue;
    }

    const erro = envio.error?.message ?? 'Falha ao enviar';
    if (erroPermanente(erro)) {
      // Problema DESTE número, não do canal: os próximos da fila seguem.
      await desistir('o número não tem WhatsApp', total, erro);
      continue;
    }
    if (total >= MAX_TENTATIVAS_PRIMEIRO_TOQUE) {
      await desistir(`o envio falhou ${total} vezes`, total, erro);
      break;
    }
    await mergeDealFirstTouch(supabase, dealId, {
      ...ft, status: 'failed', tentativas: total, ultima_tentativa_em: now.toISOString(), error: erro,
    });
    res.falharam++;
    // Falhou para um: quase sempre é o canal. Não insiste nos outros nesta rodada.
    break;
  }

  return res;
}
