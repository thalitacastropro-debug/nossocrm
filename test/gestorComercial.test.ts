/**
 * @fileoverview O diário comercial: o que vira lista, o que vira número.
 *
 * A regra central que estes testes protegem nasceu de uma medição: a lista de
 * pendências, simulada rodando 30 dias, foi IDÊNTICA à do dia anterior em 28
 * deles. Um alerta que repete a mesma coisa toda manhã vira papel de parede.
 * Por isso só o que MUDOU desde ontem é listado com nome; o resto é contagem.
 */

import { describe, it, expect } from 'vitest';
import { montarDiario, idadeLegivel, ehRuido, type Diario } from '@/lib/gestor/regras';
import { formatarDiario, formatarParaColaborador } from '@/lib/gestor/formato';

/** 01/09/2026, 08:00 BRT — o horário em que o cron roda. */
const AGORA = new Date('2026-09-01T11:00:00Z');
const hAtras = (h: number) => new Date(AGORA.getTime() - h * 36e5).toISOString();

interface Cenario {
  profiles?: unknown[];
  messaging_conversations?: unknown[];
  contacts?: unknown[];
  activities?: unknown[];
  messaging_messages?: unknown[];
  deals?: unknown[];
}

/**
 * Supabase de mentira que HONRA os filtros.
 *
 * A 1ª versão ignorava `eq`/`in`/`gte` e devolvia a tabela inteira. Parecia
 * suficiente e não era: com as atividades CALL e NOTE na mesma tabela, a
 * consulta de CALL recebia a NOTE junto e a regra da contradição contava 2 onde
 * havia 1. Um mock que ignora filtro testa o cenário, não o código — e teria
 * dado verde numa regra errada.
 */
function fakeSupabase(c: Cenario) {
  type Linha = Record<string, unknown>;

  const make = (linhas: Linha[]) => {
    let atual = [...linhas];
    const q: Record<string, unknown> = {};

    q.select = () => q;
    q.order = () => q;
    q.limit = () => q;
    q.eq = (col: string, v: unknown) => { atual = atual.filter((l) => l[col] === v); return q; };
    q.in = (col: string, vs: unknown[]) => { atual = atual.filter((l) => vs.includes(l[col])); return q; };
    q.is = (col: string, v: unknown) => {
      if (v === null) atual = atual.filter((l) => l[col] == null);
      return q;
    };
    // `.not('custom_fields->venda','is',null)` — só a forma usada pelas regras.
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

    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (res: (v: { data: Linha[]; count: number; error: null }) => unknown) =>
      Promise.resolve({ data: atual, count: atual.length, error: null }).then(res);
    return q;
  };

  return {
    from: (tabela: string) => make((((c as Record<string, unknown[]>)[tabela] ?? []) as Linha[]).map((l) => ({ ...l }))),
  } as never;
}

const PERFIS = [
  { id: 'u-den', name: 'Denilson Silva', nickname: null, first_name: null, role: 'admin' },
  { id: 'u-ped', name: 'Pedro Sellan', nickname: null, first_name: null, role: 'vendedor' },
];

describe('idadeLegivel', () => {
  it('fala como gente', () => {
    expect(idadeLegivel(5)).toBe('há 5h');
    expect(idadeLegivel(24)).toBe('há 1 dia');
    expect(idadeLegivel(34 * 24)).toBe('há 34 dias');
  });
});

