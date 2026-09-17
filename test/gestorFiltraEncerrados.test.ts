/**
 * @fileoverview O diário parou de cobrar trabalho MORTO — e passou a avisar quando a Ana vai calar.
 *
 * Os dois consertos de 16/09/2026, os dois nascidos do mesmo relatório real:
 *
 * 1. As regras que partem de `messaging_conversations` não enxergavam o estado do card. No
 *    relatório do Pedro, 5 dos 7 "não respondeu ao primeiro contato" eram leads **já perdidos**,
 *    com motivo registrado e lembrete de reabordagem agendado — o mais antigo havia 51 dias. Uma
 *    lista de pendências que inclui o que já foi encerrado ensina a pessoa a ignorar a lista.
 * 2. A Ana bateu o teto mensal de tokens em 14/09 e ficou **muda por dois dias sem ninguém saber**:
 *    o bloqueio não gerava alerta em lugar nenhum.
 */

import { describe, it, expect } from 'vitest';
import { montarDiario } from '@/lib/gestor/regras';
import { formatarDiario, formatarParaColaborador } from '@/lib/gestor/formato';

const AGORA = new Date('2026-09-16T11:00:00Z');
const hAtras = (h: number) => new Date(AGORA.getTime() - h * 36e5).toISOString();

interface Cenario {
  profiles?: unknown[];
  messaging_conversations?: unknown[];
  contacts?: unknown[];
  activities?: unknown[];
  messaging_messages?: unknown[];
  deals?: unknown[];
  organization_settings?: unknown[];
  ai_conversation_log?: unknown[];
}

/** Mock que HONRA os filtros — um mock que ignora filtro testa o cenário, não o código. */
function fakeSupabase(c: Cenario) {
  type Linha = Record<string, unknown>;
  const make = (linhas: Linha[]) => {
    let atual = [...linhas];
    const q: Record<string, unknown> = {};
    // `select('col.sum()')` é agregação server-side do PostgREST e devolve UMA linha `{sum}`.
    // O mock honra isso: sem esse suporte, o teste do orçamento passaria sem exercitar o caminho
    // que o código de verdade usa — e foi justamente a soma truncada em 1000 linhas que a revisão
    // adversarial pescou aqui.
    let agregar: string | null = null;
    q.select = (col?: string) => {
      const m = typeof col === 'string' ? col.match(/^(\w+)\.sum\(\)$/) : null;
      agregar = m ? m[1] : null;
      return q;
    };
    q.order = () => q;
    q.limit = () => q;
    q.range = (de: number, ate: number) => { atual = atual.slice(de, ate + 1); return q; };
    q.single = async () => (agregar
      ? { data: { sum: atual.reduce((s, l) => s + Number(l[agregar as string] ?? 0), 0) }, error: null }
      : { data: atual[0] ?? null, error: null });
    q.eq = (col: string, v: unknown) => { atual = atual.filter((l) => l[col] === v); return q; };
    q.in = (col: string, vs: unknown[]) => { atual = atual.filter((l) => vs.includes(l[col])); return q; };
    q.is = (col: string, v: unknown) => {
      if (v === null) atual = atual.filter((l) => l[col] == null);
      return q;
    };
    q.not = (col: string, _op: string, v: unknown) => {
      if (v === null) {
        const raiz = col.split('->')[0];
        const campo = col.includes('->') ? col.split('->').pop()! : null;
        atual = atual.filter((l) => {
          const base = l[raiz] as Record<string, unknown> | null | undefined;
          return campo ? base?.[campo] != null : base != null;
        });
      }
      return q;
    };
    q.gte = (col: string, v: string) => { atual = atual.filter((l) => String(l[col]) >= v); return q; };
    q.lte = (col: string, v: string) => { atual = atual.filter((l) => String(l[col]) <= v); return q; };
    q.maybeSingle = async () => ({ data: atual[0] ?? null, error: null });
    q.then = (res: (v: { data: Linha[]; count: number; error: null }) => unknown) =>
      Promise.resolve({ data: atual, count: atual.length, error: null }).then(res);
    return q;
  };
  return {
    from: (t: string) => make((((c as Record<string, unknown[]>)[t] ?? []) as Linha[]).map((l) => ({ ...l }))),
  } as never;
}

const PERFIS = [
  { id: 'u-den', name: 'Denilson Silva', nickname: null, first_name: null, role: 'admin' },
  { id: 'u-ped', name: 'Pedro Sellan', nickname: null, first_name: null, role: 'vendedor' },
];

