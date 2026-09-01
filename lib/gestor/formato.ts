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
 * 3. **Sem o acumulado do time.** O número global é leitura de dona; para quem
 *    executa, ele só produz sensação de dívida impagável.
 *
 * Dia sem nada devolve `null` — mandar "você não tem pendências" todo dia é o
 * jeito mais rápido de a pessoa parar de ler o que importa.
 */
export function formatarParaColaborador(diario: Diario, donoId: string): string | null {
  const meus: Array<{ regra: Regra; item: ItemAlerta }> = [];
  for (const regra of diario.regras) {
    if (regra.sigiloso) continue;
    for (const item of regra.novos) if (item.donoId === donoId) meus.push({ regra, item });
  }
  if (meus.length === 0) return null;

  const linhas = [`<b>Seu dia — ${esc(diario.data)}</b>`, ''];
  for (const { regra, item } of meus) {
    linhas.push(`${regra.emoji} <b>${esc(item.contato)}</b> — ${esc(item.detalhe)} (${idadeLegivel(item.idadeHoras)})`);
  }
  linhas.push('', '<i>Responder ou registrar o desfecho no card já tira daqui.</i>');

  const texto = linhas.join('\n');
  return texto.length > MAX_TELEGRAM ? `${texto.slice(0, MAX_TELEGRAM)}\n…` : texto;
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
