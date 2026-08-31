/**
 * @fileoverview A data que a IA extrai do áudio do consultor.
 *
 * Caso real de 31/08/2026: o Denilson gravou o desfecho da call com o Bruce e
 * disse "agendei retorno para 02/09 às 10h". A tarefa nasceu em
 * `2023-09-02 07:00` — ano errado (o prompt não dizia que dia era hoje) e hora
 * errada (o modelo escreveu 10:00Z, que em Brasília é 07:00). Como a timeline do
 * card ordena por data, a tarefa recém-criada foi para o fim da lista, marcada
 * como atrasada.
 */

import { describe, it, expect } from 'vitest';
import { normalizarDataTarefa, hojeParaPrompt } from '@/lib/ai/call-outcome/datas';

/** 31/08/2026, 17:55 BRT — o instante exato em que o Denilson gravou o áudio. */
const AGORA = new Date('2026-08-31T20:55:00Z');

/** Lê um ISO como hora de parede em Brasília, para os testes falarem a língua do consultor. */
const emBrt = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));

describe('normalizarDataTarefa — o caso Bruce', () => {
  it('conserta a data exata que quebrou: 2023-09-02T10:00:00Z vira 02/09/2026 às 10h', () => {
    const iso = normalizarDataTarefa('2023-09-02T10:00:00Z', AGORA);
    expect(iso).not.toBeNull();
    expect(emBrt(iso!)).toBe('02/09/2026, 10:00');
  });

  it('a hora dita pelo consultor é a de Brasília, mesmo que o modelo grude "Z"', () => {
    // Era isto que produzia 07:00 no card: honrar o fuso que o modelo inventou.
    expect(emBrt(normalizarDataTarefa('2026-09-02T10:00:00Z', AGORA)!)).toBe('02/09/2026, 10:00');
    expect(emBrt(normalizarDataTarefa('2026-09-02T10:00:00-03:00', AGORA)!)).toBe('02/09/2026, 10:00');
    expect(emBrt(normalizarDataTarefa('2026-09-02T10:00', AGORA)!)).toBe('02/09/2026, 10:00');
  });
});

describe('normalizarDataTarefa — tarefa nunca nasce no passado', () => {
  it('ano no passado vira a próxima ocorrência da mesma data', () => {
    expect(emBrt(normalizarDataTarefa('2019-12-25T14:00', AGORA)!)).toBe('25/12/2026, 14:00');
  });

  it('data que já passou NESTE ano cai no ano seguinte', () => {
    // Hoje é 31/08/2026; "10 de março" só pode ser 2027.
    expect(emBrt(normalizarDataTarefa('2026-03-10T09:00', AGORA)!)).toBe('10/03/2027, 09:00');
  });

  it('data futura correta passa intacta', () => {
    expect(emBrt(normalizarDataTarefa('2026-09-02T10:00', AGORA)!)).toBe('02/09/2026, 10:00');
  });

  it('nunca devolve data anterior a agora', () => {
    const entradas = ['2023-09-02T10:00:00Z', '2019-12-25T14:00', '2026-01-05T08:00', '02/09'];
    for (const e of entradas) {
      const iso = normalizarDataTarefa(e, AGORA);
      expect(iso, `entrada: ${e}`).not.toBeNull();
      expect(new Date(iso!).getTime(), `entrada: ${e}`).toBeGreaterThan(AGORA.getTime());
    }
  });
});

describe('normalizarDataTarefa — formatos e lixo', () => {
  it('aceita o jeito brasileiro, que é como o consultor fala', () => {
    expect(emBrt(normalizarDataTarefa('02/09 10h', AGORA)!)).toBe('02/09/2026, 10:00');
    expect(emBrt(normalizarDataTarefa('02/09/2026 14:30', AGORA)!)).toBe('02/09/2026, 14:30');
    expect(emBrt(normalizarDataTarefa('05/09/26', AGORA)!)).toBe('05/09/2026, 09:00');
  });

  it('só o dia, sem hora, marca 9h — começo do expediente', () => {
    expect(emBrt(normalizarDataTarefa('2026-09-02', AGORA)!)).toBe('02/09/2026, 09:00');
  });

  it('null/vazio/texto solto não viram data inventada', () => {
    expect(normalizarDataTarefa(null, AGORA)).toBeNull();
    expect(normalizarDataTarefa(undefined, AGORA)).toBeNull();
    expect(normalizarDataTarefa('', AGORA)).toBeNull();
    expect(normalizarDataTarefa('semana que vem', AGORA)).toBeNull();
  });

  it('data que não existe no calendário é recusada, não arredondada', () => {
    // O construtor de Date faria 31/02 virar 03/03 em silêncio.
    expect(normalizarDataTarefa('2026-02-31T10:00', AGORA)).toBeNull();
  });

  it('longe demais para ser próximo passo de venda é recusado', () => {
    // Melhor sem tarefa do que com tarefa que some da vista por 10 anos.
    expect(normalizarDataTarefa('2036-09-02T10:00', AGORA)).toBeNull();
  });
});

describe('hojeParaPrompt', () => {
  it('dá ao modelo a âncora que faltava, em Brasília', () => {
    const texto = hojeParaPrompt(AGORA);
    expect(texto).toContain('31/08/2026');
    expect(texto).toContain('segunda');
  });

  it('usa Brasília, não UTC: 21h BRT de 31/08 ainda é 31/08 (e não 01/09)', () => {
    // 2026-09-01T00:30Z = 31/08 21:30 em Brasília.
    expect(hojeParaPrompt(new Date('2026-09-01T00:30:00Z'))).toContain('31/08/2026');
  });
});