/** Conversa que recebeu o 1º contato há muito tempo e nunca respondeu. */
const conversaMuda = (id: string, contactId: string) => ({
  id, contact_id: contactId, assigned_user_id: 'u-ped',
  last_message_at: hAtras(24 * 20), last_message_direction: 'outbound', last_message_preview: 'Oi!',
});

const contato = (id: string, name: string) => ({ id, name, owner_id: 'u-ped', phone: '5511999990000' });

const itensDe = (d: Awaited<ReturnType<typeof montarDiario>>, regraId: string) => {
  const r = d.regras.find((x) => x.id === regraId);
  return { novos: r?.novos ?? [], estoque: r?.estoque ?? 0, itens: r?.estoqueItens ?? [] };
};

describe('diário — card encerrado não é pendência', () => {
  it('lead PERDIDO some de "não respondeu ao primeiro contato"', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaMuda('c1', 'ct-perdido')],
        contacts: [contato('ct-perdido', 'Tatiane Gutierrez')],
        deals: [{ id: 'd1', contact_id: 'ct-perdido', owner_id: 'u-ped', is_won: false, is_lost: true, deleted_at: null }],
      }),
    });

    expect(itensDe(diario, 'sem-primeira-resposta').estoque).toBe(0);
  });

  it('lead GANHO também some — não é trabalho de ninguém', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaMuda('c1', 'ct-ganho')],
        contacts: [contato('ct-ganho', 'Cliente Fechado')],
        deals: [{ id: 'd1', contact_id: 'ct-ganho', owner_id: 'u-ped', is_won: true, is_lost: false, deleted_at: null }],
      }),
    });

    expect(itensDe(diario, 'sem-primeira-resposta').estoque).toBe(0);
  });

  it('lead com card ABERTO continua cobrado — o conserto não pode calar a lista toda', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaMuda('c1', 'ct-aberto')],
        contacts: [contato('ct-aberto', 'Lead Vivo')],
        deals: [{ id: 'd1', contact_id: 'ct-aberto', owner_id: 'u-ped', is_won: false, is_lost: false, deleted_at: null }],
      }),
    });

    const r = itensDe(diario, 'sem-primeira-resposta');
    expect(r.estoque).toBe(1);
    expect(r.novos[0].contato).toBe('Lead Vivo');
  });

  it('contato com UM card perdido e outro aberto continua cobrado', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaMuda('c1', 'ct-misto')],
        contacts: [contato('ct-misto', 'Voltou a Falar')],
        deals: [
          { id: 'd1', contact_id: 'ct-misto', owner_id: 'u-ped', is_won: false, is_lost: true, deleted_at: null },
          { id: 'd2', contact_id: 'ct-misto', owner_id: 'u-ped', is_won: false, is_lost: false, deleted_at: null },
        ],
      }),
    });

    expect(itensDe(diario, 'sem-primeira-resposta').estoque).toBe(1);
  });

  it('contato SEM card nenhum continua aparecendo — ausência de card não é encerramento', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaMuda('c1', 'ct-solto')],
        contacts: [contato('ct-solto', 'Lead Sem Card')],
        deals: [],
      }),
    });

    expect(itensDe(diario, 'sem-primeira-resposta').estoque).toBe(1);
  });

  it('"falaram e ninguém respondeu" usa a mesma régua — quando o lead não voltou', async () => {
    const conversaComFala = (contactId: string) => ({
      id: 'c9', contact_id: contactId, assigned_user_id: 'u-ped',
      last_message_at: hAtras(48), last_message_direction: 'inbound',
      last_message_preview: 'Quero ver valores',
    });

    const perdido = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaComFala('ct-p')],
        contacts: [contato('ct-p', 'Já Perdido')],
        // Fechado DEPOIS da última fala dele: o assunto morreu com o card, não é reabertura.
        // (Quem fala depois de fechado tem bloco próprio mais abaixo.)
        deals: [{ id: 'd1', contact_id: 'ct-p', owner_id: 'u-ped', is_won: false, is_lost: true, closed_at: hAtras(24), deleted_at: null }],
      }),
    });
    expect(itensDe(perdido, 'sem-resposta').estoque).toBe(0);

    const aberto = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaComFala('ct-a')],
        contacts: [contato('ct-a', 'Ainda Aberto')],
        deals: [{ id: 'd1', contact_id: 'ct-a', owner_id: 'u-ped', is_won: false, is_lost: false, deleted_at: null }],
      }),
    });
    expect(itensDe(aberto, 'sem-resposta').estoque).toBe(1);
  });

  it('reunião sem desfecho de card PERDIDO sai da lista (havia de 51 e 63 dias)', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        activities: [
          { id: 'a1', deal_id: 'd-perdido', owner_id: 'u-ped', type: 'CALL', completed: false, deleted_at: null, title: 'Call', date: hAtras(24 * 60) },
          { id: 'a2', deal_id: 'd-aberto', owner_id: 'u-ped', type: 'CALL', completed: false, deleted_at: null, title: 'Call', date: hAtras(24 * 2) },
        ],
        deals: [
          { id: 'd-perdido', contact_id: null, title: 'Clara', owner_id: 'u-ped', is_won: false, is_lost: true, deleted_at: null },
          { id: 'd-aberto', contact_id: null, title: 'Viva', owner_id: 'u-ped', is_won: false, is_lost: false, deleted_at: null },
        ],
      }),
    });

    const r = itensDe(diario, 'reuniao-vencida');
    expect(r.estoque).toBe(1);
    expect(r.itens[0].contato).toBe('Viva');
  });
});

