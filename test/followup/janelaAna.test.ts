import { describe, it, expect } from 'vitest';
import { anaPodeFalar, JANELA_ANA } from '@/lib/ai/followup/schedule';

/** Constrói um instante a partir do horário LOCAL de São Paulo (UTC-3). */
const local = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

/**
 * A janela de follow-up da Ana foi alargada em 09/09/2026 para 08:00–21:00, seg–sáb.
 *
 * Motivo: o 1º toque sempre foi 24/7 por decisão explícita (o Paulo recebeu o dele às 00:44), mas
 * o cron do follow-up desligava fora de 08:00–17:30 seg–sex. Numa cadência de 10 dias isso
 * diluía; na de 3 dias virava a maior parte do prazo — de sexta 17:30 a segunda 08:00 são 62h30.
 */
describe('anaPodeFalar — janela de follow-up da Ana', () => {
  it('terça às 10:00 → pode', () => {
    expect(anaPodeFalar(local('2026-09-08T10:00:00'))).toBe(true);
  });

  // O ganho principal: a noite é quando as pessoas respondem WhatsApp, e era proibida antes.
  it('terça às 20:00 → pode (era proibido antes)', () => {
    expect(anaPodeFalar(local('2026-09-08T20:00:00'))).toBe(true);
  });

  // O outro ganho: fecha o buraco de sexta à noite até segunda de manhã.
  it('sábado às 10:00 → pode (era proibido antes)', () => {
    expect(anaPodeFalar(local('2026-09-12T10:00:00'))).toBe(true);
  });

  it('domingo → não fala, em nenhuma hora', () => {
    for (const h of ['09:00', '14:00', '20:00']) {
      expect(anaPodeFalar(local(`2026-09-13T${h}:00`))).toBe(false);
    }
  });

  it('madrugada → não fala: follow-up às 3h para quem ignorou irrita e arrisca o número', () => {
    expect(anaPodeFalar(local('2026-09-08T03:00:00'))).toBe(false);
    expect(anaPodeFalar(local('2026-09-08T07:59:00'))).toBe(false);
  });

  it('bordas exatas: 08:00 e 21:00 entram, 21:01 não', () => {
    expect(anaPodeFalar(local('2026-09-08T08:00:00'))).toBe(true);
    expect(anaPodeFalar(local('2026-09-08T21:00:00'))).toBe(true);
    expect(anaPodeFalar(local('2026-09-08T21:01:00'))).toBe(false);
  });

  // O expediente humano (08:00–17:30, seg–sex) governa os avisos que caem no colo de uma PESSOA e
  // continua sendo o gate do SLA de handoff. Ele PRECISA ser subconjunto da janela da Ana: a rota
  // usa a da Ana como porteira externa, então um horário humano fora dela nunca rodaria.
  it('o expediente humano cabe inteiro dentro da janela da Ana', () => {
    expect(JANELA_ANA.inicioMin).toBeLessThanOrEqual(8 * 60);
    expect(JANELA_ANA.fimMin).toBeGreaterThanOrEqual(17 * 60 + 30);
    for (const dia of [1, 2, 3, 4, 5]) expect(JANELA_ANA.dias).toContain(dia);
  });
});
