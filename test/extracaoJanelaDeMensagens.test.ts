/**
 * A EXTRAÇÃO LIA AS MENSAGENS MAIS ANTIGAS DA CONVERSA (09/2026).
 *
 * `runDomainExtraction` buscava com `.order('created_at', {ascending: true}).limit(N)` — ou seja,
 * as N mensagens MAIS ANTIGAS. Numa conversa que passa de N, tudo que o lead respondeu depois
 * simplesmente não existe para a extração: a Ana arranca o dado, o lead responde, e o card continua
 * sem ele. É o mesmo sintoma do caso Bruce Mendes (27/08), por outra causa — lá a extração morria
 * sem `await`, aqui ela roda e lê o pedaço errado da conversa.
 *
 * Medido em produção antes do conserto: **48,5% das conversas (33 de 68) passavam de 30 mensagens**,
 * e a maior tinha 388. Em quase metade da base a extração estava cega para o fim da conversa —
 * justamente onde estão as respostas de qualificação que decidem o tier e, agora, o gate de
 * agendamento.
 *
 * Duas decisões deste conserto:
 *  1. Buscar as ÚLTIMAS N (desc no banco) e devolver em ordem CRONOLÓGICA para o modelo. Quando
 *     estoura, o começo já foi extraído em turnos anteriores e `apply()` preserva o que já era
 *     conhecido (só sobrescreve com valor novo não-vazio) — o que falta é sempre o recente.
 *  2. N = 120, não 30. Com 120, 66 das 68 conversas cabem INTEIRAS (97%); subir para 200 não
 *     ganharia nada (as duas que sobram têm ~200 e 388). Mensagem de WhatsApp aqui tem 83
 *     caracteres em média, então 120 delas são ~10 mil caracteres — barato para uma extração.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ANA_SDR_BOARD_ID } from '@/lib/config/boards';

const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, generateText: generateTextMock };
});

vi.mock('@/lib/ai/config', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, getModel: vi.fn(() => ({ id: 'fake-model' })) };
});

import { runDomainExtraction } from '@/lib/ai/extraction/domain-extraction.service';

/** Conversa com `total` mensagens: a ÚLTIMA carrega o dado que só aparece no fim. */
function conversaLonga(total: number) {
  const msgs = Array.from({ length: total }, (_, i) => ({
    direction: i % 2 === 0 ? 'outbound' : 'inbound',
    content: { text: i === total - 1 ? 'RESPOSTA_FINAL: somos 3 vidas' : `mensagem ${i}` },
    created_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
  }));
  return msgs;
}

/** Supabase de mentira que HONRA order+limit, como o banco faria. */
function fakeSupabase(todas: ReturnType<typeof conversaLonga>) {
  const pedido: { ascending?: boolean; limit?: number } = {};
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.insert = () => Promise.resolve({ error: null });
  builder.update = () => ({ eq: () => Promise.resolve({ error: null }) });
  builder.single = () => Promise.resolve({ data: { custom_fields: {}, tags: [] }, error: null });
  builder.maybeSingle = () => Promise.resolve({ data: { custom_fields: {}, tags: [] }, error: null });
  builder.order = (_col: string, opts: { ascending: boolean }) => {
    pedido.ascending = opts.ascending;
    return builder;
  };
  builder.limit = (n: number) => {
    pedido.limit = n;
    const ordenadas = pedido.ascending ? todas : [...todas].reverse();
    return Promise.resolve({ data: ordenadas.slice(0, n), error: null });
  };
  return { client: { from: () => builder } as never, pedido };
}

/** O texto da conversa que foi montado e entregue ao modelo. */
function promptEntregue(): string {
  const call = generateTextMock.mock.calls.at(-1)?.[0] as { prompt: string } | undefined;
  return call?.prompt ?? '';
}

