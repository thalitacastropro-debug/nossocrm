/**
 * Como cada pessoa do time vira destino do diário individual (02/09/2026).
 *
 * O risco que estes testes existem para impedir: o Pedro receber o relatório do
 * Denilson. O do gestor traz o que a EQUIPE tem em aberto — se o vínculo trocar,
 * o Pedro passa a ler a cobrança sobre ele mesmo e o Denilson para de receber,
 * sem nenhum dos dois perceber.
 *
 * Dois caminhos levam a essa troca, e cada um tem sua defesa aqui:
 *  - dois /start simultâneos (acidente) → o código casa a pessoa certa;
 *  - código adivinhado (má-fé) → o código é sorteado, não derivado do id.
 */
import { describe, it, expect } from 'vitest';
import {
  acharChatPeloCodigo,
  gerarCodigo,
  VALIDADE_DO_CODIGO_MIN,
  type UpdateDoTelegram,
} from '@/lib/notifications/telegramColaborador';

const msg = (texto: string, chatId: number, over: Partial<{ tipo: string; nome: string }> = {}): UpdateDoTelegram => ({
  message: {
    text: texto,
    chat: { id: chatId, type: over.tipo ?? 'private' },
    from: { first_name: over.nome ?? 'Alguém' },
  },
});

describe('gerarCodigo', () => {
  // A primeira versão derivava o código do profiles.id — que a policy de
  // leitura entrega para a organização inteira. Dava para calcular o código do
  // gestor, mandá-lo ao bot pelo Telegram próprio e ficar com o vínculo dele.
  it('é imprevisível: 200 sorteios, 200 códigos diferentes', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => gerarCodigo()));
    expect(vistos.size).toBe(200);
  });

  it('sai legível para ditar em voz alta — sem O/0, I/1, S/5', () => {
    for (let i = 0; i < 50; i++) {
      const c = gerarCodigo();
      expect(c).toMatch(/^NIVA-[A-Z2-9]{8}$/);
      expect(c.slice(5)).not.toMatch(/[OIS015]/);
    }
  });

  it('vale por minutos, não por dias', () => {
    expect(VALIDADE_DO_CODIGO_MIN).toBeGreaterThan(0);
    expect(VALIDADE_DO_CODIGO_MIN).toBeLessThanOrEqual(30);
  });
});

describe('acharChatPeloCodigo', () => {
  const CODIGO_PEDRO = 'NIVA-ABCD2345';
  const CODIGO_DENILSON = 'NIVA-WXYZ6789';

  it('casa a pessoa certa quando os dois mandam quase junto', () => {
    // O cenário real: o aviso cai no grupo e os dois fazem na mesma hora.
    const updates = [
      msg(CODIGO_DENILSON, 111, { nome: 'Denilson' }),
      msg(CODIGO_PEDRO, 222, { nome: 'Pedro' }),
    ];

    expect(acharChatPeloCodigo(updates, CODIGO_PEDRO)?.chatId).toBe('222');
    expect(acharChatPeloCodigo(updates, CODIGO_DENILSON)?.chatId).toBe('111');
  });

  it('aceita o código digitado torto (minúscula, espaço, sem hífen)', () => {
    const updates = [msg('  niva abcd2345 ', 222)];
    expect(acharChatPeloCodigo(updates, CODIGO_PEDRO)?.chatId).toBe('222');
  });

  it('aceita o código dentro de uma frase, e no /start do deep link', () => {
    expect(acharChatPeloCodigo([msg(`/start ${CODIGO_PEDRO}`, 222)], CODIGO_PEDRO)?.chatId).toBe('222');
    expect(acharChatPeloCodigo([msg(`oi, meu codigo é ${CODIGO_PEDRO} obrigado`, 333)], CODIGO_PEDRO)?.chatId).toBe('333');
  });

  it('vale a conversa mais recente quando a pessoa manda duas vezes', () => {
    const updates = [msg(CODIGO_PEDRO, 222), msg(CODIGO_PEDRO, 999)];
    expect(acharChatPeloCodigo(updates, CODIGO_PEDRO)?.chatId).toBe('999');
  });

  it('IGNORA grupo — o diário individual não pode cair num grupo', () => {
    const updates = [msg(CODIGO_PEDRO, -100123, { tipo: 'supergroup' })];
    expect(acharChatPeloCodigo(updates, CODIGO_PEDRO)).toBeNull();
  });

  it('ninguém mandou o código ainda => null (a tela pede para tentar de novo)', () => {
    expect(acharChatPeloCodigo([msg('/start', 222)], CODIGO_PEDRO)).toBeNull();
  });

  it('update torto não explode', () => {
    const tortos = [{}, { message: {} }, { message: { text: 'x' } }] as UpdateDoTelegram[];
    expect(() => acharChatPeloCodigo(tortos, CODIGO_PEDRO)).not.toThrow();
    expect(acharChatPeloCodigo(tortos, CODIGO_PEDRO)).toBeNull();
  });

  it('código vazio não casa com qualquer um', () => {
    expect(acharChatPeloCodigo([msg('qualquer coisa', 222)], '')).toBeNull();
    expect(acharChatPeloCodigo([msg('qualquer coisa', 222)], '   ')).toBeNull();
  });
});
