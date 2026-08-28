import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A EXTRAÇÃO DA ANA NÃO PODE SER FIRE-AND-FORGET (27/08/2026).
 *
 * O caso: o lead Bruce Mendes respondeu "Sem" (coparticipação) e "Sim, 49,48,26" (vidas e
 * idades) — e a Ana perguntou as idades DE NOVO no turno seguinte. Investigando: as duas
 * respostas nunca foram gravadas. `deals.updated_at` parou às 01:26:23, antes das duas
 * mensagens, e `custom_fields.qualificacao` ficou congelada no turno 1.
 *
 * A causa é ambiente, não modelo: `runDomainExtraction` era disparada SEM await no ramo
 * `respond`. Em serverless, a instância congela assim que o handler retorna — o round trip
 * do Gemini nunca completava. No turno 1 funcionou por acidente: a etapa "novo-lead" tinha
 * `advancement_criteria`, então o passo 13 fazia OUTRA chamada de LLM com await, e esse
 * await segurava a função aberta tempo bastante para a extração terminar. Na etapa
 * "em-qualificação" — justamente onde a qualificação inteira é coletada — os critérios são
 * vazios, o passo 13 é pulado e a extração morre em todos os turnos.
 *
 * O próprio código já sabia: o ramo `observe` usa await com o comentário "o serverless pode
 * congelar após o return e cortar um fire-and-forget". O ramo `respond` ficou de fora.
 *
 * Este teste trava a regra no arquivo: se alguém voltar a soltar a extração sem await, ele
 * quebra. É teste de fonte porque a falha é de CICLO DE VIDA do processo — não dá para
 * reproduzir com mock sem simular o congelamento da Vercel.
 */
const fonte = readFileSync(
  join(process.cwd(), 'lib/ai/agent/agent.service.ts'),
  'utf8',
);

describe('runDomainExtraction — ciclo de vida', () => {
  it('é sempre aguardada (nunca disparada sem await)', () => {
    const chamadas = [...fonte.matchAll(/(^|\n)(\s*)(await\s+)?runDomainExtraction\(/g)];
    expect(chamadas.length).toBeGreaterThanOrEqual(2); // observe + respond

    const semAwait = chamadas.filter((m) => !m[3]);
    expect(
      semAwait.length,
      'runDomainExtraction sem await: em serverless a instância congela no return e a '
        + 'extração nunca grava (caso Bruce Mendes, 27/08/2026)',
    ).toBe(0);
  });

  it('o ramo respond continua explicando por que aguarda', () => {
    expect(fonte).toMatch(/fire-and-forget|congel/i);
  });
});