describe('ehRuido — o que NÃO é lead esperando resposta', () => {
  // Casos reais que apareceram ao rodar as regras contra a produção em 31/08.
  const base = { telefonesInternos: new Set(['5511988209448']), nomesInternos: new Set(['thalita']) };

  it('"👍🏻" sozinho não é pedido de resposta', () => {
    expect(ehRuido({ ...base, nomeContato: 'Silvia', telefoneContato: '5511999', ultimaFala: '👍🏻' })).toBe(true);
  });

  it('"ok" e "obrigada" também não', () => {
    expect(ehRuido({ ...base, nomeContato: 'X', telefoneContato: null, ultimaFala: 'ok' })).toBe(true);
    expect(ehRuido({ ...base, nomeContato: 'X', telefoneContato: null, ultimaFala: 'Obrigada!' })).toBe(true);
  });

  it('o número do próprio canal e o time saem da lista', () => {
    expect(ehRuido({ ...base, nomeContato: 'Niva', telefoneContato: '+55 11 98820-9448', ultimaFala: 'oi' })).toBe(true);
    expect(ehRuido({ ...base, nomeContato: 'Thalita', telefoneContato: null, ultimaFala: '?' })).toBe(true);
  });

  it('mas lead de verdade PASSA, mesmo com mensagem curta', () => {
    expect(ehRuido({ ...base, nomeContato: 'Giovana', telefoneContato: '5511777', ultimaFala: 'Eu não atendo ligações' })).toBe(false);
    expect(ehRuido({ ...base, nomeContato: 'Bruce', telefoneContato: '5561984', ultimaFala: 'Estou disponível' })).toBe(false);
    // "Cancelar" é curto e é EXATAMENTE o que não pode escapar.
    expect(ehRuido({ ...base, nomeContato: 'ThiLipe', telefoneContato: '5511888', ultimaFala: 'Cancelar' })).toBe(false);
  });
});

describe('regra: falaram e ninguém respondeu', () => {
  const cenario = (): Cenario => ({
    profiles: PERFIS,
    messaging_conversations: [
      // Novo: ficou mudo nas últimas 24h.
      { id: 'c1', contact_id: 'p1', assigned_user_id: 'u-den', last_message_at: hAtras(6), last_message_direction: 'inbound', last_message_preview: 'Estou disponível' },
      // Estoque: a Lilian, 34 dias. Não pode aparecer na lista todo dia.
      { id: 'c2', contact_id: 'p2', assigned_user_id: 'u-ped', last_message_at: hAtras(34 * 24), last_message_direction: 'inbound', last_message_preview: 'Não ligou ainda' },
    ],
    contacts: [
      { id: 'p1', name: 'Bruce Mendes', owner_id: 'u-den' },
      { id: 'p2', name: 'Lilian Bosi', owner_id: 'u-ped' },
    ],
  });

  it('lista só quem ficou sem resposta desde ontem, mas conta todo mundo', async () => {
    const d = await montarDiario({ supabase: fakeSupabase(cenario()), now: AGORA });
    const r = d.regras.find((x) => x.id === 'sem-resposta')!;
    expect(r.novos.map((i) => i.contato)).toEqual(['Bruce Mendes']);
    expect(r.estoque).toBe(2);
  });

  it('cobra a pessoa certa: o dono da conversa', async () => {
    const d = await montarDiario({ supabase: fakeSupabase(cenario()), now: AGORA });
    const r = d.regras.find((x) => x.id === 'sem-resposta')!;
    expect(r.novos[0].donoNome).toBe('Denilson Silva');
  });

  it('leva a frase do lead junto — é ela que faz a pessoa agir', async () => {
    const d = await montarDiario({ supabase: fakeSupabase(cenario()), now: AGORA });
    const r = d.regras.find((x) => x.id === 'sem-resposta')!;
    expect(r.novos[0].detalhe).toContain('Estou disponível');
  });
});

