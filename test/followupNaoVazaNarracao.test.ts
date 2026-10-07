import { describe, it, expect } from 'vitest';
import { validateAIOutput } from '@/lib/ai/agent/output-validator';

/**
 * As bolhas abaixo são TEXTO REAL que a Ana mandou e o lead LEU — não hipótese.
 *
 * `ae7eb47` (28/09 15:42) criou o validador para impedir exatamente isso, mas plugou só no
 * `agent.service` (o caminho de RESPONDER). O follow-up gerava e mandava sem passar por ele,
 * então a trava nunca o cobriu: a Regina Balbino recebeu cinco bolhas de raciocínio interno em
 * 29/09 às 8h — treze horas DEPOIS da trava subir — e o Adelino Miguel levou outra em 06/10.
 *
 * Este teste trava a regressão no ponto que importa: se qualquer uma dessas frases voltar a
 * passar como "segura", a bolha volta pro WhatsApp do lead.
 */
const semContexto = { contact: null, deal: null, stage: null, messages: [] } as never;

describe('follow-up não pode vazar narração interna', () => {
  const vazamentosReais = [
    'Estou vendo que você pediu pra eu escrever um follow-up, mas preciso avisar: a última mensagem que aparece na conversa já é o toque.',
    'Se Regina não respondeu a ESSE toque, o próximo seria um reengajamento mais leve, sem re-oferecer o horário de novo.',
    '- Regina viu a mensagem mas não respondeu?',
    'Você quer que eu escreva como se ESSA mensagem acima ainda não tivesse sido mandada?',
    'A mensagem anterior não foi descriptografada, então o lead ainda não respondeu nada concreto. Vou fazer um toque amigável.',
    'Você tem razão, a conversa parou após a oferta de horário.',
    'Aqui está o follow-up:',
  ];

  it.each(vazamentosReais)('barra: %s', (bolha) => {
    expect(validateAIOutput(bolha, semContexto).safe).toBe(false);
  });

  it('deixa passar um toque legítimo — a trava não pode calar a Ana', () => {
    const toqueBom = [
      'Regina, consegui dois horários pra essa semana.',
      'Quinta às 9h ou sexta às 10h, qual fica melhor?',
    ].join('\n');
    expect(validateAIOutput(toqueBom, semContexto).safe).toBe(true);
  });
});
