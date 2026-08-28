/**
 * @fileoverview Escolha da etapa ao mover um card entre funis.
 *
 * O move manual entre funis sempre despejava o card na PRIMEIRA etapa do destino. No
 * Comercial, a primeira etapa é "Call Agendada" — então o lead que o consultor quer apenas
 * LIGAR aterrissava como se já tivesse reunião marcada, sujando o funil e a métrica de
 * agendamentos do mês. Foi o caso da Flavia em 28/08/2026: o Denilson quis tirar da Ana e
 * telefonar, e não havia onde dizer "põe em Qualificação".
 *
 * Também centraliza a validação que faltava: etapa que não é do funil de destino cria o
 * CARD ÓRFÃO (board de um funil + etapa de outro), o mesmo defeito que engoliu o card do
 * Richard em 27/08 — aqui a escolha é conferida ANTES de qualquer escrita, e funil sem
 * etapas devolve mensagem acionável em vez de falhar em silêncio.
 *
 * @module lib/deals/moverParaFunil
 */

export interface FunilDestino {
  id: string;
  name: string;
  stages?: Array<{ id: string; name?: string; label?: string }>;
}

export type ResultadoEtapaDoMove =
  | { ok: true; stageId: string }
  | { ok: false; erro: string };

/**
 * Resolve em qual etapa o card entra no funil de destino.
 *
 * @param destino - Funil para onde o card vai, com as etapas carregadas.
 * @param escolhida - Etapa escolhida por quem está movendo. Sem ela, vale a primeira.
 */
export const resolverEtapaDoMove = (
  destino: FunilDestino,
  escolhida?: string,
): ResultadoEtapaDoMove => {
  const etapas = destino.stages ?? [];

  if (etapas.length === 0) {
    // Mensagem acionável: quem lê precisa saber o que FAZER. Antes era um throw genérico
    // que virava um toast vago — e, quando o toast passava batido, parecia "o botão não faz
    // nada".
    return {
      ok: false,
      erro: `O funil "${destino.name}" está sem etapas (ou elas não carregaram). `
        + 'Recarregue a página; se continuar, crie a etapa de entrada nas Configurações do funil.',
    };
  }

  if (escolhida) {
    const existe = etapas.some((e) => e.id === escolhida);
    if (!existe) {
      return {
        ok: false,
        erro: `A etapa escolhida não pertence a "${destino.name}". Recarregue a página e tente de novo.`,
      };
    }
    return { ok: true, stageId: escolhida };
  }

  return { ok: true, stageId: etapas[0].id };
};
