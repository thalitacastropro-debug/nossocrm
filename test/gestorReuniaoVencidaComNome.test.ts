/**
 * @fileoverview As reuniões vencidas passam a ter NOME no relatório da dona — e as recentes primeiro.
 *
 * 28/09/2026, véspera da reunião de time. Havia 12 ligações vencidas sem desfecho, a mais antiga
 * de 13/07 (77 dias), e o relatório da Thalita mostrava só "Reunião de ontem sem desfecho: 12".
 * Contagem não é pauta: ela sabia o número e tinha que ir ao CRM descobrir quais — o mesmo motivo
 * que já tinha feito o relatório do COLABORADOR ganhar nomes em 03/09.
 *
 * Junto veio a ordem: desfecho de reunião é MEMÓRIA, e memória vence. A de 6 dias alguém ainda
 * reconstitui; a de 77 ninguém lembra. Com a ordem antiga (mais velho primeiro), as três nomeadas
 * seriam justamente as três mais mortas.
 */

import { describe, it, expect } from 'vitest';
import { montarDiario } from '@/lib/gestor/regras';
import { formatarDiario } from '@/lib/gestor/formato';

const AGORA = new Date('2026-09-28T18:00:00Z');
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 24 * 36e5).toISOString();
type Linha = Record<string, unknown>;

function fakeSupabase(c: Record<string, Linha[]>) {
  const make = (linhas: Linha[]) => {
    let atual = [...linhas];
    const q: Record<string, unknown> = {};
    let agregar: string | null = null;
    q.select = (col?: string) => {
      const m = typeof col === 'string' ? col.match(/^(\w+)\.sum\(\)$/) : null;
      agregar = m ? m[1] : null; return q;
    };
    q.order = () => q; q.limit = () => q; q.not = () => q;
    q.range = (de: number, ate: number) => { atual = atual.slice(de, ate + 1); return q; };
    q.single = async () => (agregar
      ? { data: { sum: atual.reduce((s, l) => s + Number(l[agregar as string] ?? 0), 0) }, error: null }
      : { data: atual[0] ?? null, error: null });
    q.eq = (col: string, v: unknown) => { atual = atual.filter((l) => l[col] === v); return q; };
    q.in = (col: string, vs: unknown[]) => { atual = atual.filter((l) => vs.includes(l[col])); return q; };
    q.is = (col: string, v: unknown) => { if (v === null) atual = atual.filter((l) => l[col] == null); return q; };
    q.gte = (col: string, v: string) => { atual = atual.filter((l) => String(l[col]) >= v); return q; };
    q.lte = (col: string, v: string) => { atual = atual.filter((l) => String(l[col]) <= v); return q; };
    q.maybeSingle = async () => ({ data: atual[0] ?? null, error: null });
    q.then = (r: (v: { data: Linha[]; count: number; error: null }) => unknown) =>
      Promise.resolve({ data: atual, count: atual.length, error: null }).then(r);
    return q;
  };
  return { from: (t: string) => make((c[t] ?? []).map((l) => ({ ...l }))) } as never;
}

const PERFIS: Linha[] = [
  { id: 'u-den', name: 'Denilson Silva', nickname: null, first_name: null, role: 'admin' },
];

/** Ligação que venceu há N dias e ninguém carimbou. */
const callVencida = (id: string, lead: string, dias: number): Linha[] => ([
  { id: `a-${id}`, deal_id: id, owner_id: 'u-den', title: `Ligação — ${lead}`, type: 'CALL',
    completed: false, deleted_at: null, date: diasAtras(dias), created_at: diasAtras(dias + 1) },
]);
const cardDe = (id: string, lead: string): Linha =>
  ({ id, title: lead, contact_id: `ct-${id}`, owner_id: 'u-den', is_won: false, is_lost: false, deleted_at: null });

async function rodar(cenario: Record<string, Linha[]>) {
  return montarDiario({
    now: AGORA,
    supabase: fakeSupabase({ profiles: PERFIS, ...cenario }),
  } as never);
}

const regra = (d: Awaited<ReturnType<typeof montarDiario>>) =>
  d.regras.find((r) => r.id === 'reuniao-vencida')!;

describe('reunião vencida: nome no relatório da dona, recentes primeiro', () => {
  const CENARIO = {
    deals: [cardDe('d1', 'Jussara Teodoro'), cardDe('d2', 'Giovana Mussi'), cardDe('d3', 'Clara Fernandes'), cardDe('d4', 'Lay Ana Alves')],
    contacts: [
      { id: 'ct-d1', name: 'Jussara Teodoro', owner_id: 'u-den' },
      { id: 'ct-d2', name: 'Giovana Mussi', owner_id: 'u-den' },
      { id: 'ct-d3', name: 'Clara Fernandes', owner_id: 'u-den' },
      { id: 'ct-d4', name: 'Lay Ana Alves', owner_id: 'u-den' },
    ],
    activities: [
      ...callVencida('d1', 'Jussara Teodoro', 6),
      ...callVencida('d2', 'Giovana Mussi', 63),
      ...callVencida('d3', 'Clara Fernandes', 75),
      ...callVencida('d4', 'Lay Ana Alves', 67),
    ],
  };

  it('o acumulado vem da MAIS RECENTE para a mais antiga', async () => {
    const r = regra(await rodar(CENARIO));
    expect(r.estoque).toBe(4);
    expect((r.estoqueItens ?? []).map((i) => i.contato)).toEqual([
      'Jussara Teodoro',   // 6 dias — ainda dá pra reconstituir
      'Giovana Mussi',     // 63
      'Lay Ana Alves',     // 67
      'Clara Fernandes',   // 75 — ninguém lembra
    ]);
  });

  it('o relatório da dona NOMEIA as primeiras, além de contar', async () => {
    const texto = formatarDiario(await rodar(CENARIO), true).replace(/<\/?[bi]>/g, '');

    expect(texto).toContain('Reunião de ontem sem desfecho: 4');
    // A recente aparece com nome; a mais morta fica no "… e mais".
    expect(texto).toContain('Jussara Teodoro');
    expect(texto).not.toContain('Clara Fernandes');
    expect(texto).toMatch(/… e mais 1/);
  });

  it('o número continua lá — nomear não substitui a contagem', async () => {
    const texto = formatarDiario(await rodar(CENARIO), true);
    expect(texto).toMatch(/Reunião de ontem sem desfecho<\/b>?: 4|Reunião de ontem sem desfecho: 4/);
  });

  it('reunião de card já encerrado não é cobrada', async () => {
    const r = regra(await rodar({
      ...CENARIO,
      deals: [{ ...cardDe('d1', 'Jussara Teodoro'), is_lost: true }],
      activities: callVencida('d1', 'Jussara Teodoro', 6),
    }));
    expect(r.estoque).toBe(0);
  });
});
