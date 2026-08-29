/**
 * @fileoverview Quando o lead pede para falar com gente — e quando ele avisa que JÁ está
 * sendo atendido.
 *
 * ## Por que isto existe
 *
 * Caso Isabella (28/08/2026). Ela escreveu, nesta ordem: "Me liguem então" → "por favor" →
 * **"ME LIGAR"** em caixa alta → "Aguardo ligação do DENILSON" → "Já tratado com ele".
 * **Nada disso disparou coisa nenhuma** e a Ana seguiu perguntando se ela tinha plano de
 * saúde. A lista configurada no board era só
 * `["atendente","falar com humano","falar com alguém","reclamação","reclamacao"]` —
 * e a comparação era `includes` cru, sem tirar acento.
 *
 * ## São DOIS pedidos, com desfechos diferentes
 *
 * | O lead diz | O que ele quer | O que fazer |
 * |---|---|---|
 * | "me liga", "quero falar com o consultor" | ser atendido por gente | **handoff completo** — move o card pro funil do Consultor |
 * | "já falei com o Denilson", "aguardo a ligação dele" | que o bot PARE, já tem dono | **só pausa** a conversa |
 *
 * Misturar os dois seria caro: `handleHandoff` MOVE o card, e mandar para o funil de vendas
 * todo parente de cliente e toda secretária que escreve "já tratado com ele" transforma o
 * Comercial em depósito. Por isso a segunda categoria existe separada.
 *
 * ## Casamento por FRASE, com fronteira de palavra
 *
 * `includes` cru em palavra solta gera falso positivo caro: "ligar" casa dentro de
 * "des**ligar**" e "re**ligar**". Aqui tudo é normalizado (minúscula + sem acento, porque
 * ninguém acentua no celular) e comparado com fronteira de palavra.
 *
 * @module lib/ai/agent/escalacao
 */

/** Minúscula e sem acento — "Falar com ALGUÉM" e "falar com alguem" são a mesma coisa. */
export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * O lead quer falar com gente. Desfecho: handoff completo (o card muda de mão).
 *
 * Frases, não palavras soltas: "ligar" sozinho casaria com "desligar".
 */
export const PEDIDOS_DE_HUMANO: readonly string[] = [
  // as formas de "me liga" — inclusive a plural, que foi a que a Isabella usou
  'me liga', 'me ligar', 'me liguem', 'me ligue', 'liga pra mim', 'ligue para mim',
  'liga para mim', 'me telefona', 'me chama no telefone', 'pode ligar', 'podem ligar',
  // preferência explícita por voz
  'falar por telefone', 'prefiro ligar', 'melhor por telefone', 'atende no telefone',
  // pedido explícito de gente (a família "falar com ..." é tratada por padrão, abaixo)
  'tem alguem ai', 'tem alguem ae', 'quero falar com voces',
  // insatisfação — já estava na config do board, fica aqui para não depender dela
  'reclamacao', 'quero reclamar',
];

/**
 * A família "falar com {alguém}".
 *
 * Enumerar frase por frase aqui é armadilha: "falar com humano" não casa "falar com **um**
 * humano", que foi o que quebrou no primeiro teste. O artigo é opcional por padrão, e o verbo
 * também varia (falar/conversar/atender).
 */
const PADROES_FALAR_COM: readonly RegExp[] = [
  /\b(falar|conversar|atendimento|atendido)\s+(com\s+)?(um |uma |o |a |algum |alguma )?(humano|pessoa|atendente|consultor|corretor|gerente|responsavel|equipe|especialista)\b/,
  /\bfalar\s+com\s+alguem\b/,
];

/**
 * A pessoa avisa que JÁ está sendo atendida por alguém da casa.
 * Desfecho: pausar a Ana. **Não mover o card** — quase sempre não é lead novo.
 */
export const JA_ATENDIDO: readonly string[] = [
  'ja falei com', 'ja conversei com', 'ja estou falando com', 'ja to falando com',
  'ja tratado', 'ja resolvi com', 'ja acertei com', 'ja combinei com',
  'aguardo ligacao', 'aguardo o retorno', 'aguardo retorno', 'estou aguardando a ligacao',
  'ja fui atendido', 'ja fui atendida', 'ja estou sendo atendido', 'ja estou sendo atendida',
];

