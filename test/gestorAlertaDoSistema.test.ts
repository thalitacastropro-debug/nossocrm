/**
 * ALERTA DO SISTEMA NO RELATÓRIO DAS 8H (09/10/2026).
 *
 * WhatsApp fora de 06 a 08/10: a `regraCanalCaido` detectou a queda e o aviso não saiu em
 * relatório nenhum. Conferido em `gestor_envios`: nenhum dos 8 envios de 06 a 09/10 o trazia.
 *   - no relatório da pessoa, só entrava item com dono = quem lê, e alerta de sistema não tem dono;
 *   - no da dona, ele virava um "colaborador" chamado "WhatsApp", no fim de um texto que o corte
 *     do Telegram decepa.
 */
import { describe, it, expect } from 'vitest';
import type { Diario } from '@/lib/gestor/regras';
import { formatarDiario, formatarParaColaborador } from '@/lib/gestor/formato';

const canalCaido = {
  id: 'canal-caido', titulo: 'WhatsApp fora do ar', emoji: '📵',
  acao: 'Reconectar o WhatsApp lendo o QR na UAZAPI.',
  novos: [{
    donoId: null, donoNome: 'WhatsApp', contato: 'Mensagem não chegou no lead',
    detalhe: '16 mensagens morreram com o WhatsApp desconectado', idadeHoras: 30,
  }],
  estoque: 1,
};

const orcamentoIA = {
  id: 'orcamento-ia', titulo: 'Orçamento de IA da Ana', emoji: '🪫',
  novos: [{ donoId: null, donoNome: 'Técnico', contato: 'Ana', detalhe: '85% do teto usado', idadeHoras: 1 }],
  estoque: 1,
};

/** Um dia cheio: 8 cobranças do Pedro antes de qualquer alerta — o cenário em que o corte morde. */
function diaCheio(): Diario {
  return {
    data: 'quarta-feira, 08/10',
    ontem: { mensagensDeLead: 0, notasEscritas: 0, reunioesMarcadas: 0 },
    regras: [
      {
        id: 'sem-resposta', titulo: 'Falaram e ninguém respondeu', emoji: '🔴', estoque: 8,
        novos: Array.from({ length: 8 }, (_, i) => ({
          donoId: 'u-ped', donoNome: 'Pedro Sellan', contato: `Lead ${i}`,
          detalhe: `"${'mensagem comprida do lead '.repeat(6)}"`, idadeHoras: 20 - i,
        })),
        estoquePorDono: { 'u-ped': 8 }, estoqueItens: [],
      },
      canalCaido as never,
      orcamentoIA as never,
    ],
  };
}

describe('alerta do sistema chega a quem precisa', () => {
  it('🔴 o vendedor recebe "WhatsApp fora do ar" — antes não recebia (alerta sem dono)', () => {
    const t = formatarParaColaborador(diaCheio(), 'u-ped')!;
    expect(t).toContain('WhatsApp fora do ar');
    expect(t).toContain('Reconectar o WhatsApp');
  });

  it('e ele vem ANTES das prioridades pessoais, fora do corte de 5', () => {
    const t = formatarParaColaborador(diaCheio(), 'u-ped')!;
    expect(t.indexOf('WhatsApp fora do ar')).toBeLessThan(t.indexOf('Suas prioridades'));
  });

  it('o vendedor NÃO recebe orçamento de IA (não tem gesto para isso); o gestor recebe', () => {
    expect(formatarParaColaborador(diaCheio(), 'u-ped')!).not.toContain('Orçamento de IA');
    expect(formatarParaColaborador(diaCheio(), 'u-den', { ehGestor: true })!).toContain('Orçamento de IA');
  });

  it('quem não tem pendência nenhuma ainda recebe o relatório quando o WhatsApp caiu', () => {
    const t = formatarParaColaborador(diaCheio(), 'u-sem-nada');
    expect(t).not.toBeNull();
    expect(t!).toContain('WhatsApp fora do ar');
  });

  it('no relatório da dona ele abre o texto — não é mais um "colaborador" chamado WhatsApp no fim', () => {
    const t = formatarDiario(diaCheio(), true);
    expect(t.indexOf('WhatsApp fora do ar')).toBeGreaterThan(-1);
    expect(t.indexOf('WhatsApp fora do ar')).toBeLessThan(t.indexOf('Pedro Sellan'));
    expect(t).not.toContain('<b>WhatsApp</b>');
  });

  it('canal caído vem antes do orçamento da IA', () => {
    const t = formatarDiario(diaCheio(), true);
    expect(t.indexOf('WhatsApp fora do ar')).toBeLessThan(t.indexOf('Orçamento de IA'));
  });
});
