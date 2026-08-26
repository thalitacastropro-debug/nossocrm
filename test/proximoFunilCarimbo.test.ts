import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/deals/[dealId]/proximo-funil — o carimbo em funil SEM próximo funil.
 *
 * O buraco: a rota retornava `sem_proximo_funil` ANTES de carimbar. Ganho na Nutrição ou
 * em Clientes Ativos (next_board_id = null) ficava `is_won` no funil e SEM carimbo — e
 * desde que "Já ganho no mês" e a barra de meta leem o carimbo, essa venda não existiria
 * em relatório nenhum, nem geraria a pendência de prêmio.
 */

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const BOARD_NUTRICAO = '4fb31290-2ab4-46ac-83b1-555fbd4908cc';
const STAGE_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';

let dealRow: Record<string, unknown>;
let dealUpdateSpy: ReturnType<typeof vi.fn>;
let payloads: Record<string, unknown>[];
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));

import { POST } from '@/app/api/deals/[dealId]/proximo-funil/route';

async function chamar(): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${DEAL_ID}/proximo-funil`, { method: 'POST' });
  return POST(req as never, { params: Promise.resolve({ dealId: DEAL_ID }) } as never);
}

describe('POST proximo-funil — ganho em funil sem próximo funil', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    payloads = [];
    dealRow = {
      id: DEAL_ID,
      board_id: BOARD_NUTRICAO,
      stage_id: STAGE_ID,
      owner_id: USER_ID,
      value: 715,
      is_won: true,
      custom_fields: { qualificacao: { operadora: 'Unimed' } },
      organization_id: ORG_ID,
      contact_id: null,
    };
    dealUpdateSpy = vi.fn((payload: Record<string, unknown>) => {
      payloads.push(payload);
      const alvo: Record<string, unknown> = {
        eq: () => alvo,
        select: () => Promise.resolve({ data: [{ id: DEAL_ID }], error: null }),
      };
      return alvo;
    });
    supabaseClientMock = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })) },
      from: vi.fn((t: string) => {
        if (t === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(async () => ({ data: { organization_id: ORG_ID }, error: null })),
          };
        }
        if (t === 'deals') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(async () => ({ data: { id: DEAL_ID, organization_id: ORG_ID }, error: null })),
          };
        }
        throw new Error('tabela inesperada no cliente: ' + t);
      }),
    };
    adminMock = {
      from: vi.fn((t: string) => {
        if (t === 'deals') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(async () => ({ data: dealRow, error: null })),
            update: dealUpdateSpy,
          };
        }
        if (t === 'boards') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            // Nutrição: funil de ponta — não tem próximo funil.
            maybeSingle: vi.fn(async () => ({
              data: { id: BOARD_NUTRICAO, name: 'Nutrição — Reativação', next_board_id: null },
              error: null,
            })),
          };
        }
        if (t === 'board_stages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({
              data: { id: STAGE_ID, name: 'fechado-ganho', label: 'Fechado/Ganho', linked_lifecycle_stage: null },
              error: null,
            })),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn(async () => ({ data: [], error: null })),
          };
        }
        if (t === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [{ id: USER_ID, name: 'Pedro Sellan', nickname: null, first_name: null, role: 'vendedor', ve_todos_os_leads: false }],
              error: null,
            })),
          };
        }
        if (t === 'activities') return { insert: vi.fn(async () => ({ error: null })) };
        throw new Error('tabela inesperada no admin: ' + t);
      }),
    };
  });

  it('carimba a venda mesmo sem funil de destino — a venda não pode sumir do relatório', async () => {
    const r = await chamar();
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.movido).toBe(false);
    expect(corpo.motivo).toBe('sem_proximo_funil');
    // O carimbo FOI gravado:
    expect(corpo.venda).toMatchObject({
      vendedor_id: USER_ID,
      board_id_da_venda: BOARD_NUTRICAO,
      funil_da_venda: 'Nutrição — Reativação',
      valor_na_venda: 715,
    });
    expect(dealUpdateSpy).toHaveBeenCalled();
    const gravado = payloads[0]?.custom_fields as Record<string, unknown>;
    expect((gravado.venda as Record<string, unknown>).vendedor_nome).toBe('Pedro Sellan');
    // E o que já estava no custom_fields não foi apagado:
    expect(gravado.qualificacao).toEqual({ operadora: 'Unimed' });
  });

  it('não carimba de novo quando o carimbo já existe', async () => {
    dealRow.custom_fields = {
      venda: { vendedor_id: 'outro', vendido_em: '2026-07-01T00:00:00Z', board_id_da_venda: BOARD_NUTRICAO },
    };
    const corpo = await (await chamar()).json();
    expect(corpo.motivo).toBe('sem_proximo_funil');
    expect(dealUpdateSpy).not.toHaveBeenCalled();
  });

  it('não carimba card que não foi ganho — chamada solta continua inofensiva', async () => {
    dealRow.is_won = false;
    const corpo = await (await chamar()).json();
    expect(corpo.movido).toBe(false);
    expect(dealUpdateSpy).not.toHaveBeenCalled();
  });
});
