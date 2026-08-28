/**
 * Som de mensagem nova (pedido do Denilson, 28/08/2026).
 *
 * O badge de nao-lida ja existe desde 27/08, mas e SILENCIOSO: quem esta com o CRM aberto em
 * outra aba nao percebe o cliente respondendo. Aqui mora a decisao de tocar e o tocador em si.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ehMensagemNovaDoCliente,
  somEstaLigado,
  definirSom,
  criarTocador,
  CHAVE_SOM_MENSAGEM,
} from '@/lib/notifications/somMensagemNova';

const inbound = (over: Record<string, unknown> = {}) => ({
  eventType: 'INSERT',
  table: 'messaging_messages',
  new: { direction: 'inbound', conversation_id: 'cv1', ...over },
});

describe('ehMensagemNovaDoCliente', () => {
  it('INSERT de mensagem inbound => toca', () => {
    expect(ehMensagemNovaDoCliente(inbound())).toBe(true);
  });

  it('mensagem NOSSA (outbound) nao toca — senao a Ana faz barulho sozinha', () => {
    expect(ehMensagemNovaDoCliente(inbound({ direction: 'outbound' }))).toBe(false);
  });

  it('UPDATE nao toca — recibo de entrega/leitura nao e mensagem nova', () => {
    expect(ehMensagemNovaDoCliente({ ...inbound(), eventType: 'UPDATE' })).toBe(false);
  });

  it('mudanca em outra tabela nao toca', () => {
    expect(ehMensagemNovaDoCliente({ ...inbound(), table: 'messaging_conversations' })).toBe(false);
  });

  it('payload torto nao explode', () => {
    expect(ehMensagemNovaDoCliente(null)).toBe(false);
    expect(ehMensagemNovaDoCliente({})).toBe(false);
    expect(ehMensagemNovaDoCliente({ eventType: 'INSERT', table: 'messaging_messages', new: null })).toBe(false);
  });
});

describe('preferencia de som', () => {
  beforeEach(() => localStorage.clear());

  it('nasce LIGADO — o pedido era ouvir, nao ter que descobrir onde liga', () => {
    expect(somEstaLigado(localStorage)).toBe(true);
  });

  it('desligar persiste', () => {
    definirSom(false, localStorage);
    expect(localStorage.getItem(CHAVE_SOM_MENSAGEM)).toBe('off');
    expect(somEstaLigado(localStorage)).toBe(false);
  });

  it('religar persiste', () => {
    definirSom(false, localStorage);
    definirSom(true, localStorage);
    expect(somEstaLigado(localStorage)).toBe(true);
  });

  it('sem storage (SSR) assume ligado e nao explode', () => {
    expect(somEstaLigado(null)).toBe(true);
    expect(() => definirSom(false, null)).not.toThrow();
  });

  it('storage que joga (modo privado) nao derruba a tela', () => {
    const quebrado = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
    } as unknown as Storage;
    expect(somEstaLigado(quebrado)).toBe(true);
    expect(() => definirSom(false, quebrado)).not.toThrow();
  });
});

/** AudioContext de mentira: registra o que foi agendado sem fazer barulho. */
function contextoFake(over: Partial<{ state: string; resumeJoga: boolean }> = {}) {
  const tocados: number[] = [];
  const ctx = {
    state: over.state ?? 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {
      if (over.resumeJoga) throw new Error('bloqueado pelo navegador');
      ctx.state = 'running';
    }),
    createOscillator: () => ({
      type: '', frequency: { setValueAtTime: (v: number) => tocados.push(v) },
      connect: () => {}, start: () => {}, stop: () => {},
    }),
    createGain: () => ({
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
      connect: () => {},
    }),
  };
  return { ctx, tocados };
}

describe('criarTocador', () => {
  it('toca e devolve true quando o contexto esta rodando', async () => {
    const { ctx, tocados } = contextoFake();
    const tocador = criarTocador({ criarContexto: () => ctx as never });
    expect(await tocador.tocar()).toBe(true);
    expect(tocados.length).toBeGreaterThan(0);
  });

  it('reaproveita o MESMO contexto entre toques (navegador limita quantos existem)', async () => {
    const { ctx } = contextoFake();
    const criarContexto = vi.fn(() => ctx as never);
    const tocador = criarTocador({ criarContexto });
    await tocador.tocar();
    await tocador.tocar();
    expect(criarContexto).toHaveBeenCalledTimes(1);
  });

  it('contexto suspenso (autoplay bloqueado) tenta resume antes de tocar', async () => {
    const { ctx, tocados } = contextoFake({ state: 'suspended' });
    const tocador = criarTocador({ criarContexto: () => ctx as never });
    expect(await tocador.tocar()).toBe(true);
    expect(ctx.resume).toHaveBeenCalled();
    expect(tocados.length).toBeGreaterThan(0);
  });

  it('navegador que recusa o resume devolve false, sem jogar', async () => {
    const { ctx } = contextoFake({ state: 'suspended', resumeJoga: true });
    const tocador = criarTocador({ criarContexto: () => ctx as never });
    await expect(tocador.tocar()).resolves.toBe(false);
  });

  it('ambiente sem AudioContext devolve false, sem jogar', async () => {
    const tocador = criarTocador({ criarContexto: () => null });
    await expect(tocador.tocar()).resolves.toBe(false);
  });
});
