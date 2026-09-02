/**
 * @fileoverview Monta o texto do diário para o Telegram, agrupado POR COLABORADOR.
 *
 * Decisão da Thalita em 31/08/2026: *"um relatório por colaborador, e eu recebo
 * tudo"*. Então o corpo do relatório é dividido por pessoa — é assim que ela
 * roda a daily. Enquanto não existir canal individual (ninguém tem telefone no
 * perfil hoje), o relatório inteiro vai para ela, já no formato certo para
 * quando cada um passar a receber o próprio bloco.
 *
 * Regras de escrita que valem aqui:
 * - **Nada de métrica sem lastro.** Sem taxa de comparecimento, sem conversão:
 *   com 7 reuniões no mês, uma a mais move a "taxa" em 33 pontos.
 * - **Só o que mudou vai listado**; o resto vai como número. Alerta que repete
 *   a mesma lista toda manhã deixa de ser lido na segunda semana.
 * - **Nada de acusação.** O texto diz o que FALTA, não o que a pessoa fez de
 *   errado — o campo carimbado não carrega prova nenhuma, então o relatório não
 *   tem como saber quem trabalhou e quem só clicou.
 *
 * @module lib/gestor/formato
 */

import { idadeLegivel, type Diario, type ItemAlerta, type Regra } from './regras';

/** Limite do Telegram é 4096; deixamos folga para o rodapé. */
const MAX_TELEGRAM = 3900;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param paraDona  `true` inclui as regras sigilosas (contradição). O bloco de
 *                  cada colaborador nunca as inclui quando for para ele.
 */
export function formatarDiario(diario: Diario, paraDona: boolean): string {
  const linhas: string[] = [];
  const regras = diario.regras.filter((r) => paraDona || !r.sigiloso);

  linhas.push(`<b>Diário comercial — ${esc(diario.data)}</b>`);

  const p = diario.ontem;
  linhas.push(
    `Ontem: ${p.mensagensDeLead} ${p.mensagensDeLead === 1 ? 'mensagem de lead' : 'mensagens de lead'} · ` +
    `${p.notasEscritas} ${p.notasEscritas === 1 ? 'nota escrita' : 'notas escritas'} · ` +
    `${p.reunioesMarcadas} ${p.reunioesMarcadas === 1 ? 'reunião marcada' : 'reuniões marcadas'}`,
  );

  // --- por colaborador (é assim que ela faz a daily)
  const porPessoa = agruparPorPessoa(regras);
  const temAlgo = porPessoa.size > 0;

  for (const [nome, itens] of porPessoa) {
    linhas.push('', `<b>${esc(nome)}</b>`);
    for (const { regra, item } of itens) {
      linhas.push(`${regra.emoji} ${esc(item.contato)} — ${esc(item.detalhe)} (${idadeLegivel(item.idadeHoras)})`);
    }
  }

  // --- o estoque, só como número: o que não mudou não vira lista
  const estoque = regras.filter((r) => r.estoque > r.novos.length);
  if (estoque.length) {
    linhas.push('', '<i>Acumulado (sem novidade desde ontem):</i>');
    for (const r of estoque) linhas.push(`· ${esc(r.titulo)}: ${r.estoque}`);
  }

  if (!temAlgo) {
    linhas.push('', 'Nada novo para cobrar hoje. O acumulado abaixo continua de pé.');
  }

  const texto = linhas.join('\n');
  return texto.length > MAX_TELEGRAM ? `${texto.slice(0, MAX_TELEGRAM)}\n…` : texto;
}

