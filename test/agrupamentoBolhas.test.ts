/**
 * Agrupamento de bolhas — conserta a CORRIDA DE TURNOS.
 *
 * Caso Isabella (28/08/2026): entre 19:56:32 e 19:57:02 saíram 8 bolhas da Ana vindas de
 * pelo menos 4 turnos EM PARALELO. Cada bolha que a pessoa mandava disparava um turno novo
 * que montava o contexto do zero e não sabia dos outros — por isso "você tem plano de saúde
 * hoje?" apareceu 5 vezes. Não era a persona insistindo: eram 4 Anas ao mesmo tempo.
 *
 * Atinge lead PAGO igual: qualquer pessoa que mande 3 mensagens seguidas dispara o mesmo.
 *
 * Regra: cada turno espera uma janela curta e, ao acordar, cede a vez se já existe mensagem
 * do lead mais nova que a dele. Sobra UM turno — o do último balão — que responde vendo tudo.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  aguardarBolhas,
  JANELA_AGRUPAMENTO_MS,
  bolhaMaisNovaChegou,
  type AgrupamentoDeps,
} from '@/lib/ai/agent/agrupamento';

function deps(over: Partial<AgrupamentoDeps> = {}): AgrupamentoDeps {
  return {
    esperar: vi.fn(async () => {}),
    ultimaInbound: vi.fn(async () => ({ id: 'm1' })),
    ...over,
  };
}

describe('aguardarBolhas', () => {
  it('sozinha na conversa: espera a janela e RESPONDE', async () => {
    const d = deps({ ultimaInbound: vi.fn(async () => ({ id: 'm1' })) });
    const r = await aguardarBolhas({ messageId: 'm1', deps: d });
    expect(r.cedeu).toBe(false);
    expect(d.esperar).toHaveBeenCalledWith(JANELA_AGRUPAMENTO_MS);
  });

  it('chegou bolha mais nova durante a espera: CEDE a vez', async () => {
    const d = deps({ ultimaInbound: vi.fn(async () => ({ id: 'm2' })) });
    const r = await aguardarBolhas({ messageId: 'm1', deps: d });
    expect(r.cedeu).toBe(true);
    expect(r.motivo).toMatch(/mais nova/i);
  });

  it('espera ANTES de consultar — consultar antes não agruparia nada', async () => {
    const ordem: string[] = [];
    const d = deps({
      esperar: vi.fn(async () => { ordem.push('esperou'); }),
      ultimaInbound: vi.fn(async () => { ordem.push('consultou'); return { id: 'm1' }; }),
    });
    await aguardarBolhas({ messageId: 'm1', deps: d });
    expect(ordem).toEqual(['esperou', 'consultou']);
  });

  it('sem messageId não dá pra comparar: responde SEM atrasar', async () => {
    const d = deps();
    const r = await aguardarBolhas({ messageId: undefined, deps: d });
    expect(r.cedeu).toBe(false);
    expect(d.esperar).not.toHaveBeenCalled();
  });

  it('consulta falhou: responde (atrasado é melhor que mudo)', async () => {
    const d = deps({ ultimaInbound: vi.fn(async () => { throw new Error('banco fora'); }) });
    const r = await aguardarBolhas({ messageId: 'm1', deps: d });
    expect(r.cedeu).toBe(false);
  });

  it('conversa sem inbound (não deveria acontecer): responde', async () => {
    const d = deps({ ultimaInbound: vi.fn(async () => null) });
    expect((await aguardarBolhas({ messageId: 'm1', deps: d })).cedeu).toBe(false);
  });

  it('janela é configurável (etapa pode querer outra)', async () => {
    const d = deps();
    await aguardarBolhas({ messageId: 'm1', deps: { ...d, janelaMs: 3000 } });
    expect(d.esperar).toHaveBeenCalledWith(3000);
  });

  it('janela 0 desliga o agrupamento sem quebrar', async () => {
    const d = deps({ ultimaInbound: vi.fn(async () => ({ id: 'm2' })) });
    const r = await aguardarBolhas({ messageId: 'm1', deps: { ...d, janelaMs: 0 } });
    expect(r.cedeu).toBe(false);
    expect(d.esperar).not.toHaveBeenCalled();
  });

  it('rajada de 4 bolhas: só a última responde', async () => {
    const bolhas = ['m1', 'm2', 'm3', 'm4'];
    const d = deps({ ultimaInbound: vi.fn(async () => ({ id: 'm4' })) });
    const rs = await Promise.all(
      bolhas.map((id) => aguardarBolhas({ messageId: id, deps: d }))
    );
    expect(rs.filter((r) => !r.cedeu)).toHaveLength(1);
    expect(rs[3].cedeu).toBe(false);
  });
});

/**
 * SEGUNDA CHECAGEM, logo antes de enviar.
 *
 * A Ana gasta ~3,4s pensando (mediana medida em 103 respostas). Esse tempo é de graça: se
 * uma bolha nova chegar enquanto ela gera, dá para descobrir e engolir a resposta ANTES de
 * mandar. Isso amplia a janela efetiva sem cobrar mais nada do lead em espera — é o que
 * permite usar 5s de espera com a mesma cobertura de 8s.
 */
describe('bolhaMaisNovaChegou (checagem sem espera)', () => {
  it('mesma mensagem: pode enviar', async () => {
    const r = await bolhaMaisNovaChegou({
      messageId: 'm1',
      ultimaInbound: async () => ({ id: 'm1' }),
    });
    expect(r).toBe(false);
  });

  it('chegou bolha nova durante a geração: NÃO envia', async () => {
    const r = await bolhaMaisNovaChegou({
      messageId: 'm1',
      ultimaInbound: async () => ({ id: 'm2' }),
    });
    expect(r).toBe(true);
  });

  it('não espera — é a checagem de graça', async () => {
    const t0 = Date.now();
    await bolhaMaisNovaChegou({ messageId: 'm1', ultimaInbound: async () => ({ id: 'm1' }) });
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('sem messageId: envia (não dá pra comparar)', async () => {
    expect(await bolhaMaisNovaChegou({
      messageId: undefined,
      ultimaInbound: async () => ({ id: 'm2' }),
    })).toBe(false);
  });

  it('consulta falhou: envia (mudo é pior que atropelado)', async () => {
    expect(await bolhaMaisNovaChegou({
      messageId: 'm1',
      ultimaInbound: async () => { throw new Error('banco fora'); },
    })).toBe(false);
  });

  it('conversa sem inbound: envia', async () => {
    expect(await bolhaMaisNovaChegou({
      messageId: 'm1',
      ultimaInbound: async () => null,
    })).toBe(false);
  });
});

describe('janela padrão', () => {
  it('é 5s — a espera curta que, somada aos ~3,4s de geração, cobre o mesmo que 8s', () => {
    expect(JANELA_AGRUPAMENTO_MS).toBe(5_000);
  });
});
