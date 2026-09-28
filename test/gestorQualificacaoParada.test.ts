/**
 * @fileoverview O diário passou a enxergar a etapa que era cemitério.
 *
 * 28/09/2026: a Thalita foi olhar o CRM e achou 23 cards empilhados em
 * "Comercial — Consultor / qualificação", parados de 2 a 34 dias, 21 no nome do Denilson. Nenhum
 * havia aparecido em relatório nenhum, nem uma vez — e o cron do gestor roda e sucede todo dia
 * útil desde 01/09.
 *
 * As duas regras que poderiam pegar eram estruturalmente cegas para eles:
 *  - `regraSemResposta` só olha conversa em que o LEAD falou por último; ali quem falou por último
 *    foi sempre a Ana, encerrando a cadência com "vou pausar por aqui";
 *  - `regraNegociacaoParada` filtrava `.eq('name','negociacao')` — era o único filtro de etapa do
 *    arquivo inteiro.
 */

import { describe, it, expect } from 'vitest';
import { montarDiario } from '@/lib/gestor/regras';

const AGORA = new Date('2026-09-28T11:00:00Z');
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 24 * 36e5).toISOString();
const diasAFrente = (d: number) => new Date(AGORA.getTime() + d * 24 * 36e5).toISOString();

type Linha = Record<string, unknown>;

/** Mock que HONRA os filtros — um mock que ignora filtro testa o cenário, não o código. */
function fakeSupabase(c: Record<string, Linha[]>) {
  const make = (linhas: Linha[]) => {
    let atual = [...linhas];
    const q: Record<string, unknown> = {};
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
    q.not = () => q;
    q.gte = (col: string, v: string) => { atual = atual.filter((l) => String(l[col]) >= v); return q; };
    q.lte = (col: string, v: string) => { atual = atual.filter((l) => String(l[col]) <= v); return q; };
    q.maybeSingle = async () => ({ data: atual[0] ?? null, error: null });
    q.then = (res: (v: { data: Linha[]; count: number; error: null }) => unknown) =>
      Promise.resolve({ data: atual, count: atual.length, error: null }).then(res);
    return q;
  };
  return { from: (t: string) => make((c[t] ?? []).map((l) => ({ ...l }))) } as never;
}

const PERFIS: Linha[] = [
  { id: 'u-den', name: 'Denilson Silva', nickname: null, first_name: null, role: 'admin' },
  { id: 'u-ped', name: 'Pedro Sellan', nickname: null, first_name: null, role: 'vendedor' },
];

const ETAPAS: Linha[] = [
  { id: 'st-qualif', name: 'qualificacao' },
  { id: 'st-negoc', name: 'negociacao' },
];

/** Card na etapa de qualificação, parado há N dias. */
function card(id: string, nome: string, dias: number, extra: Linha = {}): Linha {
  return {
    id, title: nome, owner_id: 'u-ped', contact_id: `ct-${id}`, stage_id: 'st-qualif',
    is_won: false, is_lost: false, deleted_at: null,
    last_stage_change_date: diasAtras(dias),
    custom_fields: { handoff_consultor: { motivo: 'sem_resposta_ligar', at: diasAtras(dias) } },
    ...extra,
  };
}
const contatoDe = (id: string, nome: string): Linha => ({ id: `ct-${id}`, name: nome, owner_id: 'u-ped' });

function rodar(cenario: Record<string, Linha[]>) {
  return montarDiario({
    now: AGORA,
    supabase: fakeSupabase({ profiles: PERFIS, board_stages: ETAPAS, ...cenario }),
  } as never);
}

const regra = (d: Awaited<ReturnType<typeof montarDiario>>) =>
  d.regras.find((r) => r.id === 'qualificacao-parada')!;