beforeEach(() => {
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({
    experimental_output: {
      tem_cnpj: 'desconhecido', vidas: null, idades: [], tem_plano_atual: 'desconhecido',
      operadora: null, valor_pago_exato: null, coparticipacao: 'desconhecido',
      hospital_preferencia: null, cidade_uf: null, reuniao_preferencia: null,
      algo_a_destacar: null, objecoes: [], quer_so_cotacao: false,
    },
    usage: { totalTokens: 10 },
  });
});

const params = (supabase: never) => ({
  supabase,
  dealId: 'deal-1',
  conversationId: 'conv-1',
  organizationId: 'org-1',
  boardId: ANA_SDR_BOARD_ID,
  aiConfig: { provider: 'google' as const, apiKey: 'k', model: 'm', structuredApiKey: 'k', structuredModel: 'm' },
  dryRun: true,
});

describe('janela de mensagens da extração', () => {
  it('🔴 numa conversa longa, a resposta do FIM chega ao modelo', async () => {
    const { client } = fakeSupabase(conversaLonga(200));
    await runDomainExtraction(params(client));
    expect(promptEntregue()).toContain('RESPOSTA_FINAL: somos 3 vidas');
  });

  it('pede as ÚLTIMAS mensagens ao banco, não as primeiras', async () => {
    const { client, pedido } = fakeSupabase(conversaLonga(200));
    await runDomainExtraction(params(client));
    expect(pedido.ascending).toBe(false);
  });

  it('entrega ao modelo em ordem CRONOLÓGICA, não invertida', async () => {
    const { client } = fakeSupabase(conversaLonga(10));
    await runDomainExtraction(params(client));
    const texto = promptEntregue();
    expect(texto.indexOf('mensagem 1')).toBeLessThan(texto.indexOf('mensagem 8'));
  });

  it('conversa curta continua chegando inteira', async () => {
    const { client } = fakeSupabase(conversaLonga(10));
    await runDomainExtraction(params(client));
    const texto = promptEntregue();
    for (let i = 0; i < 9; i++) expect(texto).toContain(`mensagem ${i}`);
  });

  it('a janela cobre as conversas reais: 120, medido em produção', async () => {
    const { client, pedido } = fakeSupabase(conversaLonga(500));
    await runDomainExtraction(params(client));
    expect(pedido.limit).toBe(120);
  });
});

/**
 * Trava de fonte: o mesmo defeito existia em DOIS lugares e ninguém tinha percebido.
 *
 * Ler `messaging_messages` com `ascending: true` + `limit` significa "as N mais ANTIGAS", que quase
 * nunca é o que se quer de uma conversa viva — e o erro é invisível em conversa curta, que é como
 * todo mundo testa. Se um terceiro consumidor nascer com o padrão, este teste quebra.
 *
 * Sem limite, `ascending: true` é legítimo (aí a conversa inteira vem mesmo).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('nenhum consumidor lê as mensagens MAIS ANTIGAS da conversa', () => {
  const arquivos = [
    'lib/ai/extraction/domain-extraction.service.ts',
    'lib/ai/briefing/briefing.service.ts',
    'lib/ai/agent/context-builder.ts',
    'lib/ai/agent/agent.service.ts',
  ];

  for (const rel of arquivos) {
    it(`${rel} não combina ascending:true com limit em messaging_messages`, () => {
      const fonte = readFileSync(join(process.cwd(), rel), 'utf8');
      // Um bloco de query = do .from('messaging_messages') até o próximo ';'
      const blocos = [...fonte.matchAll(/from\('messaging_messages'\)[\s\S]*?;/g)].map((m) => m[0]);
      const ruins = blocos.filter(
        (b) => /ascending:\s*true/.test(b) && /\.limit\(/.test(b),
      );
      expect(
        ruins,
        'ascending:true + limit = as mensagens MAIS ANTIGAS. Numa conversa longa isso esconde '
          + 'tudo que o lead respondeu depois. Busque desc e reverta para ordem cronológica.',
      ).toEqual([]);
    });
  }
});