describe('diário — aviso de orçamento da IA', () => {
  const comOrcamento = (teto: number, usados: number[]) => ({
    profiles: PERFIS,
    organization_settings: [{ ai_monthly_token_limit: teto }],
    ai_conversation_log: usados.map((t, i) => ({
      id: `l${i}`, tokens_used: t, created_at: new Date('2026-09-10T12:00:00Z').toISOString(),
    })),
  });

  it('abaixo de 80% não avisa — senão vira papel de parede', async () => {
    const diario = await montarDiario({ now: AGORA, supabase: fakeSupabase(comOrcamento(1_000_000, [700_000])) });
    expect(itensDe(diario, 'orcamento-ia').estoque).toBe(0);
  });

  it('a partir de 80% avisa, com o número na frente', async () => {
    const diario = await montarDiario({ now: AGORA, supabase: fakeSupabase(comOrcamento(1_000_000, [800_000])) });
    const r = itensDe(diario, 'orcamento-ia');
    expect(r.estoque).toBe(1);
    expect(r.novos[0].contato).toContain('perto de parar');
    expect(r.novos[0].detalhe).toContain('80%');
  });

  it('estourado grita: a Ana PAROU — foi isto que ninguém soube por 2 dias', async () => {
    const diario = await montarDiario({ now: AGORA, supabase: fakeSupabase(comOrcamento(1_000_000, [1_007_241])) });
    const r = itensDe(diario, 'orcamento-ia');
    expect(r.novos[0].contato).toContain('PAROU');
    expect(r.novos[0].detalhe).toContain('1.007.241');
  });

  it('é SIGILOSO: vai para a dona, nunca para o consultor', async () => {
    const diario = await montarDiario({ now: AGORA, supabase: fakeSupabase(comOrcamento(1_000_000, [1_200_000])) });

    const paraDona = formatarDiario(diario as never, true);
    expect(paraDona).toContain('PAROU');

    const paraPedro = formatarParaColaborador(diario as never, { id: 'u-ped', nome: 'Pedro' } as never);
    expect(paraPedro ?? '').not.toContain('PAROU');
    expect(paraPedro ?? '').not.toContain('teto mensal');
  });

  it('falha ao ler o orçamento não derruba o relatório', async () => {
    const quebrado = {
      from: (t: string) => {
        if (t === 'organization_settings') throw new Error('boom');
        return fakeSupabase({ profiles: PERFIS }).from(t);
      },
    } as never;
    const diario = await montarDiario({ now: AGORA, supabase: quebrado });
    expect(itensDe(diario, 'orcamento-ia').estoque).toBe(0);
    expect(diario.regras.length).toBeGreaterThan(1);
  });
});

/**
 * A EXCEÇÃO QUE A REVISÃO ADVERSARIAL SALVOU (16/09/2026).
 *
 * O filtro de card encerrado, na primeira versão, apagou sem querer o item mais valioso do
 * relatório: o lead PERDIDO QUE VOLTA A FALAR. Essa regra — por varrer conversa em vez de card —
 * era a única rede que pegava isso, e é exatamente o que a Thalita pediu para não perder em 11/09
 * (o caso da Flávia com o Pedro: "quando vai pra perdido o lead some; precisamos ter onde resgatar
 * esse lead caso ele volte a conversar").
 */
