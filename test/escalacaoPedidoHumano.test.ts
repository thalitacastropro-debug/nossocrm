/**
 * Escalação quando o lead PEDE atendimento humano.
 *
 * Caso Isabella (28/08/2026): ela escreveu "Me liguem então" → "por favor" → "ME LIGAR" em
 * caixa alta → "Aguardo ligação do DENILSON" → "Já tratado com ele". NADA disso disparou
 * escalação, porque a lista configurada no board é só
 * ["atendente","falar com humano","falar com alguém","reclamação","reclamacao"].
 * A Ana continuou perguntando se ela tinha plano de saúde.
 *
 * São DOIS pedidos diferentes, com desfechos diferentes:
 *  - "me liga"          => o lead quer o consultor  => handoff completo (MOVE o card)
 *  - "já falei com ele" => já está sendo atendido    => só PAUSA (mover sujaria o funil)
 */
import { describe, it, expect } from 'vitest';
import {
  normalizarTexto,
  detectarPedidoDeHumano,
  detectarJaAtendido,
} from '@/lib/ai/agent/escalacao';

describe('normalizarTexto', () => {
  it('tira acento e caixa — no celular ninguém acentua', () => {
    expect(normalizarTexto('Falar com ALGUÉM')).toBe('falar com alguem');
    expect(normalizarTexto('reclamação')).toBe('reclamacao');
  });
});

describe('detectarPedidoDeHumano', () => {
  const pega = (m: string) => expect(detectarPedidoDeHumano(m)).toBeTruthy();
  const naoPega = (m: string) => expect(detectarPedidoDeHumano(m)).toBeNull();

  it('as frases REAIS da Isabella', () => {
    pega('Me liguem então');
    pega('ME LIGAR');
  });

  it('as variações de "me liga" que gente usa', () => {
    ['me liga', 'me liga por favor', 'pode me ligar?', 'me ligar', 'me liguem',
     'liga pra mim', 'me telefona', 'prefiro falar por telefone',
     'quero falar por telefone'].forEach(pega);
  });

  it('pedido explícito de gente', () => {
    ['quero falar com um humano', 'falar com atendente', 'quero falar com o consultor',
     'tem alguem ai?', 'quero falar com uma pessoa'].forEach(pega);
  });

  it('NÃO confunde com outras palavras que contêm "ligar"', () => {
    naoPega('vou desligar agora');
    naoPega('preciso religar o aparelho');
    naoPega('obrigada pela atenção');
  });

  it('NÃO dispara com o lead só sendo educado', () => {
    naoPega('por favor');
    naoPega('bom dia');
    naoPega('tudo bem?');
  });

  it('respeita a lista configurada no board (soma, não substitui)', () => {
    expect(detectarPedidoDeHumano('quero abrir uma reclamação', ['reclamação'])).toBeTruthy();
    expect(detectarPedidoDeHumano('palavra qualquer', ['palavra qualquer'])).toBeTruthy();
  });

  it('lista de config torta não derruba nada', () => {
    expect(detectarPedidoDeHumano('oi', undefined)).toBeNull();
    expect(detectarPedidoDeHumano('oi', null as unknown as string[])).toBeNull();
  });
});

describe('detectarJaAtendido', () => {
  const pega = (m: string) => expect(detectarJaAtendido(m)).toBeTruthy();
  const naoPega = (m: string) => expect(detectarJaAtendido(m)).toBeNull();

  it('as frases REAIS da Isabella', () => {
    pega('Aguardo ligação do DENILSON');
    pega('Já tratado com ele');
  });

  it('outras formas de dizer "já estou sendo atendido"', () => {
    ['ja falei com o denilson', 'já estou falando com o Pedro',
     'ja resolvi com ele', 'ja conversei com a equipe de voces',
     'aguardo o retorno do consultor'].forEach(pega);
  });

  it('NÃO confunde com lead novo contando a vida dele', () => {
    naoPega('já tenho plano de saúde');
    naoPega('ja paguei muito caro nesse plano');
    naoPega('falei com minha esposa e queremos contratar');
  });

  it('quem já é atendido NÃO é pedido de consultor — são gatilhos distintos', () => {
    expect(detectarPedidoDeHumano('Já tratado com ele')).toBeNull();
  });
});

/**
 * O caminho "já atendido" PAUSA e AVISA, mas NÃO move o card.
 *
 * `handleHandoff` move o deal para o funil Comercial. Mandar para lá toda filha de cliente e
 * toda secretária que escreve "já falei com ele" transformaria o funil de vendas em depósito
 * — foi o risco levantado ao investigar o caso Isabella.
 */
import { pausarPorJaAtendido, type PausaDeps } from '@/lib/ai/agent/escalacao';
import { vi } from 'vitest';

function pausaDeps(over: Partial<PausaDeps> = {}): PausaDeps {
  return {
    marcarPausa: vi.fn(async () => {}),
    registrarNaTimeline: vi.fn(async () => {}),
    avisar: vi.fn(async () => {}),
    ...over,
  };
}

describe('pausarPorJaAtendido', () => {
  it('pausa, registra na timeline e avisa gente', async () => {
    const d = pausaDeps();
    const r = await pausarPorJaAtendido({ gatilho: 'ja tratado', contatoNome: 'Isabella', deps: d });
    expect(r.pausou).toBe(true);
    expect(d.marcarPausa).toHaveBeenCalled();
    expect(d.registrarNaTimeline).toHaveBeenCalled();
    expect(d.avisar).toHaveBeenCalled();
  });

  it('o texto do aviso diz quem é e o que a pessoa falou', async () => {
    const avisar = vi.fn(async () => {});
    await pausarPorJaAtendido({ gatilho: 'ja tratado', contatoNome: 'Isabella', deps: pausaDeps({ avisar }) });
    const texto = avisar.mock.calls[0][0] as string;
    expect(texto).toContain('Isabella');
    expect(texto).toContain('ja tratado');
  });

  it('aviso que falha NÃO impede a pausa — pausar é o que protege o lead', async () => {
    const marcarPausa = vi.fn(async () => {});
    const r = await pausarPorJaAtendido({
      gatilho: 'ja falei com', contatoNome: null,
      deps: pausaDeps({ marcarPausa, avisar: vi.fn(async () => { throw new Error('telegram fora'); }) }),
    });
    expect(marcarPausa).toHaveBeenCalled();
    expect(r.pausou).toBe(true);
  });

  it('se a PAUSA falha, devolve pausou=false — quem chama precisa saber', async () => {
    const r = await pausarPorJaAtendido({
      gatilho: 'x', contatoNome: null,
      deps: pausaDeps({ marcarPausa: vi.fn(async () => { throw new Error('banco fora'); }) }),
    });
    expect(r.pausou).toBe(false);
  });

  it('sem nome de contato não quebra', async () => {
    const avisar = vi.fn(async () => {});
    await pausarPorJaAtendido({ gatilho: 'x', contatoNome: null, deps: pausaDeps({ avisar }) });
    expect(avisar).toHaveBeenCalled();
  });
});
