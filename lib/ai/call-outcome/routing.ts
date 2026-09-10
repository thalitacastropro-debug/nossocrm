/**
 * Roteamento puro do desfecho → board/stage/flag + fallback de reabordagem (§6/§6.1).
 */
import type { Desfecho } from './schemas';
import type { MotivoTag } from '@/lib/ai/taxonomy/motivos';
import {
  IMPLANTACAO_ADM_BOARD_ID, IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID,
  NUTRICAO_REATIVACAO_BOARD_ID, NUTRICAO_RECONTATO_STAGE_ID, NEGOCIACAO_STAGE_ID,
} from '@/lib/config/boards';

export interface Route {
  boardId?: string;      // undefined = mesmo board
  stageId?: string;      // undefined = não move
  mark: 'won' | 'lost' | null;
  reabordagem: boolean;  // true = criar lembrete de reabordagem
}

export function routeForDesfecho(desfecho: Desfecho['desfecho']): Route {
  switch (desfecho) {
    case 'fechou':
      return { boardId: IMPLANTACAO_ADM_BOARD_ID, stageId: IMPLANTACAO_AGUARDANDO_DOC_STAGE_ID, mark: 'won', reabordagem: false };
    case 'perdeu':
      return { boardId: NUTRICAO_REATIVACAO_BOARD_ID, stageId: NUTRICAO_RECONTATO_STAGE_ID, mark: 'lost', reabordagem: true };
    case 'vai_pensar':
      return { stageId: NEGOCIACAO_STAGE_ID, mark: null, reabordagem: false };
    default: // remarcar, nao_atendeu
      return { mark: null, reabordagem: false };
  }
}

// Fallback de meses por motivo (§6.1). A IA prioriza o sinal real (reabordar_em do schema).
const REABORDAR_MESES: Record<MotivoTag, number> = {
  sem_oportunidade: 6,
  ficou_na_atual: 11,
  carencia: 3,
  rede: 6,
  concorrente: 12,
  timing: 1,
  reembolso: 6,
  confianca: 2,
  burocracia: 1,
  sem_resposta: 1,
  fora_icp: 0, // nunca usado: `geraReabordagem` barra antes (o tempo não muda a elegibilidade)
  registro_invalido: 0, // nunca usado: `geraReabordagem` barra antes (não há telefone para ligar)
  // 6 meses. Este lembrete é a RECHECAGEM da praça, não uma reabordagem comum: quando ele vencer,
  // o consultor confere se alguma operadora passou a comercializar ali (pedido da Thalita, 09/09 —
  // "de tempos em tempos pedir pro consultor checar se abriu comercialização"). Abertura de praça
  // é evento lento; mais curto que isso só entulha a agenda com uma pergunta cuja resposta não
  // mudou. Se abriu, o lead volta pro jogo; se não, o consultor adia de novo.
  fora_da_area: 6,
  decisor: 0, // tratado como +2 semanas abaixo
  engano: 0, // nunca usado: `geraReabordagem` barra antes (não é lead)
  outro: 3,
};

/**
 * Este motivo merece lembrete de reabordagem?
 *
 * Regra da Thalita (09/09): todo lead que vai pra perdido leva lembrete pro futuro — **menos**
 * quem nunca foi lead. Três casos ficam de fora:
 *  - `engano`: número errado / procurava outra pessoa. Reabordar é incomodar um estranho de novo.
 *  - `fora_icp`: quem não é comprador. Sem CNPJ e sem intenção de abrir, plano individual — e
 *    também o curioso que só especula. Uma corretora de seguros "pesquisando" tem CNPJ e é
 *    elegível no papel, mas nunca vai comprar; reabordá-la é dar cotação de graça para a
 *    concorrência. O tempo não muda nada disso.
 *  - `registro_invalido`: card sem telefone e sem contato vinculado. Não existe a quem ligar, então
 *    o lembrete nasce como tarefa impossível — e é o pior tipo, porque vem em lote (16 de uma vez
 *    na limpeza de 22/08/2026).
 *
 * Importa porque "Descartado" no funil da Ana serve para perda comercial E para engano: sem esta
 * separação, um número errado ganharia tarefa de ligação para o ano que vem. E agenda cheia de
 * lixo é agenda ignorada — o que mataria justamente os lembretes que valem.
 */
export function geraReabordagem(motivo: MotivoTag): boolean {
  return motivo !== 'engano' && motivo !== 'fora_icp' && motivo !== 'registro_invalido';
}

/**
 * Cria o lembrete? A pergunta completa — o motivo permite E existe a quem ligar.
 *
 * `geraReabordagem` responde só pela primeira metade. A limpeza da lista fria de 22/08/2026 expôs a
 * segunda: 16 cards com `contact_id` nulo, "sem telefone e sem contato vinculado". Qualquer motivo
 * comercial num card desses produz uma tarefa de ligar para ninguém — e produz em LOTE, na agenda de
 * uma pessoa só. Tarefa impossível não é apenas inútil: é o que faz a pessoa desistir de olhar a
 * lista, e aí morrem junto os lembretes que valiam.
 *
 * Fica aqui, e não dentro do hook da tela, porque é a mesma decisão nos dois caminhos que criam
 * reabordagem (o move manual e o desfecho por áudio) e porque assim dá para testar sem React.
 */
export function deveCriarLembrete(motivo: MotivoTag, temContato: boolean): boolean {
  return geraReabordagem(motivo) && temContato;
}

export function reabordarEmFallback(motivo: MotivoTag, now: Date): string {
  const d = new Date(now.getTime());
  if (motivo === 'decisor') {
    d.setUTCDate(d.getUTCDate() + 14);
    return d.toISOString();
  }
  d.setUTCMonth(d.getUTCMonth() + REABORDAR_MESES[motivo]);
  return d.toISOString();
}