describe('diário — o perdido que VOLTA a falar', () => {
  const conversaComFala = (contactId: string, quando: string) => ({
    id: 'c9', contact_id: contactId, assigned_user_id: 'u-ped',
    last_message_at: quando, last_message_direction: 'inbound',
    last_message_preview: 'Mudei de ideia, quero ver',
  });

  const cardPerdidoEm = (contactId: string, closedAt: string | null) => ({
    id: 'd1', contact_id: contactId, owner_id: 'u-ped',
    is_won: false, is_lost: true, closed_at: closedAt, deleted_at: null,
  });

  it('falou DEPOIS de perdido: aparece, e o detalhe avisa que voltou', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaComFala('ct-v', hAtras(30))],
        contacts: [contato('ct-v', 'Flávia Voltou')],
        deals: [cardPerdidoEm('ct-v', hAtras(24 * 10))],
      }),
    });

    const r = itensDe(diario, 'sem-resposta');
    expect(r.estoque).toBe(1);
    expect(r.itens[0].detalhe).toContain('VOLTOU');
  });

  it('ficou quieto DESDE o fechamento: continua fora (é trabalho morto)', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaComFala('ct-q', hAtras(24 * 20))],
        contacts: [contato('ct-q', 'Perdido e Quieto')],
        deals: [cardPerdidoEm('ct-q', hAtras(24 * 5))],
      }),
    });

    expect(itensDe(diario, 'sem-resposta').estoque).toBe(0);
  });

  it('fechamento sem `closed_at` mantém o lead: na dúvida, mostrar', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaComFala('ct-s', hAtras(48))],
        contacts: [contato('ct-s', 'Fechado Sem Carimbo')],
        deals: [cardPerdidoEm('ct-s', null)],
      }),
    });

    expect(itensDe(diario, 'sem-resposta').estoque).toBe(1);
  });

  it('cliente GANHO que manda mensagem depois de fechar também aparece', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaComFala('ct-g', hAtras(20))],
        contacts: [contato('ct-g', 'Cliente na Implantação')],
        deals: [{ id: 'd1', contact_id: 'ct-g', owner_id: 'u-ped', is_won: true, is_lost: false, closed_at: hAtras(24 * 3), deleted_at: null }],
      }),
    });

    expect(itensDe(diario, 'sem-resposta').estoque).toBe(1);
  });

  it('"não respondeu ao primeiro contato" NÃO ganha a exceção — lá quem falou fomos nós', async () => {
    const diario = await montarDiario({
      now: AGORA,
      supabase: fakeSupabase({
        profiles: PERFIS,
        messaging_conversations: [conversaMuda('c1', 'ct-p')],
        contacts: [contato('ct-p', 'Perdido Mudo')],
        deals: [cardPerdidoEm('ct-p', hAtras(24 * 30))],
      }),
    });

    expect(itensDe(diario, 'sem-primeira-resposta').estoque).toBe(0);
  });
});

describe('diário — a soma de tokens não pode ser truncada', () => {
  it('usa a agregação do servidor, não 1000 linhas somadas no cliente', async () => {
    // 2.000 chamadas de 8.000 tokens = 16.000.000. Somando só as 1.000 primeiras daria 8.000.000,
    // e com teto de 20.000.000 o alerta ficaria mudo — o caso que a revisão pescou.
    const linhas = Array.from({ length: 2000 }, (_, i) => ({
      id: `l${i}`, tokens_used: 8000, created_at: new Date('2026-09-10T12:00:00Z').toISOString(),
    }));

    let pediuAgregado = false;
    const base = fakeSupabase({
      profiles: PERFIS,
      organization_settings: [{ ai_monthly_token_limit: 20_000_000 }],
      ai_conversation_log: linhas,
    }) as unknown as { from: (t: string) => Record<string, unknown> };

    const supabase = {
      from: (t: string) => {
        const q = base.from(t);
        if (t === 'ai_conversation_log') {
          const selectOriginal = q.select as (c?: string) => unknown;
          q.select = (col?: string) => {
            if (col === 'tokens_used.sum()') {
              pediuAgregado = true;
              const soma = linhas.reduce((s, l) => s + l.tokens_used, 0);
              const agg: Record<string, unknown> = {
                gte: () => agg,
                single: async () => ({ data: { sum: soma }, error: null }),
              };
              return agg;
            }
            return selectOriginal(col);
          };
        }
        return q;
      },
    } as never;

    const diario = await montarDiario({ now: AGORA, supabase });

    expect(pediuAgregado).toBe(true);
    const r = itensDe(diario, 'orcamento-ia');
    expect(r.estoque).toBe(1);
    expect(r.novos[0].detalhe).toContain('16.000.000');
  });
});
