import { describe, it, expect, vi } from 'vitest';
import {
  ultimoDiaUtilAntes, dueVespera, dueAtivacao, deveEnviar, VESPERA_MIN_GAP_MS,
} from '@/lib/ai/followup/meeting-reminder-schedule';
import {
  renderReminder, TOQUES_COPY, runMeetingReminder, type MeetingReminderDeps,
} from '@/lib/ai/followup/meeting-reminder';

// Referência: sexta 17/07/2026, segunda = 20/07/2026.
const SEG_15H = '2026-07-20T18:00:00.000Z'; // segunda 20/07 15h SP
const SEG_9H  = '2026-07-20T12:00:00.000Z'; // segunda 20/07 9h SP
const QUI_10H = '2026-07-23T13:00:00.000Z'; // quinta 23/07 10h SP

describe('ultimoDiaUtilAntes', () => {
  it('reunião na quinta → véspera na quarta 17h', () => {
    expect(ultimoDiaUtilAntes(QUI_10H)).toBe('2026-07-22T20:00:00.000Z'); // quarta 22/07 17h SP
  });

  it('reunião na SEGUNDA → véspera na SEXTA 17h (pula o fim de semana)', () => {
    expect(ultimoDiaUtilAntes(SEG_9H)).toBe('2026-07-17T20:00:00.000Z'); // sexta 17/07 17h SP
  });
});

describe('dueAtivacao', () => {
  it('é 30min antes da reunião', () => {
    expect(dueAtivacao(SEG_15H)).toBe('2026-07-20T17:30:00.000Z'); // segunda 14h30 SP
  });
});

describe('deveEnviar — véspera', () => {
  const marcadaEm = '2026-07-16T12:00:00.000Z'; // quinta 16/07 9h SP (bem antes da janela)

  it('envia dentro da janela [17h00, 17h30]', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T20:05:00.000Z'), enviadoEm: null,
    })).toBe(true);
  });

  it('NÃO envia antes da janela abrir', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T19:00:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });

  it('NÃO envia depois de expirar (cron parado) — queima', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T21:00:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });

  it('NÃO reenvia o que já foi enviado', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T20:05:00.000Z'), enviadoEm: '2026-07-17T20:00:00.000Z',
    })).toBe(false);
  });
});

describe('deveEnviar — gap mínimo da véspera (anti "confirmando o que combinamos há 6 minutos")', () => {
  const due = '2026-07-17T20:00:00.000Z'; // sexta 17h SP = véspera de segunda 9h
  const agora = new Date('2026-07-17T20:00:00.000Z');

  it('marcou 6 minutos antes da janela → QUEIMA (o caso real: lead marca 16h54, tick 17h00)', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: new Date(Date.parse(due) - 6 * 60_000).toISOString(),
      agora, enviadoEm: null,
    })).toBe(false);
  });

  it('marcou 2h59 antes → QUEIMA (borda de dentro)', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: new Date(Date.parse(due) - VESPERA_MIN_GAP_MS + 60_000).toISOString(),
      agora, enviadoEm: null,
    })).toBe(false);
  });

  it('marcou 3h01 antes → ENVIA (borda de fora)', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: new Date(Date.parse(due) - VESPERA_MIN_GAP_MS - 60_000).toISOString(),
      agora, enviadoEm: null,
    })).toBe(true);
  });

  it('marcou DEPOIS da janela abrir (17h20 p/ amanhã) → QUEIMA', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: '2026-07-17T20:20:00.000Z',
      agora: new Date('2026-07-17T20:25:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });
});

