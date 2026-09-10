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
  // A OPERADORA não comercializa na praça do lead — ele é elegível, o produto é que não chega ali.
  // Diferente de `fora_icp`, em que quem não serve é o lead (sem CNPJ, 1 vida). Nasceu do caso
  // Gabriel Fernandes (Ourinhos-SP, 09/09): o consultor descartou escrevendo o motivo à mão porque
  // nenhuma das tags servia — assim ele viraria "Outro" e sumiria do relatório. A lista de praças
  // NÃO é sabida de antemão: é descoberta na cotação, uma a uma
  // (ver lib/config/pracas-sem-comercializacao.ts).
  'fora_da_area',
  // Registro sem dado de contato: nem perda comercial, nem engano — não há ninguém do outro lado,
  // o CARD é que está vazio. A limpeza da lista fria de 22/08/2026 produziu 16 assim de uma vez
  // ("Sem telefone e sem contato vinculado — impossível reativar"). Sem esta tag eles caíam em
  // `outro`, que gera lembrete: 16 tarefas de ligar para quem não tem número, na agenda de uma
  // pessoa só. E `outro` viraria 65% do relatório de motivos, dizendo nada sobre por que a Niva
  // perde. NÃO gera reabordagem (ver `geraReabordagem`).
  'registro_invalido',
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
  fora_da_area: 'Fora da área de comercialização',
  registro_invalido: 'Registro sem contato (limpeza de base)',
  sem_resposta: 'Sem resposta / sumiu',
  timing: 'Timing (adiou)',
  reembolso: 'Reembolso',
  confianca: 'Confiança',
  decisor: 'Falta o decisor',
  burocracia: 'Burocracia',
  engano: 'Engano / número errado',
  outro: 'Outro',
};
