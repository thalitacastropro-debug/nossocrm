import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PATCH /api/deals/[dealId]/venda — informar o prêmio do plano VENDIDO.
 *
 * POR QUE ROTA (e não um update pelo cliente, como a aba Origem faz): desde 26/08/2026 o
 * card dado como ganho é MOVIDO para a Implantação, e `deals_select` exige
 * `pode_ver_board(board_id)`. Quem vendeu (o consultor) deixa de enxergar o próprio card —
 * pelo navegador ele não conseguiria nem LER o card para informar o prêmio da venda dele.
 *
 * Por isso o gate é o MESMO da rota de vendas: organização confere, e quem não tem
 * `ve_tudo()` só mexe na venda em que ELE é o `vendedor_id` do carimbo.
 */

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const OUTRO_ID = 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const OUTRA_ORG = 'f6a7b8c9-d0e1-4f2a-8b3c-d4e5f6a7b8c9';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

let perfil: Record<string, unknown>;
let dealRow: Record<string, unknown> | null;
let updateSpy: ReturnType<typeof vi.fn>;
let insertAtividadeSpy: ReturnType<typeof vi.fn>;
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));

import { PATCH } from '@/app/api/deals/[dealId]/venda/route';

/** `.update().eq().eq().select()` resolve no fim da cadeia, guardando o payload. */
function cadeiaUpdate(payloadRecebido: Record<string, unknown>[]) {
  return vi.fn((payload: Record<string, unknown>) => {
    payloadRecebido.push(payload);
    const alvo: Record<string, unknown> = {
      eq: () => alvo,
      select: () => Promise.resolve({ data: [{ id: DEAL_ID }], error: null }),
    };
    return alvo;
  });
}

const CARIMBO_BASE = {
  vendedor_id: USER_ID,
  vendedor_nome: 'Pedro Sellan',
  vendido_em: '2026-08-25T16:56:34.267Z',
  board_id_da_venda: 'efbaa84e-cf4b-4465-8b50-41afd612088e',
  funil_da_venda: 'Comercial — Consultor',
  etapa_da_venda: 'Fechado/Ganho',
  valor_na_venda: 350,
};

let payloads: Record<string, unknown>[];

function montarMocks() {
  payloads = [];
  updateSpy = cadeiaUpdate(payloads);
  insertAtividadeSpy = vi.fn(async () => ({ error: null }));
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
      throw new Error('tabela inesperada no cliente do usuário: ' + t);
    }),
  };
  adminMock = {
    from: vi.fn((t: string) => {
      if (t === 'deals') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: dealRow, error: null })),
          update: updateSpy,
        };
      }
      if (t === 'activities') return { insert: insertAtividadeSpy };
      throw new Error('tabela inesperada no admin: ' + t);
    }),
  };
}

