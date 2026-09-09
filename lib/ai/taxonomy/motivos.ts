/**
 * Taxonomia unificada de objeções e motivos de perda — usada pela Ana (qualificação)
 * E pelo consultor (desfecho da call), pra o relatório agregar o funil inteiro.
 * Decisão da Thalita: "preço" NÃO é tag — vira `sem_oportunidade`.
 */
import { z } from 'zod';

export const MOTIVO_TAGS = [
  'sem_oportunidade', // lead sem fit/budget real (inclui "achou caro")
  'ficou_na_atual',   // inércia/medo de trocar
  'carencia',
  'rede',             // hospital/médico fora
  'concorrente',
  'fora_icp',         // sem CNPJ/inelegível
  'sem_resposta',     // sumiu
  'timing',           // adiou
  'reembolso',
  'confianca',
  'decisor',          // precisa consultar sócio/cônjuge
  'burocracia',
  // Não é lead: número errado, engano, alguém procurando outra pessoa. Existe porque a Ana atende
  // TODO inbound desconhecido do WhatsApp da Niva — caso Natália Palmeira (02/09), que escreveu
  // "Não é a Manu?" e mesmo assim continuou recebendo oferta no dia seguinte. É o único motivo que
  // NÃO gera lembrete de reabordagem: reabordar número errado daqui a um ano é incomodar um
  // estranho duas vezes. Ver `geraReabordagem` em lib/ai/call-outcome/routing.ts.
  'engano',
  'outro',
] as const;

export type MotivoTag = (typeof MOTIVO_TAGS)[number];

export const MotivoTagSchema = z.enum(MOTIVO_TAGS);

export const MOTIVO_LABELS: Record<MotivoTag, string> = {
  sem_oportunidade: 'Sem oportunidade (fit/budget)',
  ficou_na_atual: 'Ficou no plano atual',
  carencia: 'Carência',
  rede: 'Rede (hospital/médico)',
  concorrente: 'Foi pro concorrente',
  fora_icp: 'Fora do ICP',
  sem_resposta: 'Sem resposta / sumiu',
  timing: 'Timing (adiou)',
  reembolso: 'Reembolso',
  confianca: 'Confiança',
  decisor: 'Falta o decisor',
  burocracia: 'Burocracia',
  engano: 'Engano / número errado',
  outro: 'Outro',
};
