import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Nova tentativa do 1º toque que falhou (09/10/2026). Caso que abriu: giani e Flávia Muniz
 * entraram com o WhatsApp fora (06–08/10) e nunca receberam nada — a rota tentava uma vez só.
 * Caso que fixou o limite: Igor Moraes, número sem WhatsApp, 291 envios falhados.
 */

const mocks = vi.hoisted(() => ({
  jaHouveContato: vi.fn(async () => false),
  mergeDealFirstTouch: vi.fn(async () => undefined),
}));

vi.mock('@/lib/ai/lead-intake/envio-primeiro-toque', async () => {
  const real = await vi.importActual<typeof import('@/lib/ai/lead-intake/envio-primeiro-toque')>(
    '@/lib/ai/lead-intake/envio-primeiro-toque',
  );
  return { ...real, jaHouveContato: mocks.jaHouveContato, mergeDealFirstTouch: mocks.mergeDealFirstTouch };
});

import { retentarPrimeirosToques } from '@/lib/ai/lead-intake/retentar-primeiro-toque';
import { MAX_TENTATIVAS_PRIMEIRO_TOQUE } from '@/lib/ai/lead-intake/envio-primeiro-toque';

const AGORA = new Date('2026-10-09T13:00:00Z');

/** Cadeia de query que aceita qualquer filtro e resolve no `.limit()`/`.maybeSingle()`. */
function consulta(resultado: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'not', 'gte', 'order']) q[m] = vi.fn(() => q);
  q.limit = vi.fn(() => Object.assign(Promise.resolve({ data: resultado }), q));
  q.maybeSingle = vi.fn(async () => ({ data: Array.isArray(resultado) ? resultado[0] ?? null : resultado }));
  return q;
}

function deal(id: string, firstTouch: Record<string, unknown>) {
  return {
    id,
    organization_id: 'org',
    board_id: 'board-sdr',
    contact_id: `contato-${id}`,
    created_at: '2026-10-08T10:00:00Z',
    custom_fields: { lead_form: { mapped: { name: 'giani' }, first_touch: firstTouch } },
  };
}

function supabaseCom(deals: unknown[]) {
  return {
    from: vi.fn((t: string) => {
      if (t === 'deals') return consulta(deals);
      if (t === 'messaging_conversations') {
        return consulta({ id: 'conv', channel_id: 'canal', external_contact_id: '+5511999990000' });
      }
      if (t === 'contacts') return consulta({ name: 'giani' });
      throw new Error('tabela inesperada ' + t);
    }),
  } as never;
}

const falhou = (extra: Record<string, unknown> = {}) => ({
  status: 'failed',
  error: 'UazAPI 503: WhatsApp disconnected',
  tentativas: 1,
  ultima_tentativa_em: '2026-10-09T12:00:00Z',
  ...extra,
});

/** O último first_touch gravado para um card. */
const gravado = (dealId: string) => {
  const chamadas = mocks.mergeDealFirstTouch.mock.calls.filter((c) => c[1] === dealId);
  return chamadas[chamadas.length - 1]?.[2] as Record<string, unknown> | undefined;
};

