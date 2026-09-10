/**
 * QUANDO O DESFECHO É "FECHOU", O VALOR DITADO É O PRÊMIO — não a mensalidade antiga.
 *
 * Dois números parecidos e opostos moram perto aqui (ver lib/deals/premioFechado.ts):
 *  - `qualificacao.valor_pago_exato` = o que o lead paga HOJE no plano ANTIGO. É o gatilho da
 *    conversa ("você paga R$750 e pode pagar menos"), não receita.
 *  - `venda.premio_mensal` = o valor do plano que ele COMPROU. É este que fecha o mês.
 *
 * A rota do desfecho gravava `dados_negocio.valor` em `valor_pago_exato` SEM olhar o desfecho. Ou
 * seja: o consultor dizia "fechei por R$2.100" e o CRM entendia "o lead paga R$2.100 no plano
 * velho" — corrompendo o dado de qualificação e inflando o "valor em jogo".
 *
 * Pior: `fechou` marcava `is_won` e movia para Implantação SEM criar o carimbo `custom_fields.venda`
 * (quem o cria é a rota `proximo-funil`, do kanban). Sem carimbo, a venda não entra na meta do mês
 * (a barra lê `venda`, não `is_won`), o gestor não cobra o prêmio (a regra filtra por `venda` não
 * nulo) e a própria rota de prêmio recusa: "este card não tem venda registrada". Fechar pela voz
 * produzia uma venda invisível. Nunca chegou a acontecer em produção — os desfechos aplicados até
 * 10/09/2026 foram `vai_pensar` e `perdeu` —, mas o caminho estava aberto.
 */
import { describe, it, expect } from 'vitest';
import { montarCarimboVenda } from '@/lib/deals/carimboVenda';

describe('montarCarimboVenda', () => {
  const base = {
    vendedorId: 'user-1',
    vendedorNome: 'Pedro Sellan',
    vendidoEm: '2026-09-10T12:00:00.000Z',
    boardIdDaVenda: 'board-1',
    funilDaVenda: 'Comercial — Consultor',
    etapaDaVenda: 'Negociação',
    valorNaVenda: 2100,
  };

  it('carimba quem vendeu, quando e de onde — o "de quem é esta venda"', () => {
    const c = montarCarimboVenda(base);
    expect(c.vendedor_id).toBe('user-1');
    expect(c.vendido_em).toBe('2026-09-10T12:00:00.000Z');
    expect(c.board_id_da_venda).toBe('board-1');
    expect(c.valor_na_venda).toBe(2100);
  });

  it('aceita o prêmio quando ele já é conhecido no fechamento', () => {
    const c = montarCarimboVenda({ ...base, premioMensal: 2100, operadora: 'Amil' });
    expect(c.premio_mensal).toBe(2100);
    expect(c.operadora).toBe('Amil');
  });

  it('sem prêmio informado, o campo fica AUSENTE — não zero', () => {
    // Zero seria uma venda de R$0 na meta do mês. Ausente é o que a pendência âmbar do card e a
    // regra "venda sem prêmio" do gestor sabem ler.
    const c = montarCarimboVenda(base);
    expect(c.premio_mensal).toBeUndefined();
    expect('premio_mensal' in c).toBe(false);
  });

  it('prêmio inválido (texto, negativo, absurdo) não entra', () => {
    expect(montarCarimboVenda({ ...base, premioMensal: -50 }).premio_mensal).toBeUndefined();
    expect(montarCarimboVenda({ ...base, premioMensal: 0 }).premio_mensal).toBeUndefined();
    expect(montarCarimboVenda({ ...base, premioMensal: 999_999 }).premio_mensal).toBeUndefined();
  });
});