describe('regra: contradição (marcou realizada sem escrever desfecho)', () => {
  const base = (descricaoNota: string | null): Cenario => ({
    profiles: PERFIS,
    activities: [
      { id: 'a1', deal_id: 'd1', owner_id: 'u-ped', type: 'CALL', completed: true, date: hAtras(20), created_at: hAtras(20) },
      ...(descricaoNota === null
        ? []
        : [{ id: 'a2', deal_id: 'd1', owner_id: 'u-ped', type: 'NOTE', date: hAtras(19), created_at: hAtras(19), description: descricaoNota }]),
    ],
    deals: [{ id: 'd1', title: 'Alice', contact_id: null }],
  });

  it('acusa quando não há nota nenhuma', async () => {
    const d = await montarDiario({ supabase: fakeSupabase(base(null)), now: AGORA });
    const r = d.regras.find((x) => x.id === 'contradicao')!;
    expect(r.novos).toHaveLength(1);
    expect(r.novos[0].contato).toBe('Alice');
  });

  it('NÃO acusa quando existe desfecho escrito de verdade', async () => {
    const nota = 'Reunião realizada para apresentar plano com coparticipação de R$ 2.574,00. Cliente ficou de falar com a esposa.';
    const d = await montarDiario({ supabase: fakeSupabase(base(nota)), now: AGORA });
    expect(d.regras.find((x) => x.id === 'contradicao')!.novos).toHaveLength(0);
  });

  it('nota curta de sistema não conta como desfecho', async () => {
    // "Responsável alterado" é log, não desfecho — senão a regra se auto-anula.
    const d = await montarDiario({ supabase: fakeSupabase(base('Responsável alterado')), now: AGORA });
    expect(d.regras.find((x) => x.id === 'contradicao')!.novos).toHaveLength(1);
  });

  it('é sigilosa: nunca sai no relatório do time', async () => {
    const d = await montarDiario({ supabase: fakeSupabase(base(null)), now: AGORA });
    expect(d.regras.find((x) => x.id === 'contradicao')!.sigiloso).toBe(true);
  });
});

describe('regra: mensagem que não chegou', () => {
  it('agrupa por conversa — 39 falhas no mesmo número é UMA notícia', async () => {
    const cenario: Cenario = {
      profiles: PERFIS,
      messaging_messages: Array.from({ length: 39 }, (_, i) => ({
        id: `m${i}`, conversation_id: 'c9', created_at: hAtras(3), status: 'failed', error_message: 'not on whatsapp',
      })),
      messaging_conversations: [{ id: 'c9', contact_id: 'p9' }],
      contacts: [{ id: 'p9', name: 'Numero Inexistente' }],
    };
    const d = await montarDiario({ supabase: fakeSupabase(cenario), now: AGORA });
    const r = d.regras.find((x) => x.id === 'envio-falhou')!;
    expect(r.novos).toHaveLength(1);
    expect(r.novos[0].detalhe).toContain('39');
    expect(r.estoque).toBe(39);
  });
});

describe('regra: venda sem prêmio', () => {
  it('cobra venda sem prêmio e ignora venda desfeita', async () => {
    const cenario: Cenario = {
      profiles: PERFIS,
      deals: [
        { id: 'd1', title: 'Richard', owner_id: 'u-ped', is_lost: true, custom_fields: { venda: { premio_mensal: null } } },
        { id: 'd2', title: 'Mavie', owner_id: 'u-den', is_lost: false, custom_fields: { venda: { premio_mensal: null, vendido_em: hAtras(72) } } },
        { id: 'd3', title: 'OK', owner_id: 'u-den', is_lost: false, custom_fields: { venda: { premio_mensal: 3468.44 } } },
      ],
    };
    const d = await montarDiario({ supabase: fakeSupabase(cenario), now: AGORA });
    const r = d.regras.find((x) => x.id === 'venda-sem-premio')!;
    expect(r.novos.map((i) => i.contato)).toEqual(['Mavie']);
  });
});

