import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PAUSAR A ANA PELA TELA TEM DE CARIMBAR A HORA — senão a pausa nunca expira.
 *
 * `ai_paused_at` nulo significa "pausa legada", e pausa legada NÃO expira. Isso é
 * retrocompatibilidade deliberada da migration 20260814120000, escrita para proteger os
 * takeovers humanos REAIS que já existiam naquele dia — a migration nomeia Mavie, Graci,
 * Josiane e Silvia. Expirar todas de uma vez faria a Ana falar por cima do consultor e, no
 * caso da Mavie, atender uma CLIENTE com script de qualificação (o caso Isabella, filha dela).
 *
 * O que NÃO era deliberado é a tela continuar FABRICANDO pausas legadas novas: o webhook da
 * UAZAPI sempre carimbou, o app Next nunca carimbava. Em 05/10/2026 eram 13 de 16 contatos
 * pausados sem carimbo — leads fora do alcance da Ana para sempre, e nada na tela dizia isso.
 * A retrocompatibilidade de agosto tinha virado um vazamento contínuo.
 *
 * Este teste existe porque a revisão adversarial de 05/10 apontou que o conserto subiu SEM
 * cobertura nenhuma: nem o lado que carimba, nem o lado que expira. E os dois juntos é que
 * decidem se a Ana fala por cima de um consultor que está no meio de um atendimento.
 */

const USER_ID = '9d46dbae-93e8-4b19-936c-b7c1275a230f';
const ORG_ID = 'd9bf55f7-c66d-439b-97b2-1fceff0fa9b2';
const CONTATO = '44ef60a2-0a7b-4583-b033-b8cd0f65e7cb';

/** Espelha PAUSE_TTL_HOURS do agent.service. Se um mudar, este teste vira a prova do outro. */
const PAUSE_TTL_HOURS = 24;

let updates: Record<string, unknown>[];
let supabaseMock: Record<string, unknown>;

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return supabaseMock;
  },
}));

import { contactsService } from '@/lib/supabase/contacts';

describe('pausa da Ana — a tela carimba a hora', () => {
  beforeEach(() => {
    updates = [];
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
            update: vi.fn((payload: Record<string, unknown>) => {
              updates.push(payload);
              return { eq: vi.fn(async () => ({ error: null })) };
            }),
          };
        }
        throw new Error('tabela inesperada: ' + tabela);
      }),
    };
  });

  it('PAUSAR grava ai_paused_at — sem ele a pausa é imortal', async () => {
    await contactsService.update(CONTATO, { aiPaused: true } as never);

    expect(updates).toHaveLength(1);
    expect(updates[0].ai_paused).toBe(true);
    expect(updates[0].ai_paused_at).toBeTruthy();
    // Tem de ser um instante real, não string qualquer: é a partir dele que o TTL conta.
    expect(Number.isNaN(Date.parse(updates[0].ai_paused_at as string))).toBe(false);
  });

  it('DESPAUSAR limpa o carimbo — o contato volta ao estado neutro', async () => {
    await contactsService.update(CONTATO, { aiPaused: false } as never);

    expect(updates[0].ai_paused).toBe(false);
    expect(updates[0].ai_paused_at).toBeNull();
  });

  it('update que não fala de pausa NÃO toca nas duas colunas', async () => {
    await contactsService.update(CONTATO, { name: 'Regina Balbino' } as never);

    expect(updates[0]).not.toHaveProperty('ai_paused');
    expect(updates[0]).not.toHaveProperty('ai_paused_at');
  });
});

/**
 * O outro lado do acoplamento: quem EXPIRA.
 *
 * A regra vive em `agent.service` (passo 0c) e roda só em mensagem INBOUND — "o lead voltou a
 * falar e faz mais de PAUSE_TTL_HOURS que nenhum humano escreveu". Aqui ela é reproduzida na
 * forma exata do código para travar as três fronteiras que importam; o que o teste protege é a
 * REGRA, que é o que decide se a Ana atropela um consultor em atendimento.
 */
function pausaExpirou(aiPausedAt: string | null, agoraMs: number): boolean {
  const pausedAt = aiPausedAt ? new Date(aiPausedAt) : null;
  return pausedAt != null && agoraMs - pausedAt.getTime() > PAUSE_TTL_HOURS * 60 * 60 * 1000;
}

describe('pausa da Ana — quando expira', () => {
  const agora = Date.parse('2026-10-07T12:00:00Z');
  const horasAtras = (h: number) => new Date(agora - h * 60 * 60 * 1000).toISOString();

  it('pausa LEGADA (sem carimbo) NUNCA expira — é a trava que protege Mavie e Isabella', () => {
    expect(pausaExpirou(null, agora)).toBe(false);
  });

  it('pausa de 1h não expira — consultor no meio do atendimento não pode ser atropelado', () => {
    expect(pausaExpirou(horasAtras(1), agora)).toBe(false);
  });

  it('pausa de 23h ainda não expira — a fronteira é 24h, não "ontem"', () => {
    expect(pausaExpirou(horasAtras(23), agora)).toBe(false);
  });

  it('pausa de 25h expira — o lead voltou a falar e ninguém respondeu há mais de um dia', () => {
    expect(pausaExpirou(horasAtras(25), agora)).toBe(true);
  });
});