/**
 * O diário de UMA pessoa — o que o Denilson ou o Pedro recebe no próprio
 * celular.
 *
 * Três diferenças em relação ao da dona, e todas são de propósito:
 * 1. **Só o que é dele.** Ninguém recebe a lista do colega: a daily é sobre o
 *    trabalho de quem está lendo, não sobre comparação entre pessoas.
 * 2. **Sem as regras sigilosas.** A contradição nunca sai daqui (decisão da
 *    Thalita em 31/08). Se saísse, o efeito previsível seria o time aprender a
 *    espaçar os cliques, não a preencher melhor.
 * 3. **Sem o acumulado do TIME** — mas COM o acumulado dele.
 *
 * ⚠️ O item 3 nasceu errado e foi corrigido em 31/08, quando a Thalita
 * perguntou se o Pedro só tinha aquela pendência. Tinha 20. E pior: o bloco do
 * **Denilson não apareceu**, mesmo com 10 reuniões vencidas e 1 contradição —
 * porque nenhuma era "nova desde ontem". Do jeito original, quem carregava a
 * maior dívida do time podia ficar semanas invisível.
 *
 * A distinção certa não é "com número x sem número", é DE QUEM é o número: o
 * total do time não é acionável por quem executa e só produz sensação de dívida
 * impagável; o total DELE é o trabalho dele.
 *
 * Por isso `null` (não mandar nada) só acontece quando a pessoa não tem NEM
 * novidade NEM acumulado. Mandar "você está em dia" todo dia é o jeito mais
 * rápido de a pessoa parar de ler; esconder 10 pendências é pior.
 */
export interface OpcoesDoColaborador {
  /**
   * Acrescenta a visão da equipe abaixo do bloco pessoal.
   *
   * Pedido da Thalita em 02/09/2026: *"a cobrança do Denilson é diferente por
   * ele ser o responsável pelo Pedro"*. Quem cobra precisa chegar na daily
   * sabendo o que o outro tem em aberto — senão a conversa começa perguntando
   * o que o relatório já sabia.
   *
   * Continua SEM as regras sigilosas: a contradição é só da dona. Um gestor que
   * a recebesse ensinaria o time a espaçar cliques, não a preencher melhor.
   */
  ehGestor?: boolean;
}

export function formatarParaColaborador(
  diario: Diario,
  donoId: string,
  opts: OpcoesDoColaborador = {},
): string | null {
  const meus: Array<{ regra: Regra; item: ItemAlerta }> = [];
  const meuEstoque: Array<{ regra: Regra; quantos: number }> = [];

  for (const regra of diario.regras) {
    if (regra.sigiloso) continue;
    for (const item of regra.novos) if (item.donoId === donoId) meus.push({ regra, item });

    // Acumulado DELE: o total da regra menos o que já foi listado como novidade
    // dele. `estoquePorDono` vem preenchido pelas regras que sabem contar por
    // pessoa; sem ele, não inventamos número.
    const quantos = regra.estoquePorDono?.[donoId] ?? 0;
    const novosDele = regra.novos.filter((i) => i.donoId === donoId).length;
    if (quantos > novosDele) meuEstoque.push({ regra, quantos });
  }

  const equipe = opts.ehGestor ? blocoDaEquipe(diario, donoId) : [];

  if (meus.length === 0 && meuEstoque.length === 0 && equipe.length === 0) return null;

  const linhas = [`<b>Seu dia — ${esc(diario.data)}</b>`, ''];

  if (meus.length) {
    linhas.push('<b>Suas prioridades de hoje, nesta ordem:</b>', '');
    meus.forEach(({ regra, item }, i) => {
      linhas.push(
        `${i + 1}. ${regra.emoji} <b>${esc(item.contato)}</b> — ${esc(item.detalhe)} (${idadeLegivel(item.idadeHoras)})`,
      );
      // A ação é o que separa "alerta" de "tarefa": sem ela a pessoa entende o
      // problema e ainda tem que adivinhar qual gesto encerra o item.
      if (regra.acao) linhas.push(`    ↳ ${esc(regra.acao)}`);
    });
  } else {
    linhas.push('Nada novo entrou desde ontem.');
  }

  if (meuEstoque.length) {
    linhas.push('', '<i>Ainda em aberto com você:</i>');
    for (const { regra, quantos } of meuEstoque) linhas.push(`· ${esc(regra.titulo)}: ${quantos}`);
  }

  if (equipe.length) linhas.push('', ...equipe);

  linhas.push('', COMO_FUNCIONA);

  const texto = linhas.join('\n');
  return texto.length > MAX_TELEGRAM ? `${texto.slice(0, MAX_TELEGRAM)}\n…` : texto;
}

