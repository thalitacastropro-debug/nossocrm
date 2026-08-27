import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/relatorios/fechamento — o fechamento do mês por pessoa (ADMIN-ONLY).
 *
 * É a "tela que fecha o mês" do niva-os-visao.md §1. Dinheiro e comissão são dado
 * confidencial ([[feedback_niva_dados_confidenciais_crm]]): a rota recusa qualquer um
 * que não seja admin (decisão 26/08 §4b: admin = quem pode ver o caixa).
 *
 * Regras de comissão DECIDIDAS em 26/08 (roadmap §6c):
 * - colaborador TRAZ o cliente (carteira própria, quem_trouxe = colaborador) → 140% do prêmio
 * - colaborador vende lead DA CASA (tráfego) → 100% do prêmio
 * - carteira própria de SÓCIO (admin) → comissão cheia da corretora (tabela por operadora,
 *   ainda a confirmar) → a rota marca a regra e NÃO inventa número
 * - sócio vende lead da casa → receita da casa, sem comissão de pessoa
 * Meta: carteira própria de sócio NÃO conta; o resto conta.
 */

const ADMIN_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const PEDRO_ID = 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const BOARD_ID = 'efbaa84e-cf4b-4465-8b50-41afd612088e';

let perfilDeQuemChama: Record<string, unknown>;
let linhas: Record<string, unknown>[];
let perfisDoTime: Record<string, unknown>[];
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));

import { GET } from '@/app/api/relatorios/fechamento/route';

async function chamar(): Promise<Response> {
  const url = 'http://localhost/api/relatorios/fechamento?inicio=2026-08-01T00:00:00.000Z&fim=2026-08-31T23:59:59.999Z';
  return GET(new Request(url) as never);
}

function venda(extra: Record<string, unknown>, origem?: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    title: 'Lead',
    value: 500,
    venda: {
      vendedor_id: PEDRO_ID,
      vendedor_nome: 'Pedro Sellan',
      vendido_em: '2026-08-10T12:00:00.000Z',
      board_id_da_venda: BOARD_ID,
      valor_na_venda: 500,
      ...extra,
    },
    origem_comercial: origem ?? null,
  };
}