describe('formatarDiario', () => {
  const diario: Diario = {
    data: 'terça-feira, 01/09',
    ontem: { mensagensDeLead: 3, notasEscritas: 1, reunioesMarcadas: 0 },
    regras: [
      {
        id: 'sem-resposta', titulo: 'Falaram e ninguém respondeu', emoji: '🔴', estoque: 6,
        novos: [{ donoId: 'u-den', donoNome: 'Denilson Silva', contato: 'Bruce Mendes', detalhe: '"Estou disponível"', idadeHoras: 6 }],
      },
      {
        id: 'contradicao', titulo: 'Marcou realizada, não escreveu desfecho', emoji: '⚡', sigiloso: true, estoque: 1,
        novos: [{ donoId: 'u-ped', donoNome: 'Pedro Sellan', contato: 'Alice', detalhe: 'carimbou realizada, sem nota', idadeHoras: 20 }],
      },
    ],
  };

  it('agrupa por colaborador — é assim que ela faz a daily', () => {
    const t = formatarDiario(diario, true);
    expect(t).toContain('<b>Denilson Silva</b>');
    expect(t).toContain('<b>Pedro Sellan</b>');
    expect(t.indexOf('Denilson')).toBeLessThan(t.indexOf('Pedro'));
  });

  it('a contradição some no relatório do time e fica no da dona', () => {
    expect(formatarDiario(diario, true)).toContain('Alice');
    expect(formatarDiario(diario, false)).not.toContain('Alice');
  });

  it('o acumulado vai como NÚMERO, não como lista', () => {
    const t = formatarDiario(diario, true);
    expect(t).toContain('Acumulado');
    expect(t).toContain('Falaram e ninguém respondeu: 6');
  });

  it('mostra o pulso de ontem', () => {
    expect(formatarDiario(diario, true)).toContain('3 mensagens de lead');
  });

  it('dia sem novidade diz isso — e não finge que a operação está limpa', () => {
    const vazio: Diario = { ...diario, regras: [{ ...diario.regras[0], novos: [], estoque: 6 }] };
    const t = formatarDiario(vazio, true);
    expect(t).toContain('Nada novo para cobrar hoje');
    expect(t).toContain('6');
  });

  it('escapa HTML: nome de lead com < não pode quebrar a mensagem', () => {
    const perigoso: Diario = {
      ...diario,
      regras: [{ ...diario.regras[0], novos: [{ ...diario.regras[0].novos[0], contato: '<b>Bruce</b>' }] }],
    };
    expect(formatarDiario(perigoso, true)).toContain('&lt;b&gt;Bruce&lt;/b&gt;');
  });

  it('respeita o limite do Telegram (dona)', () => {
    const muitos: Diario = {
      ...diario,
      regras: [{
        ...diario.regras[0],
        novos: Array.from({ length: 200 }, (_, i) => ({
          donoId: 'u-den', donoNome: 'Denilson Silva', contato: `Lead ${i} ${'x'.repeat(60)}`, detalhe: 'teste', idadeHoras: i,
        })),
      }],
    };
    expect(formatarDiario(muitos, true).length).toBeLessThanOrEqual(3902);
  });

  // O corte antigo cortava em qualquer posição. Se caísse dentro de um <b> ou de
  // uma entidade &amp;, o Telegram recusava a mensagem INTEIRA com
  // "can't parse entities" — nenhuma mensagem, justo no dia mais cheio.
  it('corta sem partir marcação no meio', () => {
    const muitos: Diario = {
      ...diario,
      regras: [{
        ...diario.regras[0],
        novos: Array.from({ length: 200 }, (_, i) => ({
          donoId: 'u-den',
          donoNome: 'Denilson Silva',
          contato: `Lead ${i} ${'x'.repeat(60)}`,
          detalhe: 'teste',
          idadeHoras: i,
        })),
      }],
    };

    const t = formatarDiario(muitos, true);
    const abre = (t.match(/<b>/g) ?? []).length;
    const fecha = (t.match(/<\/b>/g) ?? []).length;
    expect(abre).toBe(fecha);
    // e não sobrou tag pela metade no fim
    expect(t).not.toMatch(/<[a-z/]*$/i);
    expect(t).not.toMatch(/&[a-z]*$/i);
  });
});

