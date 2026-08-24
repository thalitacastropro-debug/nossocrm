import { describe, it, expect } from 'vitest';
import { avaliarSilencio, horasUteisEntre, LIMITES_PADRAO } from './silencio';

// Datas reais do incidente de 21-24/08/2026, em horário de São Paulo (UTC-3).
const SEXTA_08H = new Date('2026-08-21T11:00:00.000Z'); // sexta 08:00 BRT
const SEXTA_17H30 = new Date('2026-08-21T20:30:00.000Z'); // sexta 17:30 BRT
const SABADO_12H = new Date('2026-08-22T15:00:00.000Z');
const SEGUNDA_08H = new Date('2026-08-24T11:00:00.000Z'); // segunda 08:00 BRT

describe('horasUteisEntre', () => {
  it('conta um expediente inteiro como 9,5 horas', () => {
    expect(horasUteisEntre(SEXTA_08H, SEXTA_17H30)).toBe(9.5);
  });

  it('não conta fim de semana — sexta 17h30 até segunda 08h é zero', () => {
    // Foi exatamente esta a janela do incidente: o funil parecia parado, mas
    // sábado e domingo não são silêncio, são calendário.
    expect(horasUteisEntre(SEXTA_17H30, SEGUNDA_08H)).toBe(0);
  });

  it('ignora as horas fora do expediente dentro de um dia útil', () => {
    const sextaMadrugada = new Date('2026-08-21T05:00:00.000Z'); // 02:00 BRT
    expect(horasUteisEntre(sextaMadrugada, SEXTA_08H)).toBe(0);
  });

  it('atravessa o fim de semana somando só os dias úteis', () => {
    // Sexta 08:00 → segunda 08:00 = só o expediente de sexta.
    expect(horasUteisEntre(SEXTA_08H, SEGUNDA_08H)).toBe(9.5);
  });

  it('devolve zero quando o fim vem antes do início', () => {
    expect(horasUteisEntre(SEGUNDA_08H, SEXTA_08H)).toBe(0);
  });

  it('não quebra com data inválida', () => {
    expect(horasUteisEntre(new Date('nada'), SEGUNDA_08H)).toBe(0);
    expect(horasUteisEntre(SEXTA_08H, new Date('nada'))).toBe(0);
  });

  it('sábado inteiro não conta nada', () => {
    expect(horasUteisEntre(SABADO_12H, new Date('2026-08-22T22:00:00.000Z'))).toBe(0);
  });
});

describe('avaliarSilencio', () => {
  it('fica calado quando só o lead está parado — isso é metade dos dias úteis', () => {
    // Medido na base: 16 de 32 dias úteis tiveram zero lead. Alarmar aqui
    // treinaria a equipe a ignorar o alarme.
    const v = avaliarSilencio({ horasSemLead: 40, horasSemMensagem: 1 });
    expect(v.nivel).toBe('ok');
  });

  it('fica calado quando só o WhatsApp está parado', () => {
    const v = avaliarSilencio({ horasSemLead: 0.5, horasSemMensagem: 30 });
    expect(v.nivel).toBe('ok');
  });

  it('avisa quando os DOIS ficam mudos além do limite de atenção', () => {
    const v = avaliarSilencio({ horasSemLead: 9, horasSemMensagem: 7 });
    expect(v.nivel).toBe('atencao');
    expect(v.mensagem).toContain('quieta');
  });

  it('alerta quando os dois passam do limite forte', () => {
    const v = avaliarSilencio({ horasSemLead: 30, horasSemMensagem: 20 });
    expect(v.nivel).toBe('alerta');
    expect(v.mensagem).toContain('parou');
    // A mensagem tem que dizer o que fazer, não só que algo está errado.
    expect(v.mensagem).toContain('automação da agência');
  });

  it('usa o canal MENOS silencioso para decidir — um sinal de vida basta', () => {
    // WhatsApp respondeu há 1h: a esteira está viva, mesmo sem lead há dias.
    const v = avaliarSilencio({ horasSemLead: 100, horasSemMensagem: 1 });
    expect(v.nivel).toBe('ok');
  });

  it('aceita limites customizados sem mexer no código', () => {
    const v = avaliarSilencio({ horasSemLead: 3, horasSemMensagem: 3 }, { atencao: 2, alerta: 10 });
    expect(v.nivel).toBe('atencao');
  });

  it('o limite padrão não dispara com um dia útil fraco', () => {
    // 5h úteis de silêncio nos dois: ainda dentro do normal.
    expect(avaliarSilencio({ horasSemLead: 5, horasSemMensagem: 5 }, LIMITES_PADRAO).nivel).toBe('ok');
  });

  it('sempre explica o motivo, inclusive quando está tudo bem', () => {
    expect(avaliarSilencio({ horasSemLead: 1, horasSemMensagem: 1 }).motivo).toBeTruthy();
  });
});
