import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/boards/[boardId]/vendas — com o prêmio fechado no corpo.
 *
 * O "Já ganho no mês" deixou de somar `valor_na_venda` (a mensalidade do plano ANTIGO
 * do lead) e passou a somar o PRÊMIO do plano vendido. Venda sem prêmio não entra na
 * soma — ela vira pendência visível (`pendente_premio`), nunca número errado.
 */

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const BOARD_ID = 'efbaa84e-cf4b-4465-8b50-41afd612088e';
const DEAL_A = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';
const DEAL_B = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';

let perfil: Record<string, unknown>;
let linhasDeVenda: Record<string, unknown>[];
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));

import { GET } from '@/app/api/boards/[boardId]/vendas/route';

async function chamar(boardId = BOARD_ID): Promise<Response> {
  const url = `http://localhost/api/boards/${boardId}/vendas?inicio=2026-08-01T00:00:00.000Z&fim=2026-08-31T23:59:59.999Z`;
  const req = new Request(url, { method: 'GET' });
  return GET(req as never, { params: Promise.resolve({ boardId }) } as never);
}

describe('GET /api/boards/[boardId]/vendas — prêmio fechado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    perfil = { id: USER_ID, role: 'admin', ve_todos_os_leads: false, organization_id: ORG_ID };
    linhasDeVenda = [
      {
        id: DEAL_A,
        title: 'Richard Gois — Lead Meta Ads',
        value: 350,
        venda: {
          vendedor_id: USER_ID,
          vendedor_nome: 'Denilson Silva',
          vendido_em: '2026-08-25T16:56:34.267Z',
          board_id_da_venda: BOARD_ID,
          valor_na_venda: 350,
          // COM prêmio informado:
          premio_mensal: 1850,
          operadora: 'Bradesco',
          vigencia_em: '2026-09-01',
        },
      },
      {
        id: DEAL_B,
        title: 'Mavie Ramunno — Lead Meta Ads',
        value: 4295,
        venda: {
          vendedor_id: USER_ID,
          vendedor_nome: 'Denilson Silva',
          vendido_em: '2026-08-13T19:33:09.633Z',
          board_id_da_venda: BOARD_ID,
          valor_na_venda: 4295,
          // SEM prêmio: pendência.
        },
      },
    ];
    supabaseClientMock = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })) },
      from: vi.fn((t: string) => {
        if (t === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(async () => ({ data: perfil, error: null })),
          };
        }
        if (t === 'boards') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: { id: BOARD_ID, organization_id: ORG_ID }, error: null })),
          };
        }
        throw new Error('tabela inesperada no cliente do usuário: ' + t);
      }),
    };
    adminMock = {
      from: vi.fn((t: string) => {
        if (t === 'deals') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn(async () => ({ data: linhasDeVenda, error: null })),
          };
        }
        throw new Error('tabela inesperada no admin: ' + t);
      }),
    };
  });

  it('devolve o prêmio, a operadora, a vigência e o título de cada venda', async () => {
    const r = await chamar();
    expect(r.status).toBe(200);
    const corpo = await r.json();
    const richard = corpo.vendas.find((v: { deal_id: string }) => v.deal_id === DEAL_A);
    expect(richard).toMatchObject({
      titulo: 'Richard Gois — Lead Meta Ads',
      premio_mensal: 1850,
      operadora: 'Bradesco',
      vigencia_em: '2026-09-01',
      pendente_premio: false,
    });
  });

  it('marca como pendente a venda sem prêmio, sem inventar valor', async () => {
    const corpo = await (await chamar()).json();
    const mavie = corpo.vendas.find((v: { deal_id: string }) => v.deal_id === DEAL_B);
    expect(mavie).toMatchObject({ premio_mensal: null, pendente_premio: true });
  });

  it('soma dos prêmios ignora a venda pendente — número errado é pior que número com ressalva', async () => {
    const corpo = await (await chamar()).json();
    expect(corpo.valorTotalPremio).toBe(1850);
    expect(corpo.pendentesDePremio).toBe(1);
  });

  it('mantém o valorTotal legado (mensalidade antiga) para quem ainda o consome', async () => {
    const corpo = await (await chamar()).json();
    expect(corpo.valorTotal).toBe(350 + 4295);
  });
});