describe('deveEnviar — ativação', () => {
  it('envia na janela [T-30min, T-0]', () => {
    expect(deveEnviar({
      toque: 'ativacao', dataHora: SEG_15H, criadaEm: '2026-07-17T11:22:53.170Z',
      agora: new Date('2026-07-20T17:35:00.000Z'), enviadoEm: null,
    })).toBe(true);
  });

  it('NÃO envia depois de a reunião começar (cron parado 1h) — queima', () => {
    expect(deveEnviar({
      toque: 'ativacao', dataHora: SEG_15H, criadaEm: '2026-07-17T11:22:53.170Z',
      agora: new Date('2026-07-20T18:05:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });

  it('o GAP não se aplica à ativação: marcou 2h antes e ela sai mesmo assim', () => {
    // minLeadMinutes=120 permite marcar 10h p/ 12h. A ativação é o toque que importa.
    expect(deveEnviar({
      toque: 'ativacao', dataHora: SEG_15H,
      criadaEm: '2026-07-20T16:00:00.000Z', // 2h antes da reunião
      agora: new Date('2026-07-20T17:35:00.000Z'), enviadoEm: null,
    })).toBe(true);
  });
});

describe('ultimoDiaUtilAntes x feriado', () => {
  it('reunião terça 08/09 → véspera sexta 04/09 17h (pula o feriado de 07/09 E o fim de semana)', () => {
    const TER_08_09 = '2026-09-08T12:00:00.000Z'; // terça 08/09/2026 9h SP
    expect(ultimoDiaUtilAntes(TER_08_09)).toBe('2026-09-04T20:00:00.000Z'); // sexta 04/09 17h SP
  });
});

// dueVespera é alias de ultimoDiaUtilAntes — sanity de que o alias não divergiu.
describe('dueVespera', () => {
  it('espelha ultimoDiaUtilAntes', () => {
    expect(dueVespera(SEG_9H)).toBe(ultimoDiaUtilAntes(SEG_9H));
  });
});

describe('renderReminder', () => {
  it('interpola nome, label e consultor', () => {
    const out = renderReminder(TOQUES_COPY.ativacao, {
      nome: 'Nathalia', label: 'segunda, 20/07, às 15h', consultor: 'Denilson',
    });
    expect(out).toContain('Nathalia');
    expect(out).toContain('Denilson');
    expect(out).not.toContain('{');
  });

  it('NENHUM toque deixa placeholder por resolver (o {label} não existia no renderBubbles)', () => {
    for (const toque of Object.values(TOQUES_COPY)) {
      const out = renderReminder(toque, {
        nome: 'Maria', label: 'segunda, 20/07, às 15h', consultor: 'Denilson',
      });
      expect(out).not.toMatch(/\{|\}/);
    }
  });

  it('fallback: sem nome e sem consultor, não sobra chave nem pontuação órfã', () => {
    for (const toque of Object.values(TOQUES_COPY)) {
      const out = renderReminder(toque, { nome: '', label: 'segunda, 20/07, às 15h', consultor: 'o consultor' });
      expect(out).not.toMatch(/\{|\}/);
      expect(out).not.toMatch(/\s,|^,|\s\./m);
    }
  });

  it('guard-rail: toda chave usada na copy existe no objeto de vars', () => {
    const vars = new Set(['nome', 'label', 'consultor']);
    for (const toque of Object.values(TOQUES_COPY)) {
      for (const bolha of toque) {
        for (const m of bolha.matchAll(/\{(\w+)\}/g)) {
          expect(vars.has(m[1])).toBe(true);
        }
      }
    }
  });

  it('separa as bolhas com linha em branco (o splitIntoBubbles do sendAIResponse)', () => {
    const out = renderReminder(['Uma.', 'Duas.'], { nome: 'X', label: 'Y', consultor: 'Z' });
    expect(out).toBe('Uma.\n\nDuas.');
  });
});

/**
 * Supabase fake: thenable que resolve com as linhas no await, qualquer que seja o
 * encadeamento de filtros (mesmo padrão de test/followup/run.test.ts). O mock NÃO filtra —
 * passe já filtrado; os testes de filtro SQL ficam pra validação ao vivo.
 */
function makeSupabaseMR(cfg: {
  activities: unknown[]; deals: unknown[]; conversations: unknown[]; contacts: unknown[]; profiles?: unknown[];
}) {
  const dealUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  function thenable(rows: unknown[]) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'gte', 'lte', 'order', 'limit']) b[m] = () => b;
    b.then = (res: (v: { data: unknown[]; error: null }) => void) => res({ data: rows, error: null });
    return b;
  }
  const client = {
    from(table: string) {
      if (table === 'deals') {
        return {
          ...thenable(cfg.deals),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => { dealUpdates.push({ id, patch }); return { error: null }; },
          }),
        };
      }
      if (table === 'activities') return thenable(cfg.activities);
      if (table === 'messaging_conversations') return thenable(cfg.conversations);
      if (table === 'contacts') return thenable(cfg.contacts);
      if (table === 'profiles') return thenable(cfg.profiles ?? []);
      throw new Error('tabela inesperada: ' + table);
    },
  };
  return { client: client as never, dealUpdates };
}

const AGORA = new Date('2026-07-20T17:35:00.000Z'); // segunda 14h35 SP = janela da ativação das 15h

function cenarioBase(over: { deal?: Record<string, unknown>; activity?: Record<string, unknown> } = {}) {
  const activity = {
    id: 'act-1', deal_id: 'deal-1', date: '2026-07-20T18:00:00.000Z',
    created_at: '2026-07-17T11:22:53.113Z', owner_id: 'u-den', ...over.activity,
  };
  const deal = { id: 'deal-1', organization_id: 'org-1', contact_id: 'c-1', custom_fields: {}, ...over.deal };
  return {
    activities: [activity], deals: [deal],
    conversations: [{ id: 'conv-1', contact_id: 'c-1', last_message_at: '2026-07-17T11:24:41.150Z', metadata: {} }],
    contacts: [{ id: 'c-1', name: 'Nathalia Quintero Ruiz', ai_paused: true }], // pausado DE PROPÓSITO
    profiles: [{ id: 'u-den', name: 'Denilson Silva' }],
  };
}

function deps(supa: unknown, over: Partial<MeetingReminderDeps> = {}): MeetingReminderDeps {
  return {
    supabase: supa as never,
    now: AGORA,
    sendResponse: vi.fn(async () => ({ success: true })),
    ...over,
  };
}

describe('runMeetingReminder', () => {
  // 31/08/2026: a Ana parou de dizer QUEM vai ligar. Mesmo com o dono da
  // atividade preenchido (aqui, "Denilson Silva"), a mensagem sai com "o
  // consultor" — o time cresceu e o card troca de dono entre o agendamento e a
  // véspera. Ver CONSULTOR_GENERICO em lib/ai/followup/meeting-reminder.
  it('envia a ativação falando "o consultor" (nunca o nome do dono) e persiste ANTES de enviar', async () => {
    const { client, dealUpdates } = makeSupabaseMR(cenarioBase());
    const send = vi.fn(async () => ({ success: true }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));

    expect(r.processed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [convId, msg] = send.mock.calls[0];
    expect(convId).toBe('conv-1');
    expect(msg).toContain('Nathalia');
    expect(msg).toContain('o consultor');
    expect(msg).not.toContain('Denilson');
    expect(msg).not.toMatch(/\{|\}/);
    // persistiu o estado no MAP chaveado por activity_id
    expect((dealUpdates[0].patch.custom_fields as Record<string, unknown>).meeting_reminder)
      .toMatchObject({ 'act-1': expect.objectContaining({ date: '2026-07-20T18:00:00.000Z', ativacao_sent_at: expect.any(String) }) });
  });

  it('IGNORA ai_paused (decisão do spec §2.3): o contato do cenário base está pausado e recebe', async () => {
    const { client } = makeSupabaseMR(cenarioBase());
    const send = vi.fn(async () => ({ success: true }));
    await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('não reenvia o toque já enviado', async () => {
    const { client } = makeSupabaseMR(cenarioBase({
      deal: { custom_fields: { meeting_reminder: {
        'act-1': { date: '2026-07-20T18:00:00.000Z', ativacao_sent_at: '2026-07-20T17:31:00.000Z' },
      } } },
    }));
    const send = vi.fn(async () => ({ success: true }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).not.toHaveBeenCalled();
    expect(r.processed).toBe(0);
  });

  it('REMARCAÇÃO: date mudou (mesma activity, edição manual) → sub-estado antigo descartado e o toque sai de novo', async () => {
    const { client } = makeSupabaseMR(cenarioBase({
      deal: { custom_fields: { meeting_reminder: {
        'act-1': {
          date: '2026-07-17T20:00:00.000Z', // sexta 17h — a data ANTIGA (activity agora aponta segunda 15h)
          vespera_sent_at: '2026-07-16T20:00:00.000Z', ativacao_sent_at: '2026-07-17T19:30:00.000Z',
        },
      } } },
    }));
    const send = vi.fn(async () => ({ success: true }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.processed).toBe(1);
  });

  it('no-show marcado DEPOIS da marcação → pula os dois toques', async () => {
    const { client } = makeSupabaseMR(cenarioBase({
      deal: { custom_fields: { no_show_at: '2026-07-20T17:00:00.000Z' } }, // depois do created_at
    }));
    const send = vi.fn(async () => ({ success: true }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  it('no-show ANTES da marcação (deu no-show e remarcou) → envia normal', async () => {
    const { client } = makeSupabaseMR(cenarioBase({
      deal: { custom_fields: { no_show_at: '2026-07-10T14:00:00.000Z' } }, // antes do created_at
    }));
    const send = vi.fn(async () => ({ success: true }));
    await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sem owner_id, cai em "o consultor" e não vaza chave', async () => {
    const { client } = makeSupabaseMR({ ...cenarioBase({ activity: { owner_id: null } }), profiles: [] });
    const send = vi.fn(async () => ({ success: true }));
    await runMeetingReminder(deps(client, { sendResponse: send }));
    const msg = send.mock.calls[0][1];
    expect(msg).toContain('o consultor');
    expect(msg).not.toMatch(/\{|\}/);
  });

  it('envio falhou → reverte o estado e conta failed', async () => {
    const { client, dealUpdates } = makeSupabaseMR(cenarioBase());
    const send = vi.fn(async () => ({ success: false }));
    const r = await runMeetingReminder(deps(client, { sendResponse: send }));
    expect(r.failed).toBe(1);
    expect(dealUpdates).toHaveLength(2); // gravou, depois reverteu
    // o revert deixa o sub-estado de act-1 SEM ativacao_sent_at
    const revertMap = (dealUpdates[1].patch.custom_fields as Record<string, unknown>).meeting_reminder as Record<string, Record<string, unknown>>;
    expect(revertMap['act-1']).not.toHaveProperty('ativacao_sent_at');
  });

  it('HIGH regressão: deal com 2 reuniões abertas no mesmo tick → cada uma persiste seu próprio sub-estado (o mapa preserva a irmã, sem reenvio)', async () => {
    // Sexta 17h05 SP: as vésperas de DUAS reuniões de segunda (9h e 15h) caem na mesma janela
    // [17h00, 17h30]. Com registro único por deal, a 2ª persistência apagava o _sent_at da 1ª e
    // o lembrete reenviava no tick seguinte (risco de ban). O mapa por activity_id isola cada uma.
    const AGORA_SEXTA_1705 = new Date('2026-07-17T20:05:00.000Z');
    const cfg = {
      activities: [
        { id: 'act-A', deal_id: 'deal-1', date: '2026-07-20T12:00:00.000Z', created_at: '2026-07-15T12:00:00.000Z', owner_id: 'u-den' }, // seg 9h
        { id: 'act-B', deal_id: 'deal-1', date: '2026-07-20T18:00:00.000Z', created_at: '2026-07-15T12:00:00.000Z', owner_id: 'u-den' }, // seg 15h
      ],
      deals: [{ id: 'deal-1', organization_id: 'org-1', contact_id: 'c-1', custom_fields: {} }],
      conversations: [{ id: 'conv-1', contact_id: 'c-1', last_message_at: '2026-07-16T12:00:00.000Z', metadata: {} }],
      contacts: [{ id: 'c-1', name: 'Maria Silva', ai_paused: false }],
      profiles: [{ id: 'u-den', name: 'Denilson Silva' }],
    };
    const { client, dealUpdates } = makeSupabaseMR(cfg);
    const send = vi.fn(async () => ({ success: true }));
    const r = await runMeetingReminder(deps(client, { now: AGORA_SEXTA_1705, sendResponse: send }));

    expect(r.processed).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    // A ÚLTIMA persistência tem AS DUAS reuniões com vespera_sent_at — a irmã não foi apagada.
    const mapaFinal = (dealUpdates[dealUpdates.length - 1].patch.custom_fields as Record<string, unknown>).meeting_reminder as Record<string, Record<string, unknown>>;
    expect(mapaFinal['act-A']).toHaveProperty('vespera_sent_at');
    expect(mapaFinal['act-B']).toHaveProperty('vespera_sent_at');
  });
});