describe('formatarParaColaborador — o que chega no celular de cada um', () => {
  const diario: Diario = {
    data: 'terça-feira, 01/09',
    ontem: { mensagensDeLead: 3, notasEscritas: 1, reunioesMarcadas: 0 },
    regras: [
      {
        id: 'sem-resposta', titulo: 'Falaram e ninguém respondeu', emoji: '🔴', estoque: 20,
        novos: [
          { donoId: 'u-den', donoNome: 'Denilson Silva', contato: 'Bruce Mendes', detalhe: '"Estou disponível"', idadeHoras: 6 },
          { donoId: 'u-ped', donoNome: 'Pedro Sellan', contato: 'Giovana Mussi', detalhe: '"Eu não atendo ligações"', idadeHoras: 9 },
        ],
      },
      {
        id: 'contradicao', titulo: 'Marcou realizada, não escreveu desfecho', emoji: '⚡', sigiloso: true, estoque: 1,
        novos: [{ donoId: 'u-ped', donoNome: 'Pedro Sellan', contato: 'Alice', detalhe: 'carimbou realizada, sem nota', idadeHoras: 20 }],
      },
    ],
  };

  it('o Pedro recebe só o que é DELE — nunca o do Denilson', () => {
    const t = formatarParaColaborador(diario, 'u-ped')!;
    expect(t).toContain('Giovana Mussi');
    expect(t).not.toContain('Bruce Mendes');
  });

  it('🔒 a contradição NUNCA chega no colaborador, nem sendo dele', () => {
    // A Alice é item do Pedro. Ainda assim não pode aparecer no relatório dele.
    const t = formatarParaColaborador(diario, 'u-ped')!;
    expect(t).not.toContain('Alice');
    // E continua aparecendo no da dona.
    expect(formatarDiario(diario, true)).toContain('Alice');
  });

  it('não manda o acumulado do TIME para quem executa', () => {
    const t = formatarParaColaborador(diario, 'u-ped')!;
    expect(t).not.toContain('Acumulado');
    expect(t).not.toContain('20');
  });

  // O furo que a Thalita achou em 31/08 ao perguntar "o Pedro só tem isso?":
  // o Denilson tinha 10 reuniões vencidas, nenhuma nova, e por isso NÃO
  // recebia bloco nenhum. Quem carregava a maior dívida sumia do radar.
  it('mostra o acumulado DELE mesmo num dia sem nenhuma novidade', () => {
    const semNovidade: Diario = {
      ...diario,
      regras: [{
        id: 'reuniao-vencida', titulo: 'Reunião de ontem sem desfecho', emoji: '⏸️',
        novos: [], estoque: 12, estoquePorDono: { 'u-den': 10, 'u-ped': 2 },
      }],
    };
    const t = formatarParaColaborador(semNovidade, 'u-den')!;
    expect(t).toContain('Nada novo entrou desde ontem');
    expect(t).toContain('Ainda em aberto com você');
    expect(t).toContain('Reunião de ontem sem desfecho: 10');
    // e não vaza o número do colega nem o total do time
    expect(t).not.toContain('12');
  });

  it('só devolve null quando não há NEM novidade NEM acumulado', () => {
    expect(formatarParaColaborador(diario, 'u-ninguem')).toBeNull();
  });

  it('escapa HTML também no relatório individual', () => {
    const perigoso: Diario = {
      ...diario,
      regras: [{ ...diario.regras[0], novos: [{ ...diario.regras[0].novos[1], contato: '<b>X</b>' }] }],
    };
    expect(formatarParaColaborador(perigoso, 'u-ped')!).toContain('&lt;b&gt;X&lt;/b&gt;');
  });
});

// Pedido da Thalita em 02/09/2026: *"a do Pedro precisa ser mais detalhada ou mais
// explicativa, ele precisa entender as prioridades do dia e que será cobrado de acordo com o
// que preenche ou deixa de preencher no sistema"*.
describe('formatarParaColaborador — explicativo para quem executa', () => {
  const comAcao: Diario = {
    data: 'terça-feira, 02/09',
    ontem: { mensagensDeLead: 3, notasEscritas: 0, reunioesMarcadas: 0 },
    regras: [
      {
        id: 'sem-resposta', titulo: 'Falaram e ninguém respondeu', emoji: '🔴', estoque: 21,
        acao: 'Responder no chat do CRM.',
        estoquePorDono: { 'u-ped': 21 },
        novos: [
          { donoId: 'u-ped', donoNome: 'Pedro Sellan', contato: 'Rose Meire', detalhe: '"os valores?"', idadeHoras: 19 },
          { donoId: 'u-ped', donoNome: 'Pedro Sellan', contato: 'Pablo Henrique', detalhe: '"ainda dá?"', idadeHoras: 14 },
        ],
      },
    ],
  };

  it('numera as prioridades na ordem', () => {
    const t = formatarParaColaborador(comAcao, 'u-ped')!;
    expect(t).toContain('Suas prioridades de hoje, nesta ordem');
    expect(t).toContain('1. 🔴 <b>Rose Meire</b>');
    expect(t).toContain('2. 🔴 <b>Pablo Henrique</b>');
  });

  it('diz o gesto que encerra cada item — alerta sem ação é adivinhação', () => {
    expect(formatarParaColaborador(comAcao, 'u-ped')!).toContain('↳ Responder no chat do CRM.');
  });

  it('explica que a cobrança é sobre o REGISTRO, não sobre a palavra de ninguém', () => {
    const t = formatarParaColaborador(comAcao, 'u-ped')!;
    expect(t).toContain('Como esta lista funciona');
    expect(t).toContain('para o sistema ele não aconteceu');
  });
});

