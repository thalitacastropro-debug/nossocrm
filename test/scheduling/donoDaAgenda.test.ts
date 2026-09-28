import { describe, it, expect } from 'vitest';
import { donoDaAgenda } from '@/lib/ai/scheduling/dono-da-agenda';

/**
 * DE QUEM É A AGENDA (21/09/2026, caso Camila Santos).
 *
 * O card era do Pedro e o resgate oferecia os horários livres do Denilson — o consultor fixo da
 * board. Esta função é o único lugar que decide isso, justamente para as duas pontas (a oferta,
 * na rota de no-show, e a marcação, no agent.service) nunca discordarem.
 */

const PEDRO = '9d46dbae-93e8-4b19-936c-b7c1275a230f';
const DENILSON = '02e8bf43-feda-4a79-b166-93735849e4b8';

describe('donoDaAgenda', () => {
  it('dono do card VENCE o consultor da board — era esse o bug', () => {
    expect(donoDaAgenda({ owner_id: PEDRO }, DENILSON)).toBe(PEDRO);
  });

  it('card sem dono cai no consultor da board', () => {
    // 12 dos 16 cards abertos do funil da Ana estavam assim em 21/09/2026 (anteriores ao
    // trigger zz_dono_padrao_lead_novo). É o caminho da MAIORIA lá, não a exceção.
    expect(donoDaAgenda({ owner_id: null }, DENILSON)).toBe(DENILSON);
    expect(donoDaAgenda({}, DENILSON)).toBe(DENILSON);
    expect(donoDaAgenda(null, DENILSON)).toBe(DENILSON);
    expect(donoDaAgenda(undefined, DENILSON)).toBe(DENILSON);
  });

  it('SELECT que esqueceu owner_id não explode — cai na rede de segurança', () => {
    // Armadilha real: o deal existe, o campo não veio. Sem esta função seria `undefined`
    // descendo até `.eq('owner_id', undefined)`.
    const dealSemOwnerNoSelect = { id: 'deal-1' } as { owner_id?: string | null };
    expect(donoDaAgenda(dealSemOwnerNoSelect, DENILSON)).toBe(DENILSON);
  });

  it('sem dono e sem consultor devolve null — nunca string vazia nem undefined', () => {
    // Quem recebe null NÃO agenda (scheduling.service devolve {kind:'none'}; a rota de no-show
    // cai no texto genérico). O que não pode é chegar null no `.eq('owner_id', ...)`: o
    // PostgREST monta `owner_id=eq.null`, que não casa com nada, e a pessoa aparece livre o
    // dia inteiro.
    expect(donoDaAgenda(null, null)).toBeNull();
    expect(donoDaAgenda({ owner_id: null }, undefined)).toBeNull();
  });

  it('string vazia não é id — não pode passar por dono', () => {
    expect(donoDaAgenda({ owner_id: '' }, DENILSON)).toBe(DENILSON);
    expect(donoDaAgenda({ owner_id: '' }, '')).toBeNull();
  });
});
