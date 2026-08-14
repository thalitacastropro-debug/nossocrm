import { describe, expect, it } from 'vitest';
import { resolveExtractionLoss } from '@/lib/ai/extraction/loss-guard';

/**
 * Regressão do caso Ruberleide (03/08) — roadmap §P0.3.
 *
 * Em 30/07 a lead escreveu "Quero cotar com estas vidas apenas" (dizendo QUANTAS
 * vidas entram, não recusando nada). Como a extração relê a conversa INTEIRA a cada
 * turno, essa frase re-disparava `quer_so_cotacao=true` pra sempre — e em 03/08,
 * no turno em que ela ACEITOU o horário das 14h, o deal foi marcado perdido com
 * "Só quer cotação e recusa o diagnóstico".
 *
 * O defeito estrutural: `is_lost`/`loss_reason` só eram ESCRITOS, nunca limpos.
 * Um único turno de falso positivo virava estado permanente e escondia o card.
 */
describe('resolveExtractionLoss', () => {
  const base = {
    lossReason: null as string | null,
    meetingConfirmed: false,
    alreadyHandedOff: false,
    currentIsLost: false,
    lossOwnedByExtraction: false,
  };

  it('marca perdido quando a extração conclui fora do ICP', () => {
    const r = resolveExtractionLoss({ ...base, lossReason: 'Apenas 1 vida (plano individual, fora do perfil)' });
    expect(r.loss_reason).toBe('Apenas 1 vida (plano individual, fora do perfil)');
    expect(r.is_lost).toBe(true);
  });

  it('NÃO marca perdido quando a reunião já está confirmada (guard do P0 24/07)', () => {
    const r = resolveExtractionLoss({ ...base, lossReason: 'Só quer cotação e recusa o diagnóstico', meetingConfirmed: true });
    expect(r.loss_reason).toBe('Só quer cotação e recusa o diagnóstico'); // fica como contexto pro consultor
    expect(r.is_lost).toBeUndefined();
  });

  it('NÃO marca perdido quando já houve handoff pro consultor', () => {
    const r = resolveExtractionLoss({ ...base, lossReason: 'Fora do perfil (ICP)', alreadyHandedOff: true });
    expect(r.is_lost).toBeUndefined();
  });

  // O CORAÇÃO DO BUG: o caminho de volta.
  it('DESFAZ a perda quando a própria extração muda de ideia', () => {
    const r = resolveExtractionLoss({
      ...base,
      lossReason: null, // a extração agora diz que o lead está no perfil
      currentIsLost: true,
      lossOwnedByExtraction: true,
    });
    expect(r.is_lost).toBe(false);
    expect(r.loss_reason).toBeNull();
  });

  it('NUNCA desfaz uma perda marcada por HUMANO', () => {
    const r = resolveExtractionLoss({
      ...base,
      lossReason: null,
      currentIsLost: true,
      lossOwnedByExtraction: false, // consultor arrastou o card / usou o modal
    });
    expect(r.is_lost).toBeUndefined();
    expect(r.loss_reason).toBeUndefined();
  });

  it('não mexe em nada quando não há perda nem agora nem antes', () => {
    expect(resolveExtractionLoss({ ...base })).toEqual({});
  });

  it('é idempotente: re-marcar o mesmo motivo não muda nada além do esperado', () => {
    const input = { ...base, lossReason: 'Fora do perfil (ICP)', currentIsLost: true, lossOwnedByExtraction: true };
    expect(resolveExtractionLoss(input)).toEqual(resolveExtractionLoss(input));
  });
});
