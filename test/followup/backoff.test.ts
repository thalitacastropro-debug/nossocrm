/**
 * Limite de retry + backoff do follow-up.
 *
 * Nasceu do incidente de 28/08/2026: com o WhatsApp da UAZAPI desconectado, todo envio
 * falhava, o run revertia a cadência (certo — não perde o toque) e 15 min depois tentava
 * de novo, para sempre. Bruce e Flavia levaram 7 tentativas; o Ricardo, 20.
 */
import { describe, it, expect } from 'vitest';
import {
  registerFailure, clearFailures, nextDueTouch,
  MAX_FALHAS_SEGUIDAS, BACKOFF_BASE_MS,
  type FollowupState,
} from '@/lib/ai/followup/schedule';

const anchor = '2026-07-13T13:00:00.000Z';
const vencido = new Date(Date.parse(anchor) + 10 * 60 * 60 * 1000); // muito depois do 1º toque
const cold = (over: Partial<FollowupState> = {}): FollowupState => ({
  cadence: 'cold', anchor_at: anchor, count: 0, stopped: false, ...over,
});

describe('registerFailure', () => {
  it('primeira falha conta 1 e carimba a hora, sem parar a cadência', () => {
    const s = registerFailure(cold(), vencido);
    expect(s.fail_count).toBe(1);
    expect(s.last_failed_at).toBe(vencido.toISOString());
    expect(s.stopped).toBe(false);
  });

  it('falhas seguidas acumulam', () => {
    const s = registerFailure(cold({ fail_count: 2 }), vencido);
    expect(s.fail_count).toBe(3);
  });

  it('não mexe no count de toques — a cadência não avança quando o envio falha', () => {
    const s = registerFailure(cold({ count: 2 }), vencido);
    expect(s.count).toBe(2);
  });

  it(`na ${MAX_FALHAS_SEGUIDAS}ª falha seguida para a cadência com motivo próprio`, () => {
    const s = registerFailure(cold({ fail_count: MAX_FALHAS_SEGUIDAS - 1 }), vencido);
    expect(s.fail_count).toBe(MAX_FALHAS_SEGUIDAS);
    expect(s.stopped).toBe(true);
    expect(s.stopped_reason).toBe('falhas_de_envio');
  });
});

describe('clearFailures', () => {
  it('envio que dá certo zera o contador', () => {
    const s = clearFailures(cold({ fail_count: 3, last_failed_at: vencido.toISOString() }));
    expect(s.fail_count).toBe(0);
    expect(s.last_failed_at).toBeNull();
  });
});

describe('nextDueTouch com backoff', () => {
  const falhouEm = vencido;

  it('segura o toque enquanto o backoff da 1ª falha não venceu', () => {
    const s = cold({ fail_count: 1, last_failed_at: falhouEm.toISOString() });
    const agora = new Date(falhouEm.getTime() + BACKOFF_BASE_MS - 1);
    expect(nextDueTouch(s, agora)).toBeNull();
  });

  it('libera o toque quando o backoff vence', () => {
    const s = cold({ fail_count: 1, last_failed_at: falhouEm.toISOString() });
    const agora = new Date(falhouEm.getTime() + BACKOFF_BASE_MS);
    expect(nextDueTouch(s, agora)).toEqual({ touchIndex: 0, isLast: false });
  });

  it('o backoff dobra a cada falha (2ª falha espera 2x)', () => {
    const s = cold({ fail_count: 2, last_failed_at: falhouEm.toISOString() });
    const antes = new Date(falhouEm.getTime() + 2 * BACKOFF_BASE_MS - 1);
    const depois = new Date(falhouEm.getTime() + 2 * BACKOFF_BASE_MS);
    expect(nextDueTouch(s, antes)).toBeNull();
    expect(nextDueTouch(s, depois)).not.toBeNull();
  });

  it('sem falha registrada, nada muda no comportamento antigo', () => {
    expect(nextDueTouch(cold(), vencido)).toEqual({ touchIndex: 0, isLast: false });
  });
});
