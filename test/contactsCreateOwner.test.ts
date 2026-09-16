import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * O CONTATO NOVO PRECISA NASCER COM DONO — senão o vendedor NÃO CONSEGUE CRIAR NEGÓCIO.
 *
 * Caso real (Pedro, 16/09/2026): seis tentativas seguidas de cadastrar uma indicação, seis
 * `POST /rest/v1/contacts` → **403**. A cadeia, provada no banco:
 *
 * 1. `contactsService.create` mandava o insert SEM `owner_id`;
 * 2. o trigger `zz_dono_padrao_lead_novo` carimbava o Denilson (ele existe para os 5 caminhos
 *    AUTOMÁTICOS de entrada de lead — o comentário do próprio trigger diz que card criado na mão
 *    pela UI nasce com o dono do criador);
 * 3. o `.select()` do PostgREST vira `INSERT ... RETURNING`, e o Postgres submete o RETURNING à
 *    policy de SELECT (`ve_tudo() or owner_id = auth.uid()`);
 * 4. o vendedor não enxerga a linha que acabou de criar → 42501 → **a transação inteira volta
 *    atrás**. Nem contato, nem negócio. A tela dizia só "Erro ao criar negócio".
 *
 * Admin nunca viu o bug (`ve_tudo()` é true para ele) — ele só existia para o papel que mais
 * cadastra lead na mão. Este teste fixa a única coisa que o conserto precisa garantir: o
 * `owner_id` vai no payload.
 */

const USER_ID = '9d46dbae-93e8-4b19-936c-b7c1275a230f';
const ORG_ID = 'd9bf55f7-c66d-439b-97b2-1fceff0fa9b2';

let payloads: Record<string, unknown>[];
let supabaseMock: Record<string, unknown>;

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return supabaseMock;
  },
}));

import { contactsService } from '@/lib/supabase/contacts';

describe('contactsService.create — o dono vai junto', () => {
  beforeEach(() => {
    payloads = [];
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
        if (tabela === 'contacts') {
          return {
            insert: vi.fn((payload: Record<string, unknown>) => {
              payloads.push(payload);
              return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn(async () => ({
                  data: { id: 'novo', name: payload.name, owner_id: payload.owner_id },
                  error: null,
                })),
              };
            }),
          };
        }
        throw new Error('tabela inesperada: ' + tabela);
      }),
    };
  });

  it('manda `owner_id` = quem está logado (sem ele o insert volta 403 para vendedor)', async () => {
    const { error } = await contactsService.create({
      name: 'Indicação do Pedro',
      email: '',
      phone: '',
      status: 'ACTIVE',
      stage: 'LEAD',
    } as never);

    expect(error).toBeNull();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].owner_id).toBe(USER_ID);
    // A organização continua indo junto — é o WITH CHECK da policy de INSERT.
    expect(payloads[0].organization_id).toBe(ORG_ID);
  });

  it('sem sessão, não inventa dono (o insert é que vai falhar, não o payload)', async () => {
    supabaseMock.auth = { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) };

    await contactsService.create({
      name: 'Sem sessão',
      email: '',
      phone: '',
      status: 'ACTIVE',
      stage: 'LEAD',
    } as never);

    expect(payloads[0]).not.toHaveProperty('owner_id');
  });
});
