/**
 * @fileoverview Agrupamento de bolhas — conserta a corrida de turnos da Ana.
 *
 * ## O problema (caso Isabella, 28/08/2026)
 *
 * Cada mensagem que chega dispara um turno INDEPENDENTE: o webhook faz
 * `triggerAIProcessing` fire-and-forget por mensagem, e cada turno monta o contexto do zero.
 * Quando a pessoa escreve em bolhas — que é como gente escreve no WhatsApp — os turnos
 * correm em paralelo e nenhum sabe do outro.
 *
 * Medido no transcript da Isabella: entre 19:56:32 e 19:57:02 saíram 8 bolhas da Ana vindas
 * de pelo menos 4 turnos simultâneos. Foi por isso que "você tem plano de saúde hoje?"
 * apareceu CINCO vezes — não era a persona insistindo, eram quatro Anas perguntando ao mesmo
 * tempo. E o `response_delay_seconds` que já existe não resolve: ele roda DEPOIS do
 * `buildLeadContext`, ou seja, o contexto já foi congelado sem as bolhas novas.
 *
 * ⚠️ Isso NÃO é um problema de parente de cliente: atinge lead pago igual. Qualquer pessoa
 * que mande três mensagens seguidas dispara a mesma corrida.
 *
 * ## A regra
 *
 * Cada turno espera uma janela curta e, ao acordar, pergunta: "já existe mensagem do lead
 * mais nova que a minha?". Se existe, ele CEDE A VEZ e morre calado. Sobra exatamente um
 * turno — o da última bolha — e esse monta o contexto vendo a rajada inteira.
 *
 * Como cada turno conta a janela a partir do PRÓPRIO início, isso se comporta como uma
 * janela deslizante: bolha nova adia a resposta, e a Ana só fala quando a pessoa pausa.
 *
 * ## A checagem é DUPLA — e a segunda é de graça
 *
 * 1. **Antes de gerar**: espera a janela e cede a vez se já chegou bolha mais nova.
 * 2. **Antes de enviar**: confere de novo. A Ana leva ~3,4s pensando (mediana medida em 103
 *    respostas reais); bolha que chega nesse intervalo ainda dá tempo de engolir a resposta.
 *
 * A segunda checagem não cobra nada do lead que está esperando, e é ela que permite usar uma
 * janela CURTA com a cobertura de uma longa. Medido nas 162 rajadas reais da base (bolha após
 * bolha, sem a Ana no meio): 5s de espera pegam 36% delas; somados aos ~3,4s de geração, a
 * janela efetiva vira ~8,4s e a cobertura sobe para ~46% — a mesma de esperar 8s parado, com
 * o lead recebendo a resposta 3 segundos antes.
 *
 * Preço: quando a segunda checagem barra, a chamada ao modelo já foi paga. No volume da Niva
 * (~100 respostas/mês) isso é irrelevante perto de atropelar o lead.
 *
 * ## Por que 5 segundos
 *
 * A rota `/api/messaging/ai/process` tem `maxDuration = 60`, e desde 27/08 a extração roda
 * com `await` dentro desse mesmo orçamento (ver [[reference_crm_extracao_fire_and_forget]]).
 * 5s é ~8% do teto. O caso Isabella (28/08), que motivou isso, teve intervalos de 4, 5, 6 e 4
 * segundos entre as bolhas — cabe inteiro. Não aumentar sem medir o turno completo.
 *
 * @module lib/ai/agent/agrupamento
 */

/** Janela de espera antes de gerar. Ver "Por que 5 segundos" acima. */
export const JANELA_AGRUPAMENTO_MS = 5_000;

export interface AgrupamentoDeps {
  /** Espera N ms. Injetável para o teste não dormir de verdade. */
  esperar: (ms: number) => Promise<void>;
  /** Última mensagem do LEAD (inbound) desta conversa, ou null. */
  ultimaInbound: () => Promise<{ id: string } | null>;
  /** Sobrescreve a janela. 0 desliga o agrupamento. */
  janelaMs?: number;
}

export interface ResultadoAgrupamento {
  /** true = outro turno (mais novo) vai responder; este morre calado. */
  cedeu: boolean;
  motivo?: string;
}

/**
 * Já existe bolha do lead mais nova que a nossa? Consulta AGORA, sem esperar.
 *
 * É a segunda checagem — a de graça, feita logo antes de enviar, aproveitando o tempo que a
 * geração já consumiu. Fail-open em tudo: sem id, sem inbound ou com erro de banco, o padrão
 * é ENVIAR. Ficar mudo já matou lead nesta base; atropelar, não.
 */
export async function bolhaMaisNovaChegou(args: {
  messageId?: string;
  ultimaInbound: () => Promise<{ id: string } | null>;
}): Promise<boolean> {
  if (!args.messageId) return false;
  try {
    const ultima = await args.ultimaInbound();
    if (!ultima) return false;
    return ultima.id !== args.messageId;
  } catch (e) {
    console.error('[Agrupamento] falha ao conferir a ultima bolha, seguindo:', e);
    return false;
  }
}

export async function aguardarBolhas(args: {
  messageId?: string;
  deps: AgrupamentoDeps;
}): Promise<ResultadoAgrupamento> {
  const { messageId, deps } = args;
  const janela = deps.janelaMs ?? JANELA_AGRUPAMENTO_MS;

  // Sem id não dá para comparar quem é o mais novo. Responder na hora é melhor do que
  // atrasar toda mensagem por uma comparação que não vai acontecer.
  if (!messageId) return { cedeu: false };
  if (janela <= 0) return { cedeu: false };

  await deps.esperar(janela);

  // A consulta vem DEPOIS da espera de propósito: é justamente durante a espera que as
  // outras bolhas chegam. Consultar antes não agruparia nada.
  const cedeu = await bolhaMaisNovaChegou({ messageId, ultimaInbound: deps.ultimaInbound });
  return cedeu
    ? { cedeu: true, motivo: 'Chegou mensagem mais nova do lead — outro turno responde' }
    : { cedeu: false };
}
