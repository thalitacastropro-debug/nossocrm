/**
 * @fileoverview Praças onde as operadoras NÃO comercializam — a lista de exceções conhecidas.
 *
 * ## Por que é uma lista de exceções, e não um mapa de cobertura
 *
 * Não existe uma lista de "onde atendemos". Palavra da Thalita em 09/09/2026:
 * *"a gente não sabe onde as operadoras não comercializam, isso é descoberto na hora da
 * cotação pelos consultores"*. Então o que dá para manter honestamente é o inverso: as praças
 * onde JÁ descobrimos, uma a uma, que não há comercialização. Tudo que não está aqui segue o
 * fluxo normal — o silêncio desta lista significa "ninguém verificou ainda", nunca "atende".
 *
 * ## O que ela evita
 *
 * O caso Gabriel Fernandes (08–09/09/2026): a Ana qualificou, ofereceu horário e marcou reunião
 * com um lead de Ourinhos-SP; o card foi para o consultor, e no dia seguinte virou perda com o
 * motivo escrito à mão *"Não há comercialização na cidade do lead."*. Lead pago, agenda do
 * consultor ocupada e uma reunião prometida que a Niva não tinha como honrar.
 *
 * ## Como a lista cresce
 *
 * O consultor descobre na cotação e avisa. Cada entrada guarda a data e COMO se soube — sem
 * procedência ninguém sabe daqui a seis meses se a informação ainda vale. E o motivo de perda
 * `fora_da_area` agenda a recontagem: 6 meses depois, o lembrete pede ao consultor que confira
 * se abriu comercialização ali (ver `REABORDAR_MESES` em lib/ai/call-outcome/routing.ts).
 *
 * @module lib/config/pracas-sem-comercializacao
 */

export interface PracaSemComercializacao {
  /** Nome da cidade como se escreve. O match ignora acento, caixa e separador. */
  praca: string;
  /** UF da praça. Homônima em outro estado NÃO é bloqueada. */
  uf: string;
  /** Desde quando sabemos (ISO, só a data). */
  desde: string;
  /** Como se descobriu — a procedência da informação. */
  como: string;
  /**
   * O que a Ana diz ao lead. Fica aqui, e não no prompt, porque é informação de negócio:
   * muda por praça e não deve depender de o modelo improvisar uma explicação.
   */
  saida: string;
}

/**
 * A saída padrão: o caminho REAL do lead é uma operadora regional, que a Niva não trabalha
 * por ser de São Paulo. Decisão da Thalita em 09/09: *"o que pode ajudar o lead é ele buscar
 * um plano regional e por isso não podemos ajudar pq somos de sp"*.
 */
const SAIDA_REGIONAL =
  'As operadoras com que a Niva trabalha não comercializam nessa região. Quem atende aí costuma '
  + 'ser operadora regional, e a Niva é de São Paulo — então não conseguimos ajudar neste caso. '
  + 'O caminho é procurar um plano regional da sua cidade.';

export const PRACAS_SEM_COMERCIALIZACAO: readonly PracaSemComercializacao[] = [
  {
    praca: 'Ourinhos',
    uf: 'SP',
    desde: '2026-09-09',
    como: 'descoberto na cotação do lead Gabriel Fernandes; o consultor descartou o card com este motivo',
    saida: SAIDA_REGIONAL,
  },
];

/** Minúsculas, sem acento, separadores viram espaço. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** UFs citadas no texto, como tokens soltos ("ourinhos sp" → ['sp']). */
function ufsNoTexto(normalizado: string): string[] {
  const UFS = new Set([
    'ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa', 'pb',
    'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to',
  ]);
  return normalizado.split(' ').filter((t) => UFS.has(t));
}

/**
 * A praça do lead está na lista de exceções?
 *
 * Casa por PALAVRA INTEIRA, nunca por substring — "Ourinhoslândia" não é Ourinhos. Se o texto
 * citar uma UF diferente da praça, não casa: cidade homônima em outro estado é outra praça, e
 * bloquear seria inventar um "não atende" que ninguém verificou.
 *
 * @param cidadeUf o campo `qualificacao.cidade_uf` como o lead informou (pode vir nulo/vazio)
 */
export function pracaSemComercializacao(
  cidadeUf: string | null | undefined,
): PracaSemComercializacao | null {
  if (!cidadeUf) return null;
  const texto = normalizar(cidadeUf);
  if (!texto) return null;

  const ufsCitadas = ufsNoTexto(texto);

  for (const p of PRACAS_SEM_COMERCIALIZACAO) {
    const alvo = normalizar(p.praca);
    const casaPalavra = new RegExp(`(^| )${alvo}( |$)`).test(texto);
    if (!casaPalavra) continue;
    // UF citada e diferente → outra cidade de mesmo nome.
    if (ufsCitadas.length > 0 && !ufsCitadas.includes(p.uf.toLowerCase())) continue;
    return p;
  }
  return null;
}