describe('GET /api/relatorios/fechamento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    perfilDeQuemChama = { id: ADMIN_ID, role: 'admin', organization_id: ORG_ID };
    perfisDoTime = [
      { id: ADMIN_ID, name: 'Denilson Silva', nickname: null, first_name: null, role: 'admin' },
      { id: PEDRO_ID, name: 'Pedro Sellan', nickname: null, first_name: null, role: 'vendedor' },
    ];
    linhas = [];
    supabaseClientMock = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: ADMIN_ID } }, error: null })) },
      from: vi.fn((t: string) => {
        if (t === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(async () => ({ data: perfilDeQuemChama, error: null })),
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
            not: vi.fn().mockReturnThis(),
            is: vi.fn(async () => ({ data: linhas, error: null })),
          };
        }
        if (t === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn(async () => ({ data: perfisDoTime, error: null })),
          };
        }
        throw new Error('tabela inesperada no admin: ' + t);
      }),
    };
  });

  it('403 para quem não é admin — comissão é dado confidencial', async () => {
    perfilDeQuemChama = { id: PEDRO_ID, role: 'vendedor', organization_id: ORG_ID };
    expect((await chamar()).status).toBe(403);
  });

  it('colaborador vendendo lead da casa: comissão 100% do prêmio, conta na meta', async () => {
    linhas = [venda({ premio_mensal: 2000, operadora: 'AMIL' })];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas).toHaveLength(1);
    expect(corpo.vendas[0]).toMatchObject({
      regra: 'colaborador_casa_100',
      comissao: 2000,
      pessoa_da_comissao_id: PEDRO_ID,
      conta_na_meta: true,
    });
  });

  it('colaborador que TROUXE o cliente: comissão 140% do prêmio', async () => {
    linhas = [venda(
      { premio_mensal: 1000, operadora: 'AMIL' },
      { tipo: 'carteira_propria', quem_trouxe: PEDRO_ID },
    )];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({
      regra: 'colaborador_trouxe_140',
      comissao: 1400,
      pessoa_da_comissao_id: PEDRO_ID,
      conta_na_meta: true,
    });
  });

  it('carteira própria de sócio: fora da meta, comissão CHEIA pela tabela da operadora', async () => {
    // Bradesco = 330% (tabela do modelo financeiro, corrigida pela Thalita em 09/07):
    // prêmio 3.000 → comissão cheia 9.900.
    linhas = [venda(
      { premio_mensal: 3000, operadora: 'Bradesco', vendedor_id: ADMIN_ID, vendedor_nome: 'Denilson Silva' },
      { tipo: 'carteira_propria', quem_trouxe: ADMIN_ID },
    )];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({
      regra: 'socio_carteira_cheia',
      comissao: 9900,
      conta_na_meta: false,
    });
  });

  it('nome de operadora com variação de grafia acha o percentual (SulAmérica = 250%)', async () => {
    linhas = [venda(
      { premio_mensal: 2000, operadora: 'SulAmérica Saúde', vendedor_id: ADMIN_ID, vendedor_nome: 'Denilson Silva' },
      { tipo: 'carteira_propria', quem_trouxe: ADMIN_ID },
    )];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({ regra: 'socio_carteira_cheia', comissao: 5000 });
  });

  it('operadora fora da tabela: comissão de sócio fica null (número não inventado)', async () => {
    linhas = [venda(
      { premio_mensal: 2000, operadora: 'Unimed', vendedor_id: ADMIN_ID, vendedor_nome: 'Denilson Silva' },
      { tipo: 'carteira_propria', quem_trouxe: ADMIN_ID },
    )];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({ regra: 'socio_carteira_cheia', comissao: null });
  });

  it('"Unimed Porto Alegre" NÃO vira Porto Seguro — cidade no nome não é operadora', async () => {
    linhas = [venda(
      { premio_mensal: 2000, operadora: 'Unimed Porto Alegre', vendedor_id: ADMIN_ID, vendedor_nome: 'Denilson Silva' },
      { tipo: 'carteira_propria', quem_trouxe: ADMIN_ID },
    )];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({ regra: 'socio_carteira_cheia', comissao: null });
  });

  it('"GNDI Família" NÃO casa com AMIL por substring', async () => {
    linhas = [venda(
      { premio_mensal: 2000, operadora: 'GNDI Família', vendedor_id: ADMIN_ID, vendedor_nome: 'Denilson Silva' },
      { tipo: 'carteira_propria', quem_trouxe: ADMIN_ID },
    )];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({ regra: 'socio_carteira_cheia', comissao: null });
  });

  it('"Sul América" escrito com espaço também casa (250%)', async () => {
    linhas = [venda(
      { premio_mensal: 2000, operadora: 'Sul América', vendedor_id: ADMIN_ID, vendedor_nome: 'Denilson Silva' },
      { tipo: 'carteira_propria', quem_trouxe: ADMIN_ID },
    )];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({ regra: 'socio_carteira_cheia', comissao: 5000 });
  });

  it('"Porto Seguro Saúde" continua casando (250%)', async () => {
    linhas = [venda(
      { premio_mensal: 2000, operadora: 'Porto Seguro Saúde', vendedor_id: ADMIN_ID, vendedor_nome: 'Denilson Silva' },
      { tipo: 'carteira_propria', quem_trouxe: ADMIN_ID },
    )];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({ regra: 'socio_carteira_cheia', comissao: 5000 });
  });

  it('sócio vendendo lead da casa: receita da casa, sem comissão de pessoa', async () => {
    linhas = [venda({ premio_mensal: 2500, operadora: 'Alice', vendedor_id: ADMIN_ID, vendedor_nome: 'Denilson Silva' })];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({ regra: 'casa_sem_comissao', comissao: null, conta_na_meta: true });
  });

  it('venda sem prêmio: regra definida, comissão null e pendência marcada', async () => {
    linhas = [venda({})];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({
      regra: 'colaborador_casa_100',
      comissao: null,
      pendente_premio: true,
    });
  });

  it('carteira própria sem "quem trouxe": regra indefinida, sem chute de meta nem comissão', async () => {
    linhas = [venda({ premio_mensal: 900, operadora: 'AMIL' }, { tipo: 'carteira_propria', quem_trouxe: null })];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas[0]).toMatchObject({ regra: 'indefinida', comissao: null, conta_na_meta: null });
  });

  it('agregados separam comissão do TIME de repasse de SÓCIO — naturezas diferentes', async () => {
    // Pedro vende lead da casa (AMIL, 100%) = repasse ao time de 2.000.
    // Denilson fecha carteira própria (Bradesco, comissão cheia 330%) = repasse de sócio 9.900.
    // Somar os dois num único "comissão a pagar" esconderia que 9.900 é a receita da venda
    // passando direto pro sócio (niva-os-visao §3), não despesa de comissão do time.
    linhas = [
      venda({ premio_mensal: 2000, operadora: 'AMIL' }),
      venda(
        { premio_mensal: 3000, operadora: 'Bradesco', vendedor_id: ADMIN_ID, vendedor_nome: 'Denilson Silva' },
        { tipo: 'carteira_propria', quem_trouxe: ADMIN_ID },
      ),
    ];
    const corpo = await (await chamar()).json();
    expect(corpo.comissaoTime).toBe(2000);
    expect(corpo.repasseSocios).toBe(9900);
  });

  it('venda fora do período não entra', async () => {
    linhas = [venda({ vendido_em: '2026-07-10T12:00:00.000Z', premio_mensal: 2000, operadora: 'AMIL' })];
    const corpo = await (await chamar()).json();
    expect(corpo.vendas).toHaveLength(0);
  });
});
