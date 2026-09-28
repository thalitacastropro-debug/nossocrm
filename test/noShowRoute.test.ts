import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * O RESGATE DE NO-SHOW USA A AGENDA DO DONO DO CARD (21/09/2026, caso Camila Santos).
 *
 * O card era do Pedro; o resgate oferecia os horários livres do Denilson, o consultor fixo da
 * board — e a ligação remarcada nasceria na agenda dele. Aqui travamos as três decisões da rota:
 * de quem é a agenda, o que acontece quando o card não tem dono, e a limpeza do carimbo de
 * handoff sem a qual o card remarcado fica preso no funil da Ana.
 */

const PEDRO = '9d46dbae-93e8-4b19-936c-b7c1275a230f';
const DENILSON = '02e8bf43-feda-4a79-b166-93735849e4b8';
const QUEM_CLICOU = '9003e53b-05be-438c-8f7f-2951ee502a11'; // admin operando card dos outros
const DEAL_ID = '9ac2b179-41bc-43b8-bd83-2937d464d4ee';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const CONTACT_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const CONV_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';

let dealRow: Record<string, unknown>;
let dealUpdateSpy: ReturnType<typeof vi.fn>;
let consultorDaBoard: string | null;
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

const loadBusySpy = vi.fn(async () => []);
const sendAIResponseSpy = vi.fn(async () => ({ success: true }));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));
vi.mock('@/lib/ai/agent/agent.service', () => ({ sendAIResponse: (...a: unknown[]) => sendAIResponseSpy(...(a as [])) }));
vi.mock('@/lib/ai/messaging/circuit-breaker', () => ({ resetCircuitBreaker: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai/messaging/board-config', () => ({
  getBoardAIConfig: vi.fn(async () => ({ consultant_user_id: consultorDaBoard })),
}));
vi.mock('@/lib/ai/scheduling/busy', () => ({
  loadBusyIntervals: (...a: unknown[]) => loadBusySpy(...(a as [])),
}));
vi.mock('@/lib/ai/scheduling/availability', () => ({
  getAvailableSlots: vi.fn(() => [
    { startIso: '2026-09-22T13:00:00.000Z', endIso: '2026-09-22T13:40:00.000Z', label: 'terça, 22/09, às 10h' },
  ]),
}));

import { POST } from '@/app/api/deals/[dealId]/no-show/route';

/** Cadeia do PostgREST: todo método devolve a si mesma; o fim resolve em `resultado`. */
function qb(resultado: unknown = { data: null, error: null }) {
  const alvo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'order', 'limit', 'update', 'insert']) {
    alvo[m] = () => alvo;
  }
  alvo.single = async () => resultado;
  alvo.maybeSingle = async () => resultado;
  alvo.then = (ok: (v: unknown) => unknown) => ok(resultado);
  return alvo;
}