/**
 * O contrato, escrito. Responde "por que estou recebendo isto?" e deixa claro
 * que a cobrança é sobre o REGISTRO, não sobre a palavra de ninguém — pedido da
 * Thalita em 02/09/2026. Sem esta linha o relatório parece vigilância; com ela,
 * parece regra do jogo, que é o que ele é.
 */
const COMO_FUNCIONA =
  '<i>Como esta lista funciona: ela é montada todo dia às 8h a partir do que está no CRM — ' +
  'ninguém escreve à mão. Cada item sai daqui sozinho quando você responde a mensagem ou ' +
  'registra o desfecho no card. O que não estiver registrado continua aparecendo, porque ' +
  'para o sistema ele não aconteceu.</i>';

/** O que a equipe do gestor tem em aberto — nome no que é novo, número no resto. */
function blocoDaEquipe(diario: Diario, gestorId: string): string[] {
  const novosDeOutros: Array<{ regra: Regra; item: ItemAlerta }> = [];
  for (const regra of diario.regras) {
    if (regra.sigiloso) continue;
    for (const item of regra.novos) {
      if (item.donoId && item.donoId !== gestorId) novosDeOutros.push({ regra, item });
    }
  }

  // Acumulado de cada um, para o gestor saber o TAMANHO da dívida que vai
  // cobrar — e não só o que apareceu ontem. Foi assim que o Denilson ficou
  // invisível na primeira versão do relatório individual.
  const estoqueDeOutros = new Map<string, Array<{ titulo: string; quantos: number }>>();
  for (const regra of diario.regras) {
    if (regra.sigiloso || !regra.estoquePorDono) continue;
    for (const [id, quantos] of Object.entries(regra.estoquePorDono)) {
      if (id === gestorId || id === 'sem-dono' || quantos === 0) continue;
      const nome = nomeDoDono(diario, id);
      if (!nome) continue;
      if (!estoqueDeOutros.has(nome)) estoqueDeOutros.set(nome, []);
      estoqueDeOutros.get(nome)!.push({ titulo: regra.titulo, quantos });
    }
  }

  if (novosDeOutros.length === 0 && estoqueDeOutros.size === 0) return [];

  const linhas = ['<b>Sua equipe</b>'];

  for (const { regra, item } of novosDeOutros) {
    linhas.push(
      `${regra.emoji} ${esc(item.donoNome)} · <b>${esc(item.contato)}</b> — ${esc(item.detalhe)} (${idadeLegivel(item.idadeHoras)})`,
    );
  }

  for (const [nome, itens] of estoqueDeOutros) {
    linhas.push('', `<i>Em aberto com ${esc(nome)}:</i>`);
    for (const { titulo, quantos } of itens) linhas.push(`· ${esc(titulo)}: ${quantos}`);
  }

  return linhas;
}

/**
 * Nome de um dono a partir dos itens já montados. O `Diario` não carrega a
 * tabela de perfis, e escrever um id cru no texto ("em aberto com a3f9…") seria
 * pior que omitir — então quem não aparece em item nenhum fica de fora do
 * acumulado da equipe.
 */
function nomeDoDono(diario: Diario, donoId: string): string | null {
  for (const regra of diario.regras) {
    for (const item of regra.novos) if (item.donoId === donoId) return item.donoNome;
  }
  return null;
}

/**
 * Agrupa os itens por dono, preservando a regra de cada um. Sem dono vira
 * "Sem dono" — e cai no fim, porque é pendência da casa, não de uma pessoa.
 */
function agruparPorPessoa(regras: Regra[]): Map<string, Array<{ regra: Regra; item: ItemAlerta }>> {
  const mapa = new Map<string, Array<{ regra: Regra; item: ItemAlerta }>>();
  for (const regra of regras) {
    for (const item of regra.novos) {
      const chave = item.donoNome;
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push({ regra, item });
    }
  }
  // "Técnico" e "Sem dono" por último: não são cobrança de pessoa.
  const peso = (n: string) => (n === 'Técnico' ? 2 : n === 'Sem dono' ? 1 : 0);
  return new Map([...mapa.entries()].sort((a, b) => peso(a[0]) - peso(b[0]) || a[0].localeCompare(b[0])));
}