describe('retentarPrimeirosToques', () => {
  const montarBolhas = vi.fn(async () => ['Oi giani, tudo bem? Aqui é a Ana, da Niva.']);
  const enviar = vi.fn();
  const avisar = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jaHouveContato.mockResolvedValue(false);
    enviar.mockResolvedValue({ success: true, messageId: 'msg-1' });
  });

  it('o canal voltou: manda a apresentação e grava greeted com sent_at = agora (âncora da cadência)', async () => {
    const res = await retentarPrimeirosToques({
      supabase: supabaseCom([deal('d1', falhou())]), now: AGORA, montarBolhas, enviar, avisar,
    });
    expect(res.enviados).toBe(1);
    expect(enviar).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv', to: '+5511999990000' }));
    expect(gravado('d1')).toMatchObject({ status: 'greeted', sent_at: AGORA.toISOString(), tentativas: 2, error: null });
  });

  it('alguém já conversou (lead escreveu ou o consultor mandou): NÃO manda, marca superado', async () => {
    mocks.jaHouveContato.mockResolvedValue(true);
    const res = await retentarPrimeirosToques({
      supabase: supabaseCom([deal('d1', falhou())]), now: AGORA, montarBolhas, enviar, avisar,
    });
    expect(res.superados).toBe(1);
    expect(enviar).not.toHaveBeenCalled();
    expect(gravado('d1')).toMatchObject({ status: 'superado' });
  });

  it('canal ainda fora: conta a tentativa e PARA a rodada (não insiste nos outros)', async () => {
    enviar.mockResolvedValue({ success: false, error: { code: 'X', message: 'UazAPI 503: WhatsApp disconnected' } });
    const res = await retentarPrimeirosToques({
      supabase: supabaseCom([deal('d1', falhou()), deal('d2', falhou())]), now: AGORA, montarBolhas, enviar, avisar,
    });
    expect(res.falharam).toBe(1);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(gravado('d1')).toMatchObject({ status: 'failed', tentativas: 2 });
    expect(gravado('d2')).toBeUndefined();
  });

  it('número sem WhatsApp: desiste na hora e avisa o time para LIGAR (caso Igor, 291 falhas)', async () => {
    const igor = falhou({ error: 'UazAPI 500: the number 5511996142665@s.whatsapp.net is not on WhatsApp' });
    const res = await retentarPrimeirosToques({
      supabase: supabaseCom([deal('d1', igor)]), now: AGORA, montarBolhas, enviar, avisar,
    });
    expect(res.desistiu).toBe(1);
    expect(enviar).not.toHaveBeenCalled();
    expect(gravado('d1')).toMatchObject({ status: 'desistiu' });
    expect(avisar).toHaveBeenCalledWith(expect.objectContaining({ dealId: 'd1', motivo: 'o número não tem WhatsApp' }));
  });

  it('número sem WhatsApp descoberto NO envio: desiste e segue para o próximo (não é o canal)', async () => {
    enviar
      .mockResolvedValueOnce({ success: false, error: { code: 'X', message: 'the number x@s.whatsapp.net is not on WhatsApp' } })
      .mockResolvedValueOnce({ success: true, messageId: 'm2' });
    const res = await retentarPrimeirosToques({
      supabase: supabaseCom([deal('d1', falhou()), deal('d2', falhou())]), now: AGORA, montarBolhas, enviar, avisar,
    });
    expect(res.desistiu).toBe(1);
    expect(res.enviados).toBe(1);
  });

  it(`tentativas esgotadas (${MAX_TENTATIVAS_PRIMEIRO_TOQUE}): desiste e avisa, sem novo envio`, async () => {
    const res = await retentarPrimeirosToques({
      supabase: supabaseCom([deal('d1', falhou({ tentativas: MAX_TENTATIVAS_PRIMEIRO_TOQUE }))]),
      now: AGORA, montarBolhas, enviar, avisar,
    });
    expect(res.desistiu).toBe(1);
    expect(enviar).not.toHaveBeenCalled();
    expect(avisar).toHaveBeenCalledOnce();
  });

  it('tentou há menos de 10 min: espera a próxima rodada', async () => {
    const recente = falhou({ ultima_tentativa_em: new Date(AGORA.getTime() - 5 * 60 * 1000).toISOString() });
    const res = await retentarPrimeirosToques({
      supabase: supabaseCom([deal('d1', recente)]), now: AGORA, montarBolhas, enviar, avisar,
    });
    expect(res.pulados).toBe(1);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('no máximo 2 envios por rodada (o cron tem 60s e cada apresentação leva segundos)', async () => {
    const res = await retentarPrimeirosToques({
      supabase: supabaseCom([deal('d1', falhou()), deal('d2', falhou()), deal('d3', falhou())]),
      now: AGORA, montarBolhas, enviar, avisar,
    });
    expect(res.enviados).toBe(2);
    expect(res.pulados).toBe(1);
  });
});
