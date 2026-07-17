import { describe, it, expect } from 'vitest';
import {
  ultimoDiaUtilAntes, dueVespera, dueAtivacao, deveEnviar, VESPERA_MIN_GAP_MS,
} from '@/lib/ai/followup/meeting-reminder-schedule';
import { renderReminder, TOQUES_COPY } from '@/lib/ai/followup/meeting-reminder';

// Referência: sexta 17/07/2026, segunda = 20/07/2026.
const SEG_15H = '2026-07-20T18:00:00.000Z'; // segunda 20/07 15h SP
const SEG_9H  = '2026-07-20T12:00:00.000Z'; // segunda 20/07 9h SP
const QUI_10H = '2026-07-23T13:00:00.000Z'; // quinta 23/07 10h SP

describe('ultimoDiaUtilAntes', () => {
  it('reunião na quinta → véspera na quarta 17h', () => {
    expect(ultimoDiaUtilAntes(QUI_10H)).toBe('2026-07-22T20:00:00.000Z'); // quarta 22/07 17h SP
  });

  it('reunião na SEGUNDA → véspera na SEXTA 17h (pula o fim de semana)', () => {
    expect(ultimoDiaUtilAntes(SEG_9H)).toBe('2026-07-17T20:00:00.000Z'); // sexta 17/07 17h SP
  });
});

describe('dueAtivacao', () => {
  it('é 30min antes da reunião', () => {
    expect(dueAtivacao(SEG_15H)).toBe('2026-07-20T17:30:00.000Z'); // segunda 14h30 SP
  });
});

describe('deveEnviar — véspera', () => {
  const marcadaEm = '2026-07-16T12:00:00.000Z'; // quinta 16/07 9h SP (bem antes da janela)

  it('envia dentro da janela [17h00, 17h30]', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T20:05:00.000Z'), enviadoEm: null,
    })).toBe(true);
  });

  it('NÃO envia antes da janela abrir', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T19:00:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });

  it('NÃO envia depois de expirar (cron parado) — queima', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T21:00:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });

  it('NÃO reenvia o que já foi enviado', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H, criadaEm: marcadaEm,
      agora: new Date('2026-07-17T20:05:00.000Z'), enviadoEm: '2026-07-17T20:00:00.000Z',
    })).toBe(false);
  });
});

describe('deveEnviar — gap mínimo da véspera (anti "confirmando o que combinamos há 6 minutos")', () => {
  const due = '2026-07-17T20:00:00.000Z'; // sexta 17h SP = véspera de segunda 9h
  const agora = new Date('2026-07-17T20:00:00.000Z');

  it('marcou 6 minutos antes da janela → QUEIMA (o caso real: lead marca 16h54, tick 17h00)', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: new Date(Date.parse(due) - 6 * 60_000).toISOString(),
      agora, enviadoEm: null,
    })).toBe(false);
  });

  it('marcou 2h59 antes → QUEIMA (borda de dentro)', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: new Date(Date.parse(due) - VESPERA_MIN_GAP_MS + 60_000).toISOString(),
      agora, enviadoEm: null,
    })).toBe(false);
  });

  it('marcou 3h01 antes → ENVIA (borda de fora)', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: new Date(Date.parse(due) - VESPERA_MIN_GAP_MS - 60_000).toISOString(),
      agora, enviadoEm: null,
    })).toBe(true);
  });

  it('marcou DEPOIS da janela abrir (17h20 p/ amanhã) → QUEIMA', () => {
    expect(deveEnviar({
      toque: 'vespera', dataHora: SEG_9H,
      criadaEm: '2026-07-17T20:20:00.000Z',
      agora: new Date('2026-07-17T20:25:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });
});

describe('deveEnviar — ativação', () => {
  it('envia na janela [T-30min, T-0]', () => {
    expect(deveEnviar({
      toque: 'ativacao', dataHora: SEG_15H, criadaEm: '2026-07-17T11:22:53.170Z',
      agora: new Date('2026-07-20T17:35:00.000Z'), enviadoEm: null,
    })).toBe(true);
  });

  it('NÃO envia depois de a reunião começar (cron parado 1h) — queima', () => {
    expect(deveEnviar({
      toque: 'ativacao', dataHora: SEG_15H, criadaEm: '2026-07-17T11:22:53.170Z',
      agora: new Date('2026-07-20T18:05:00.000Z'), enviadoEm: null,
    })).toBe(false);
  });

  it('o GAP não se aplica à ativação: marcou 2h antes e ela sai mesmo assim', () => {
    // minLeadMinutes=120 permite marcar 10h p/ 12h. A ativação é o toque que importa.
    expect(deveEnviar({
      toque: 'ativacao', dataHora: SEG_15H,
      criadaEm: '2026-07-20T16:00:00.000Z', // 2h antes da reunião
      agora: new Date('2026-07-20T17:35:00.000Z'), enviadoEm: null,
    })).toBe(true);
  });
});

describe('ultimoDiaUtilAntes x feriado', () => {
  it('reunião terça 08/09 → véspera sexta 04/09 17h (pula o feriado de 07/09 E o fim de semana)', () => {
    const TER_08_09 = '2026-09-08T12:00:00.000Z'; // terça 08/09/2026 9h SP
    expect(ultimoDiaUtilAntes(TER_08_09)).toBe('2026-09-04T20:00:00.000Z'); // sexta 04/09 17h SP
  });
});

// dueVespera é alias de ultimoDiaUtilAntes — sanity de que o alias não divergiu.
describe('dueVespera', () => {
  it('espelha ultimoDiaUtilAntes', () => {
    expect(dueVespera(SEG_9H)).toBe(ultimoDiaUtilAntes(SEG_9H));
  });
});

describe('renderReminder', () => {
  it('interpola nome, label e consultor', () => {
    const out = renderReminder(TOQUES_COPY.ativacao, {
      nome: 'Nathalia', label: 'segunda, 20/07, às 15h', consultor: 'Denilson',
    });
    expect(out).toContain('Nathalia');
    expect(out).toContain('Denilson');
    expect(out).not.toContain('{');
  });

  it('NENHUM toque deixa placeholder por resolver (o {label} não existia no renderBubbles)', () => {
    for (const toque of Object.values(TOQUES_COPY)) {
      const out = renderReminder(toque, {
        nome: 'Maria', label: 'segunda, 20/07, às 15h', consultor: 'Denilson',
      });
      expect(out).not.toMatch(/\{|\}/);
    }
  });

  it('fallback: sem nome e sem consultor, não sobra chave nem pontuação órfã', () => {
    for (const toque of Object.values(TOQUES_COPY)) {
      const out = renderReminder(toque, { nome: '', label: 'segunda, 20/07, às 15h', consultor: 'o consultor' });
      expect(out).not.toMatch(/\{|\}/);
      expect(out).not.toMatch(/\s,|^,|\s\./m);
    }
  });

  it('guard-rail: toda chave usada na copy existe no objeto de vars', () => {
    const vars = new Set(['nome', 'label', 'consultor']);
    for (const toque of Object.values(TOQUES_COPY)) {
      for (const bolha of toque) {
        for (const m of bolha.matchAll(/\{(\w+)\}/g)) {
          expect(vars.has(m[1])).toBe(true);
        }
      }
    }
  });

  it('separa as bolhas com linha em branco (o splitIntoBubbles do sendAIResponse)', () => {
    const out = renderReminder(['Uma.', 'Duas.'], { nome: 'X', label: 'Y', consultor: 'Z' });
    expect(out).toBe('Uma.\n\nDuas.');
  });
});