async function chamar(corpo: unknown, dealId = DEAL_ID): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/venda`, {
    method: 'PATCH',
    body: JSON.stringify(corpo),
    headers: { 'content-type': 'application/json' },
  });
  return PATCH(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('PATCH /api/deals/[dealId]/venda', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    perfil = { id: USER_ID, role: 'vendedor', ve_todos_os_leads: false, organization_id: ORG_ID };
    dealRow = {
      id: DEAL_ID,
      title: 'Richard Gois — Lead Meta Ads',
      organization_id: ORG_ID,
      custom_fields: { venda: { ...CARIMBO_BASE }, tier: { value: 'ouro' } },
    };
    montarMocks();
  });

  it('401 sem sessão', async () => {
    supabaseClientMock = {
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
      from: vi.fn(),
    };
    expect((await chamar({ premio_mensal: 2000, operadora: 'AMIL' })).status).toBe(401);
  });

  it('400 com dealId que não é uuid', async () => {
    expect((await chamar({ premio_mensal: 2000, operadora: 'AMIL' }, 'nao-uuid')).status).toBe(400);
  });

  it('404 quando o card é de outra organização', async () => {
    dealRow = { ...dealRow!, organization_id: OUTRA_ORG };
    expect((await chamar({ premio_mensal: 2000, operadora: 'AMIL' })).status).toBe(404);
  });

  it('422 em card que não tem carimbo de venda — prêmio sem venda não existe', async () => {
    dealRow = { id: DEAL_ID, title: 'Lead qualquer', organization_id: ORG_ID, custom_fields: {} };
    const r = await chamar({ premio_mensal: 2000, operadora: 'AMIL' });
    expect(r.status).toBe(422);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('403 quando o consultor tenta informar o prêmio de uma venda que não é dele', async () => {
    dealRow = {
      ...dealRow!,
      custom_fields: { venda: { ...CARIMBO_BASE, vendedor_id: OUTRO_ID } },
    };
    const r = await chamar({ premio_mensal: 2000, operadora: 'AMIL' });
    expect(r.status).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('admin informa o prêmio de venda de qualquer pessoa', async () => {
    perfil = { ...perfil, role: 'admin' };
    dealRow = {
      ...dealRow!,
      custom_fields: { venda: { ...CARIMBO_BASE, vendedor_id: OUTRO_ID } },
    };
    expect((await chamar({ premio_mensal: 2000, operadora: 'AMIL' })).status).toBe(200);
  });

  it('400 quando o prêmio é inválido, sem tocar no banco', async () => {
    const r = await chamar({ premio_mensal: 0, operadora: 'AMIL' });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: expect.stringMatching(/maior que zero/i) });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('grava prêmio, operadora e vigência dentro do carimbo, sem apagar o resto', async () => {
    const r = await chamar({ premio_mensal: '1.850,00', operadora: 'Bradesco', vigencia_em: '2026-09-01' });
    expect(r.status).toBe(200);

    const gravado = payloads[0]?.custom_fields as Record<string, unknown>;
    const venda = gravado.venda as Record<string, unknown>;
    expect(venda.premio_mensal).toBe(1850);
    expect(venda.operadora).toBe('Bradesco');
    expect(venda.vigencia_em).toBe('2026-09-01');
    // O carimbo original continua intacto: é dele que sai quem vendeu e quando.
    expect(venda.vendedor_id).toBe(USER_ID);
    expect(venda.vendido_em).toBe(CARIMBO_BASE.vendido_em);
    expect(venda.valor_na_venda).toBe(350);
    // E o resto do custom_fields (tier, qualificação, lead_form...) também.
    expect(gravado.tier).toEqual({ value: 'ouro' });
  });

  it('registra quem informou o prêmio e quando — a comissão depende deste número', async () => {
    await chamar({ premio_mensal: 2000, operadora: 'AMIL' });
    const venda = (payloads[0]?.custom_fields as Record<string, unknown>).venda as Record<string, unknown>;
    expect(venda.premio_informado_por).toBe(USER_ID);
    expect(typeof venda.premio_informado_em).toBe('string');
  });

  it('deixa nota na timeline (a jornada é registro, não rascunho)', async () => {
    await chamar({ premio_mensal: 2000, operadora: 'AMIL' });
    expect(insertAtividadeSpy).toHaveBeenCalledTimes(1);
    const nota = insertAtividadeSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(nota.deal_id).toBe(DEAL_ID);
    expect(nota.organization_id).toBe(ORG_ID);
    expect(String(nota.description)).toMatch(/AMIL/);
  });

  it('corrigir um prêmio já informado é permitido, e a correção fica registrada', async () => {
    dealRow = {
      ...dealRow!,
      custom_fields: {
        venda: { ...CARIMBO_BASE, premio_mensal: 1000, operadora: 'AMIL', premio_informado_por: USER_ID },
      },
    };
    const r = await chamar({ premio_mensal: 2500, operadora: 'Bradesco' });
    expect(r.status).toBe(200);
    const venda = (payloads[0]?.custom_fields as Record<string, unknown>).venda as Record<string, unknown>;
    expect(venda.premio_mensal).toBe(2500);
    expect(String(insertAtividadeSpy.mock.calls[0][0].description)).toMatch(/1\.000|corrig/i);
  });

  it('devolve o prêmio salvo para a tela atualizar sem recarregar', async () => {
    const r = await chamar({ premio_mensal: 2000, operadora: 'AMIL', vigencia_em: '' });
    const corpo = await r.json();
    expect(corpo.venda).toMatchObject({ premio_mensal: 2000, operadora: 'AMIL', vigencia_em: null });
  });
});