// Pedido da mesma conversa: *"a cobrança do Denilson é diferente por ele ser o responsável
// pelo Pedro"*. Quem cobra chega na daily sabendo o que o outro tem em aberto.
describe('formatarParaColaborador — a visão de quem é responsável pela equipe', () => {
  const diario: Diario = {
    data: 'terça-feira, 02/09',
    ontem: { mensagensDeLead: 5, notasEscritas: 0, reunioesMarcadas: 0 },
    regras: [
      {
        id: 'sem-resposta', titulo: 'Falaram e ninguém respondeu', emoji: '🔴', estoque: 23,
        acao: 'Responder no chat do CRM.',
        estoquePorDono: { 'u-ped': 21, 'u-den': 2 },
        novos: [
          { donoId: 'u-den', donoNome: 'Denilson Silva', contato: 'Bruce Wilker', detalhe: '"me chama amanhã"', idadeHoras: 21 },
          { donoId: 'u-ped', donoNome: 'Pedro Sellan', contato: 'Rose Meire', detalhe: '"os valores?"', idadeHoras: 19 },
        ],
      },
      {
        id: 'contradicao', titulo: 'Marcou realizada, não escreveu desfecho', emoji: '⚡', sigiloso: true,
        estoque: 1, estoquePorDono: { 'u-ped': 1 },
        novos: [{ donoId: 'u-ped', donoNome: 'Pedro Sellan', contato: 'Alice', detalhe: 'sem nota', idadeHoras: 30 }],
      },
    ],
  };

  it('o gestor vê o que é dele E o que a equipe tem em aberto', () => {
    const t = formatarParaColaborador(diario, 'u-den', { ehGestor: true })!;
    expect(t).toContain('Bruce Wilker'); // o dele, nas prioridades
    expect(t).toContain('Sua equipe');
    expect(t).toContain('Pedro Sellan · <b>Rose Meire</b>');
    expect(t).toContain('Em aberto com Pedro Sellan');
    expect(t).toContain('Falaram e ninguém respondeu: 21');
  });

  it('🔒 nem o gestor recebe a contradição — ela é só da dona', () => {
    const t = formatarParaColaborador(diario, 'u-den', { ehGestor: true })!;
    expect(t).not.toContain('Alice');
    expect(t).not.toContain('Marcou realizada');
    expect(formatarDiario(diario, true)).toContain('Alice');
  });

  it('quem NÃO é gestor continua vendo só o próprio trabalho', () => {
    const t = formatarParaColaborador(diario, 'u-ped')!;
    expect(t).not.toContain('Sua equipe');
    expect(t).not.toContain('Bruce Wilker');
    expect(t).not.toContain('Em aberto com');
  });

  it('gestor sem nada seu, mas com equipe devendo, ainda recebe o relatório', () => {
    const soDaEquipe: Diario = {
      ...diario,
      regras: [{
        id: 'sem-resposta', titulo: 'Falaram e ninguém respondeu', emoji: '🔴', estoque: 21,
        estoquePorDono: { 'u-ped': 21 },
        novos: [{ donoId: 'u-ped', donoNome: 'Pedro Sellan', contato: 'Rose Meire', detalhe: '"?"', idadeHoras: 19 }],
      }],
    };
    const t = formatarParaColaborador(soDaEquipe, 'u-den', { ehGestor: true });
    expect(t).not.toBeNull();
    expect(t!).toContain('Sua equipe');
  });
});