describe('diário — lead largado na etapa de qualificação', () => {
  it('card parado além do limite entra, no nome de quem o recebeu', async () => {
    const d = await rodar({
      deals: [card('d1', 'Rafael Almeida', 6)],
      contacts: [contatoDe('d1', 'Rafael Almeida')],
    });

    const r = regra(d);
    expect(r.estoque).toBe(1);
    expect(r.novos[0].contato).toBe('Rafael Almeida');
    expect(r.novos[0].donoId).toBe('u-ped');
    expect(r.novos[0].donoNome).toBe('Pedro Sellan');
  });

  it('card recente NÃO entra — abaixo de 5 dias ainda é trabalho em andamento', async () => {
    const d = await rodar({
      deals: [card('d1', 'Junia Soares', 2)],
      contacts: [contatoDe('d1', 'Junia Soares')],
    });
    expect(regra(d).estoque).toBe(0);
  });

  it('quem JÁ marcou o próximo passo não é cobrado — alerta tem que ser desligável', async () => {
    // Silêncio com retorno agendado é plano, não abandono. Mesma isenção da regra de negociação.
    const d = await rodar({
      deals: [card('d1', 'Sara Teles', 10)],
      contacts: [contatoDe('d1', 'Sara Teles')],
      activities: [{ deal_id: 'd1', created_at: diasAtras(10), date: diasAFrente(2), completed: false, deleted_at: null }],
    });
    expect(regra(d).estoque).toBe(0);
  });

  it('tarefa marcada para daqui a anos NÃO desliga o alerta', async () => {
    // Sem o teto bastaria agendar para 2030 e o card sumia da cobrança para sempre.
    const d = await rodar({
      deals: [card('d1', 'Card eterno', 10)],
      contacts: [contatoDe('d1', 'Card eterno')],
      activities: [{ deal_id: 'd1', created_at: diasAtras(10), date: diasAFrente(400), completed: false, deleted_at: null }],
    });
    expect(regra(d).estoque).toBe(1);
  });

  it('alguém encostou no card ontem => o relógio zera', async () => {
    const d = await rodar({
      deals: [card('d1', 'Mari', 20)],
      contacts: [contatoDe('d1', 'Mari')],
      activities: [{ deal_id: 'd1', created_at: diasAtras(1), date: null, completed: true, deleted_at: null }],
    });
    expect(regra(d).estoque).toBe(0);
  });

  /**
   * Card repassado HOJE não cobra o novo dono amanhã de manhã.
   *
   * A rota de repasse grava a nota "Responsável alterado", e ela conta como toque no card. Quem
   * acabou de receber a carteira precisa da janela inteira para trabalhar — abrir o relatório já
   * devendo é o tipo de alerta que ensina a ignorar o relatório. Fixado aqui porque o
   * comportamento vinha de graça e ninguém saberia que era de propósito.
   */
  it('card REPASSADO hoje não cobra o novo dono no mesmo dia', async () => {
    const d = await rodar({
      deals: [card('d1', 'Recém-repassado', 20)],
      contacts: [contatoDe('d1', 'Recém-repassado')],
      activities: [{ deal_id: 'd1', created_at: diasAtras(0), date: null, completed: true, deleted_at: null }],
    });
    expect(regra(d).estoque).toBe(0);
  });

  it('card ganho ou perdido não é trabalho de ninguém', async () => {
    const d = await rodar({
      deals: [
        card('d1', 'Ganho', 20, { is_won: true }),
        card('d2', 'Perdido', 20, { is_lost: true }),
      ],
      contacts: [contatoDe('d1', 'Ganho'), contatoDe('d2', 'Perdido')],
    });
    expect(regra(d).estoque).toBe(0);
  });

  it('não invade a etapa de negociação — aquela já tem dona', async () => {
    const d = await rodar({
      deals: [{ ...card('d1', 'Em negociação', 20), stage_id: 'st-negoc' }],
      contacts: [contatoDe('d1', 'Em negociação')],
    });
    expect(regra(d).estoque).toBe(0);
  });

  it('o detalhe diz COMO o card chegou — muda o que a pessoa faz com ele', async () => {
    const d = await rodar({
      deals: [
        card('d1', 'Veio da Ana', 6),
        { ...card('d2', 'Ana não resolveu', 7), custom_fields: { handoff_consultor: { motivo: 'ana_nao_resolveu' } } },
        { ...card('d3', 'Chegou na mão', 8), custom_fields: {} },
      ],
      contacts: [contatoDe('d1', 'Veio da Ana'), contatoDe('d2', 'Ana não resolveu'), contatoDe('d3', 'Chegou na mão')],
    });

    const porNome = new Map(regra(d).novos.map((i) => [i.contato, i.detalhe]));
    // `sem_resposta_ligar` é a Ana avisando que já tentou por escrito: insistir por mensagem é
    // repetir o canal que falhou.
    expect(porNome.get('Veio da Ana')).toContain('ninguém ligou');
    expect(porNome.get('Ana não resolveu')).toContain('não resolveu');
    expect(porNome.get('Chegou na mão')).toContain('nada preenchido no card');
  });

  it('ordena do MAIS RECENTE — quem caiu anteontem ainda atende o telefone', async () => {
    const d = await rodar({
      deals: [card('d1', 'Fossil', 34), card('d2', 'Fresco', 6), card('d3', 'Medio', 15)],
      contacts: [contatoDe('d1', 'Fossil'), contatoDe('d2', 'Fresco'), contatoDe('d3', 'Medio')],
    });
    expect(regra(d).novos.map((i) => i.contato)).toEqual(['Fresco', 'Medio', 'Fossil']);
  });

  it('a ação diz o gesto exato, incluindo a saída por Nutrição', async () => {
    const d = await rodar({ deals: [card('d1', 'Qualquer', 6)], contacts: [contatoDe('d1', 'Qualquer')] });
    expect(regra(d).acao).toMatch(/Liga HOJE/);
    expect(regra(d).acao).toMatch(/Nutrição/);
  });

  it('a pilha real de 28/09 apareceria: 23 cards, contados por dono', async () => {
    const deals = [
      ...Array.from({ length: 21 }, (_, i) => ({ ...card(`den${i}`, `Lead Den ${i}`, 6 + i), owner_id: 'u-den' })),
      card('ped1', 'Lead Pedro', 12),
      card('ped2', 'Lead Pedro 2', 30),
    ];
    const d = await rodar({
      deals,
      contacts: deals.map((x) => ({ id: `ct-${x.id}`, name: x.title, owner_id: x.owner_id })),
    });

    const r = regra(d);
    expect(r.estoque).toBe(23);
    expect(r.estoquePorDono?.['u-den']).toBe(21);
    expect(r.estoquePorDono?.['u-ped']).toBe(2);
  });
});
