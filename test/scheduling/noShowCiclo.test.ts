import { describe, it, expect } from 'vitest';
import { emCicloDeResgate } from '@/lib/ai/scheduling/no-show-ciclo';

/**
 * O CICLO DE RESGATE SE FECHA (21/09/2026).
 *
 * Nem `no_show` nem `handoff_consultor` são limpos algum dia — o painel conta no-show por período,
 * e o carimbo de handoff é a trava do `is_lost` na extração. Então quem precisa saber "em que pé
 * está o card" tem que olhar a ORDEM dos fatos. Mesma lição que já estava em
 * `lib/ai/followup/meeting-reminder.ts`: "NUNCA `no_show === true` flat".
 */

const NO_SHOW = '2026-09-21T18:47:00.000Z';
const ANTES = '2026-09-20T13:48:39.742Z';
const DEPOIS = '2026-09-23T10:00:00.000Z';

describe('emCicloDeResgate', () => {
  it('card que nunca levou no-show não está em resgate', () => {
    expect(emCicloDeResgate({})).toBe(false);
    expect(emCicloDeResgate(null)).toBe(false);
    expect(emCicloDeResgate(undefined)).toBe(false);
    expect(emCicloDeResgate({ handoff_consultor: { at: ANTES } })).toBe(false);
  });

  it('no-show DEPOIS do handoff: ciclo ABERTO — o handoff pode mover de novo', () => {
    // É o caso da Camila Santos: handoff em 20/09, no-show em 21/09.
    expect(emCicloDeResgate({ no_show: true, no_show_at: NO_SHOW, handoff_consultor: { at: ANTES } })).toBe(true);
  });

  it('handoff DEPOIS do no-show: ciclo FECHADO — o card já voltou pro consultor', () => {
    expect(emCicloDeResgate({ no_show: true, no_show_at: NO_SHOW, handoff_consultor: { at: DEPOIS } })).toBe(false);
  });

  it('escalação também fecha o ciclo — ela é uma saída pro consultor', () => {
    expect(emCicloDeResgate({ no_show_at: NO_SHOW, escalated_consultor: { at: DEPOIS } })).toBe(false);
    expect(emCicloDeResgate({ no_show_at: NO_SHOW, escalated_consultor: { at: ANTES } })).toBe(true);
  });

  it('resgatado e nunca entregue de volta: ciclo segue aberto', () => {
    // Lead que não respondeu o resgate. O card fica na Ana; um novo no-show não faz sentido
    // (o botão nem aparece no funil dela).
    expect(emCicloDeResgate({ no_show: true, no_show_at: NO_SHOW })).toBe(true);
  });

  it('flag `no_show` sem data não conta — é a data que manda', () => {
    expect(emCicloDeResgate({ no_show: true })).toBe(false);
    expect(emCicloDeResgate({ no_show: true, no_show_at: 'nao é data' })).toBe(false);
  });

  it('carimbo corrompido não derruba nada — trata como se não tivesse saído', () => {
    expect(emCicloDeResgate({ no_show_at: NO_SHOW, handoff_consultor: {} })).toBe(true);
    expect(emCicloDeResgate({ no_show_at: NO_SHOW, handoff_consultor: { at: null } })).toBe(true);
    expect(emCicloDeResgate({ no_show_at: NO_SHOW, handoff_consultor: 'sim' })).toBe(true);
  });
});
