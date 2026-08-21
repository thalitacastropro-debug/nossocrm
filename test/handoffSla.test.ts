import { describe, expect, it } from 'vitest';
import {
  businessMinutesBetween,
  resolveHandoffSla,
  SLA_SEGUNDO_AVISO_MIN,
  SLA_RETOMADA_MIN,
  SLA_JANELA_MAX_MIN,
} from '@/lib/ai/followup/handoff-sla';

/**
 * SLA do handoff (decisão da Thalita, 20/08): 2 horas úteis → segundo aviso;
 * 1 dia útil → a Ana retoma.
 *
 * Antes: a Ana entregava pro humano e calava PRA SEMPRE. A flag `ai_handoff_pending`
 * era escrita e nunca lida por nada. A Mônica foi entregue às 00:24 da madrugada — o
 * aviso saiu no Telegram pra ninguém, e ela nunca mais teve resposta. Por isso o
 * relógio conta HORA ÚTIL: senão um lead que chega de madrugada estoura o prazo às
 * 2h e o segundo aviso vai pro vazio também.
 *
 * Horário comercial: 08:00–17:30, seg–sex, America/São_Paulo (UTC-3, offset fixo
 * igual ao resto do código). Nos testes as datas estão em UTC — local = UTC − 3.
 */
describe('businessMinutesBetween', () => {
  it('conta só o miolo do expediente no mesmo dia', () => {
    // seg 04/08, local 09:00 → 11:00
    expect(businessMinutesBetween('2026-08-03T12:00:00Z', new Date('2026-08-03T14:00:00Z'))).toBe(120);
  });

  it('ignora o que acontece antes da abertura', () => {
    // local 06:00 → 09:00 ⇒ só conta 08:00–09:00
    expect(businessMinutesBetween('2026-08-03T09:00:00Z', new Date('2026-08-03T12:00:00Z'))).toBe(60);
  });

  it('ignora o que acontece depois do fechamento', () => {
    // local 17:00 → 20:00 ⇒ só conta 17:00–17:30
    expect(businessMinutesBetween('2026-08-03T20:00:00Z', new Date('2026-08-03T23:00:00Z'))).toBe(30);
  });

  it('um dia útil inteiro são 570 minutos (08:00–17:30)', () => {
    expect(businessMinutesBetween('2026-08-03T11:00:00Z', new Date('2026-08-03T20:30:00Z'))).toBe(570);
    expect(SLA_RETOMADA_MIN).toBe(570);
  });

  it('pula o fim de semana', () => {
    // sex 07/08 local 17:00 → seg 10/08 local 09:00 = 30 (sex) + 60 (seg)
    expect(businessMinutesBetween('2026-08-07T20:00:00Z', new Date('2026-08-10T12:00:00Z'))).toBe(90);
  });

  it('sábado inteiro não conta nada', () => {
    expect(businessMinutesBetween('2026-08-08T11:00:00Z', new Date('2026-08-08T20:00:00Z'))).toBe(0);
  });

  it('o CASO MÔNICA: entregue 00:24 da madrugada só começa a contar às 8h', () => {
    // dom→seg 00:24 local; às 09:00 local do mesmo dia deu 60 min úteis, não 8h36.
    expect(businessMinutesBetween('2026-08-03T03:24:00Z', new Date('2026-08-03T12:00:00Z'))).toBe(60);
  });

  it('nunca devolve negativo se as datas vierem invertidas', () => {
    expect(businessMinutesBetween('2026-08-03T14:00:00Z', new Date('2026-08-03T12:00:00Z'))).toBe(0);
  });
});

describe('resolveHandoffSla', () => {
  const base = {
    handoffAt: '2026-08-03T12:00:00Z', // seg, local 09:00
    segundoAvisoAt: null as string | null,
    humanRepliedAt: null as string | null,
  };

  it('humano respondeu: encerra o SLA e para de vigiar', () => {
    const r = resolveHandoffSla({ ...base, humanRepliedAt: '2026-08-03T13:00:00Z' }, new Date('2026-08-04T12:00:00Z'));
    expect(r.acao).toBe('encerrar');
  });

  it('menos de 2 horas úteis: não faz nada', () => {
    const r = resolveHandoffSla(base, new Date('2026-08-03T13:00:00Z')); // 1h útil
    expect(r.acao).toBe('nada');
  });

  it('2 horas úteis sem resposta: segundo aviso', () => {
    const r = resolveHandoffSla(base, new Date('2026-08-03T14:00:00Z'));
    expect(r.acao).toBe('segundo_aviso');
    expect(r.minutosUteis).toBe(SLA_SEGUNDO_AVISO_MIN);
  });

  it('segundo aviso já mandado: não repete', () => {
    const r = resolveHandoffSla(
      { ...base, segundoAvisoAt: '2026-08-03T14:00:00Z' },
      new Date('2026-08-03T15:00:00Z')
    );
    expect(r.acao).toBe('nada');
  });

  // REGRA DA THALITA (21/08): a Ana NÃO retoma. Uma vez entregue, o lead é do consultor — e o
  // handoff agora MOVE o card pro funil dele, então ela nem poderia falar. O SLA só escala o aviso.
  it('1 dia útil parado: NÃO manda a Ana falar, o aviso já foi dado', () => {
    const r = resolveHandoffSla({ ...base, segundoAvisoAt: '2026-08-03T14:00:00Z' }, new Date('2026-08-04T12:00:00Z'));
    expect(r.acao).toBe('nada');
  });

  it('nunca devolve ação que faça a Ana falar depois da entrega', () => {
    const momentos = ['2026-08-03T14:00:00Z', '2026-08-04T12:00:00Z', '2026-08-06T12:00:00Z'];
    for (const m of momentos) {
      const r = resolveHandoffSla({ ...base, segundoAvisoAt: '2026-08-03T14:00:00Z' }, new Date(m));
      expect(['nada', 'encerrar']).toContain(r.acao);
    }
  });

  // ANTI-RAJADA. Descoberto ao conferir o banco ANTES de deployar: havia 7 handoffs
  // pendentes de JULHO (o mais velho de 10/07). Sem esta trava, o primeiro tick do cron
  // mandaria "consegui adiantar mais alguma coisa?" pra 5 leads parados há mais de um mês —
  // a mesma mensagem fora de hora que a dona reclamou no caso Valdenice.
  // Vale também se o cron ficar parado dias e voltar com backlog.
  it('handoff VELHO demais não é retomado: encerra em silêncio', () => {
    const r = resolveHandoffSla(base, new Date('2026-09-15T12:00:00Z')); // ~6 semanas depois
    expect(r.acao).toBe('encerrar');
  });

  it('a fronteira: dentro da janela ainda vigia (não encerra)', () => {
    // 5 dias úteis = 2850 min. Seg 03/08 09:00 + 4 dias úteis cheios + 1h = dentro.
    const r = resolveHandoffSla(base, new Date('2026-08-07T13:00:00Z'));
    expect(r.acao).not.toBe('encerrar');
    expect(r.minutosUteis).toBeLessThanOrEqual(SLA_JANELA_MAX_MIN);
  });

  it('resposta do humano vence mesmo depois do prazo estourado', () => {
    const r = resolveHandoffSla(
      { ...base, humanRepliedAt: '2026-08-05T12:00:00Z' },
      new Date('2026-08-06T12:00:00Z')
    );
    expect(r.acao).toBe('encerrar');
  });
});
