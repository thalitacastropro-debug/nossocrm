import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * EMPRESA NÃO PODE DUPLICAR — os dois furos da criação de negócio, 16/09/2026.
 *
 * Seis linhas idênticas "TEAM MONTEIRO TREINAMENTOS LTDA" em dois minutos. A duplicação tinha
 * origens independentes, e a mais barulhenta não era a pior:
 *
 * 1. `companiesService.create` era um insert cego — nenhum dos caminhos da interface procurava
 *    antes. Como a empresa é a PRIMEIRA escrita da criação de negócio e o contato vem depois,
 *    cada retentativa do vendedor (o contato estava falhando por RLS) deixava mais uma órfã.
 * 2. Escolher uma empresa JÁ EXISTENTE mandava o nome dela para o mesmo caminho de criação —
 *    criava uma CÓPIA e prendia o negócio à cópia, sem erro nenhum na tela.
 *
 * Atrás dos dois existe o índice `crm_companies_nome_unico_por_org`, que fecha também a corrida
 * entre duas abas. Aqui se testa o lado do app.
 */

const ORG_ID = 'd9bf55f7-c66d-439b-97b2-1fceff0fa9b2';
const USER_ID = '9d46dbae-93e8-4b19-936c-b7c1275a230f';

let empresas: Array<{ id: string; name: string; organization_id: string }>;
let inserts: Record<string, unknown>[];
let erroDoInsert: { code?: string; message?: string } | null;
let supabaseMock: Record<string, unknown>;

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return supabaseMock;
  },
}));

import { companiesService } from '@/lib/supabase/contacts';

/** Builder mínimo de `crm_companies`: só o que o serviço encadeia de verdade. */
function crmCompaniesBuilder() {
  let alvo: string | null = null;
  const b: Record<string, unknown> = {
    select: () => b,
    ilike: (_col: string, valor: string) => {
      alvo = valor;
      return b;
    },
    eq: () => b,
    limit: () => b,
    maybeSingle: async () => {
      const achada = empresas.find(
        (e) => e.name.trim().toLowerCase() === String(alvo ?? '').trim().toLowerCase(),
      );
      return { data: achada ?? null, error: null };
    },
    insert: (payload: Record<string, unknown>) => {
      inserts.push(payload);
      return {
        select: () => ({
          single: async () => {
            if (erroDoInsert) return { data: null, error: erroDoInsert };
            const nova = {
              id: `empresa-${inserts.length}`,
              name: String(payload.name),
              organization_id: String(payload.organization_id ?? ''),
            };
            empresas.push(nova);
            return { data: nova, error: null };
          },
        }),
      };
    },
  };
  return b;
}

describe('companiesService.create — find-or-create', () => {
  beforeEach(() => {
    empresas = [];
    inserts = [];
    erroDoInsert = null;
    supabaseMock = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })) },
      from: vi.fn((tabela: string) => {
        if (tabela === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: { organization_id: ORG_ID }, error: null })),
          };
        }
        if (tabela === 'crm_companies') return crmCompaniesBuilder();
        throw new Error('tabela inesperada: ' + tabela);
      }),
    };
  });

  it('cria quando o nome é novo', async () => {
    const { data, error } = await companiesService.create({ name: 'TEAM MONTEIRO TREINAMENTOS LTDA' } as never);
    expect(error).toBeNull();
    expect(data?.name).toBe('TEAM MONTEIRO TREINAMENTOS LTDA');
    expect(inserts).toHaveLength(1);
  });

  it('a SEGUNDA tentativa com o mesmo nome reusa — era ela que deixava a órfã', async () => {
    const primeira = await companiesService.create({ name: 'TEAM MONTEIRO TREINAMENTOS LTDA' } as never);
    const segunda = await companiesService.create({ name: 'TEAM MONTEIRO TREINAMENTOS LTDA' } as never);

    expect(segunda.error).toBeNull();
    expect(segunda.data?.id).toBe(primeira.data?.id);
    expect(inserts).toHaveLength(1); // só a primeira gravou
  });

  it('caixa e espaço nas pontas não fazem empresa nova (mesmo critério do índice)', async () => {
    const original = await companiesService.create({ name: 'Team Monteiro' } as never);
    const variante = await companiesService.create({ name: '  TEAM MONTEIRO  ' } as never);

    expect(variante.data?.id).toBe(original.data?.id);
    expect(inserts).toHaveLength(1);
  });

  it('empresa de verdade diferente continua sendo criada — o empate não é fuzzy', async () => {
    await companiesService.create({ name: 'Monteiro Ltda' } as never);
    const outra = await companiesService.create({ name: 'Monteiro ME' } as never);

    expect(outra.error).toBeNull();
    expect(inserts).toHaveLength(2);
  });

  it('perder a corrida (23505) devolve a empresa que ganhou, não um erro', async () => {
    // Simula a outra aba: a linha já existe no banco, mas a busca daqui passou antes dela nascer.
    empresas.push({ id: 'da-outra-aba', name: 'TEAM MONTEIRO', organization_id: ORG_ID });
    const buscaOriginal = supabaseMock.from as ReturnType<typeof vi.fn>;
    let primeiraBusca = true;
    supabaseMock.from = vi.fn((tabela: string) => {
      if (tabela === 'crm_companies') {
        const b = crmCompaniesBuilder() as Record<string, unknown>;
        const maybeSingleReal = b.maybeSingle as () => Promise<unknown>;
        b.maybeSingle = async () => {
          if (primeiraBusca) {
            primeiraBusca = false;
            return { data: null, error: null }; // ainda não existia quando olhamos
          }
          return maybeSingleReal();
        };
        return b;
      }
      return (buscaOriginal as (t: string) => unknown)(tabela);
    });
    erroDoInsert = { code: '23505', message: 'duplicate key value violates unique constraint' };

    const { data, error } = await companiesService.create({ name: 'TEAM MONTEIRO' } as never);

    expect(error).toBeNull();
    expect(data?.id).toBe('da-outra-aba');
  });

  it('nome vazio não vira empresa fantasma', async () => {
    const { data, error } = await companiesService.create({ name: '   ' } as never);
    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(inserts).toHaveLength(0);
  });
});
