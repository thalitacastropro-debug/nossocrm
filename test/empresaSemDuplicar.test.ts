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

/**
 * `ILIKE` DE VERDADE, não comparação de igualdade.
 *
 * Isto é o que dá valor ao teste do curinga: o mock precisa interpretar `%` e `_` como o Postgres
 * interpreta, senão o teste passaria mesmo com o escape removido do código de produção — que foi
 * exatamente a ressalva que a revisão adversarial levantou sobre a primeira versão destes testes.
 * `\` escapa o caractere seguinte, como no LIKE.
 */
function casaComoIlike(valorDaColuna: string, pattern: string): boolean {
  const BARRA = String.fromCharCode(92);
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === BARRA && i + 1 < pattern.length) {
      regex += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, (m) => BARRA + m);
      continue;
    }
    if (ch === '%') { regex += '.*'; continue; }
    if (ch === '_') { regex += '.'; continue; }
    regex += ch.replace(/[.*+?^${}()|[\]\\]/g, (m) => BARRA + m);
  }
  return new RegExp('^' + regex + '$', 'i').test(valorDaColuna);
}

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
      const achada = empresas.find((e) => casaComoIlike(e.name, String(alvo ?? '')));
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

/**
 * OS ACHADOS DA REVISÃO ADVERSARIAL (16/09/2026) — o que quase passou.
 *
 * O conserto do find-or-create foi submetido a quatro revisores independentes e cada achado a dois
 * céticos. Estes são os que sobreviveram e viraram bug de verdade.
 */
describe('companiesService.create — o que a revisão pescou', () => {
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

  it('`%` no nome não vira curinga — senão liga o negócio à empresa ERRADA', async () => {
    // O `ilike` do Postgres recebe um PATTERN. Sem escapar, "SAUDE %" casaria "SAUDE 1000 LTDA".
    empresas.push({ id: 'saude-mil', name: 'SAUDE 1000 LTDA', organization_id: ORG_ID });

    const { data } = await companiesService.create({ name: 'SAUDE %' } as never);

    expect(data?.id).not.toBe('saude-mil');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].name).toBe('SAUDE %');
  });

  it('`_` no nome também não casa o vizinho errado', async () => {
    empresas.push({ id: 'saude-1000', name: 'SAUDE 1000 LTDA', organization_id: ORG_ID });

    const { data } = await companiesService.create({ name: 'SAUDE 100_ LTDA' } as never);

    expect(data?.id).not.toBe('saude-1000');
    expect(inserts).toHaveLength(1);
  });

  it('23505 sem conseguir reconsultar devolve instrução, não a string crua do Postgres', async () => {
    erroDoInsert = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "crm_companies_nome_unico_por_org"',
    };

    const { data, error } = await companiesService.create({ name: 'FANTASMA LTDA' } as never);

    expect(data).toBeNull();
    expect(error?.message).not.toContain('duplicate key');
    expect(error?.message).toContain('FANTASMA LTDA');
    expect(error?.message).toMatch(/busca|Empresas/i);
  });

  it('o UPDATE apara o nome — era o único caminho que gravava espaço e travava a busca', async () => {
    let atualizado: Record<string, unknown> | null = null;
    supabaseMock.from = vi.fn((tabela: string) => {
      if (tabela === 'crm_companies') {
        return {
          update: (payload: Record<string, unknown>) => {
            atualizado = payload;
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error('tabela inesperada: ' + tabela);
    });

    await companiesService.update('empresa-1', { name: '  TEAM MONTEIRO  ' } as never);

    expect(atualizado).not.toBeNull();
    expect((atualizado as unknown as { name: string }).name).toBe('TEAM MONTEIRO');
  });
});