/** Escapa o que for meta-caractere de regex na frase. */
function escapar(frase: string): string {
  return frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A frase aparece no texto com fronteira de palavra?
 *
 * `\W` não serve como fronteira aqui porque o texto já vem sem acento, mas serve como
 * "não é letra/dígito" — que é exatamente o que separa "ligar" de "desligar".
 */
function contemFrase(textoNormalizado: string, frase: string): boolean {
  const re = new RegExp(`(^|[^a-z0-9])${escapar(frase)}([^a-z0-9]|$)`);
  return re.test(textoNormalizado);
}

function procurar(mensagem: string, frases: readonly string[]): string | null {
  const texto = normalizarTexto(mensagem);
  for (const frase of frases) {
    if (contemFrase(texto, normalizarTexto(frase))) return frase;
  }
  return null;
}

/**
 * O lead está pedindo atendimento humano?
 *
 * @param extras palavras configuradas no board/etapa. SOMAM à lista embutida — a config da
 *   organização nunca deixa de valer, só deixa de ser a única defesa.
 */
export function detectarPedidoDeHumano(
  mensagem: string,
  extras?: string[] | null
): string | null {
  const configuradas = Array.isArray(extras) ? extras : [];
  const porFrase = procurar(mensagem, [...PEDIDOS_DE_HUMANO, ...configuradas]);
  if (porFrase) return porFrase;

  const texto = normalizarTexto(mensagem);
  for (const padrao of PADROES_FALAR_COM) {
    const achado = texto.match(padrao);
    if (achado) return achado[0].trim();
  }
  return null;
}

/** A pessoa está dizendo que já tem alguém cuidando dela? */
export function detectarJaAtendido(mensagem: string): string | null {
  return procurar(mensagem, JA_ATENDIDO);
}

/**
 * O que a pausa precisa fazer no mundo. Injetado para o teste não tocar em banco nem Telegram.
 */
export interface PausaDeps {
  /** `messaging_conversations.metadata.ai_paused = true` (sem TTL, ao contrário da pausa de contato). */
  marcarPausa: () => Promise<void>;
  registrarNaTimeline: (texto: string) => Promise<void>;
  avisar: (texto: string) => Promise<void>;
}

/**
 * A pessoa disse que já está sendo atendida: cala a Ana e chama gente — **sem mover o card**.
 *
 * A ordem importa. Pausar é o que protege o lead do constrangimento, então é a primeira coisa
 * e a única que decide o resultado; timeline e aviso são best-effort. Aviso que falha não pode
 * deixar a Ana solta em cima de quem pediu para ela parar.
 */
export async function pausarPorJaAtendido(args: {
  gatilho: string;
  contatoNome: string | null;
  deps: PausaDeps;
}): Promise<{ pausou: boolean }> {
  const { gatilho, contatoNome, deps } = args;
  const quem = contatoNome ?? 'Contato sem nome';

  try {
    await deps.marcarPausa();
  } catch (e) {
    console.error('[Escalacao] falha ao pausar a conversa:', e);
    return { pausou: false };
  }

  const nota = `Ana pausada: a pessoa avisou que já está sendo atendida ("${gatilho}").`;
  await deps.registrarNaTimeline(nota).catch((e) =>
    console.error('[Escalacao] nota na timeline falhou (nao-fatal):', e)
  );
  await deps
    .avisar(
      [
        '🤝 <b>Ana pausada — a pessoa já está sendo atendida</b>',
        '',
        `👤 <b>Contato:</b> ${quem}`,
        `💬 <b>Ela disse:</b> "${gatilho}"`,
        '',
        'O card NÃO foi movido: quem escreve isso quase nunca é lead novo (costuma ser',
        'familiar, sócio ou secretária de um caso que já existe). Assuma a conversa por aí.',
      ].join('\n')
    )
    .catch((e) => console.error('[Escalacao] aviso falhou (nao-fatal):', e));

  return { pausou: true };
}