async function marcarNoShow(): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${DEAL_ID}/no-show`, { method: 'POST', body: '{}' });
  return POST(req as never, { params: Promise.resolve({ dealId: DEAL_ID }) } as never);
}

/** consultantUserId com que a rota consultou a agenda. */
function agendaConsultada(): string | undefined {
  return (loadBusySpy.mock.calls[0]?.[0] as { consultantUserId?: string } | undefined)?.consultantUserId;
}

/** custom_fields que a rota gravou no deal. */
function customFieldsGravados(): Record<string, unknown> {
  const payload = dealUpdateSpy.mock.calls[0]?.[0] as { custom_fields?: Record<string, unknown> };
  return payload?.custom_fields ?? {};
}

describe('POST /api/deals/[dealId]/no-show — de quem é a agenda do resgate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consultorDaBoard = DENILSON;
    dealRow = {
      id: DEAL_ID,
      board_id: 'board-comercial',
      contact_id: CONTACT_ID,
      organization_id: ORG_ID,
      owner_id: PEDRO,
      // Carimbo deixado pelo handoff que trouxe o card pro funil do Consultor.
      custom_fields: {
        handoff_consultor: { at: '2026-09-20T13:48:39.742Z', motivo: 'reuniao_agendada' },
        reuniao_agendada: { status: 'confirmada' },
      },
    };
    dealUpdateSpy = vi.fn(() => qb());

    supabaseClientMock = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: QUEM_CLICOU } }, error: null })) },
      from: vi.fn((t: string) => {
        if (t !== 'deals') throw new Error('tabela inesperada no client do usuário: ' + t);
        const chain = qb({ data: dealRow, error: null }) as Record<string, unknown>;
        chain.update = dealUpdateSpy;
        return chain;
      }),
    };

    adminMock = {
      from: vi.fn((t: string) => {
        if (t === 'contacts') return qb({ data: { name: 'Camila Santos' }, error: null });
        if (t === 'messaging_conversations') return qb({ data: { id: CONV_ID }, error: null });
        throw new Error('tabela inesperada no admin: ' + t);
      }),
    };
  });

  it('card do Pedro → agenda do PEDRO, não a do consultor da board', async () => {
    const res = await marcarNoShow();
    expect(res.status).toBe(200);
    expect(agendaConsultada()).toBe(PEDRO);
    expect(agendaConsultada()).not.toBe(DENILSON);
  });

  it('card SEM dono cai no consultor da board — e nunca em quem clicou no botão', async () => {
    // Admin marcando no-show num card órfão: usar `user.id` faria o resgate ler a agenda dela
    // (vazia) e oferecer o dia inteiro como livre.
    dealRow.owner_id = null;
    await marcarNoShow();
    expect(agendaConsultada()).toBe(DENILSON);
    expect(agendaConsultada()).not.toBe(QUEM_CLICOU);
  });

  it('sem dono e sem consultor: não inventa agenda, manda o texto genérico', async () => {
    dealRow.owner_id = null;
    consultorDaBoard = null;
    const res = await marcarNoShow();
    expect(res.status).toBe(200);
    expect(loadBusySpy).not.toHaveBeenCalled();
    // A mensagem sai mesmo assim — só sem horário.
    expect(sendAIResponseSpy).toHaveBeenCalled();
  });

  it('PRESERVA handoff_consultor: é a trava do is_lost na extração', async () => {
    await marcarNoShow();
    const cf = customFieldsGravados();
    expect(cf.no_show).toBe(true);
    expect(cf.no_show_by).toBe(QUEM_CLICOU);
    expect(typeof cf.no_show_at).toBe('string');
    // Apagar o carimbo abriria a porta do handoff, mas deixaria a extração marcar como PERDIDO
    // justamente o card em resgate (domain-extraction.service → loss-guard). Quem reabre a porta
    // é o no_show_at, comparado com a data do carimbo lá no handoff.
    expect(cf).toHaveProperty('handoff_consultor');
    // O resto do card continua intacto (custom_fields é REPLACE total no banco).
    expect(cf.reuniao_agendada).toEqual({ status: 'confirmada' });
    // E o no-show é mais novo que o handoff — é isso que o guard de lá compara.
    const carimbo = cf.handoff_consultor as { at: string };
    expect(Date.parse(String(cf.no_show_at))).toBeGreaterThan(Date.parse(carimbo.at));
  });

  it('resgate ainda aberto: não remarca nem redispara a mensagem', async () => {
    // Card já devolvido à Ana e sem handoff novo desde então.
    dealRow.custom_fields = { no_show: true, no_show_at: '2026-09-21T18:47:00.000Z' };
    const res = await marcarNoShow();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ already_marked: true });
    expect(dealUpdateSpy).not.toHaveBeenCalled();
    expect(sendAIResponseSpy).not.toHaveBeenCalled();
  });

  it('SEGUNDO no-show do mesmo lead vale: ele remarcou, voltou e sumiu de novo', async () => {
    // `no_show` nunca é limpo. Olhar a flag flat engoliria este caso em silêncio — e ele só é
    // alcançável porque o card agora volta mesmo pro funil do consultor depois do resgate.
    dealRow.custom_fields = {
      no_show: true,
      no_show_at: '2026-09-21T18:47:00.000Z',
      handoff_consultor: { at: '2026-09-23T10:00:00.000Z', motivo: 'reuniao_agendada' },
    };
    const res = await marcarNoShow();
    expect(res.status).toBe(200);
    expect(await res.json()).not.toMatchObject({ already_marked: true });
    expect(dealUpdateSpy).toHaveBeenCalled();
    expect(sendAIResponseSpy).toHaveBeenCalled();
  });
});
