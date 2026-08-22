import type { Activity } from '@/types';

/**
 * Ordenação inteligente de atividades seguindo padrão de mercado para CRMs:
 * 1. Atrasadas (data < hoje) - mais antigas primeiro (mais urgente)
 * 2. Hoje (data === hoje) - mais próximas primeiro
 * 3. Futuras (data > hoje) - mais próximas primeiro
 * 
 * @param activities - Array de atividades para ordenar
 * @returns Array ordenado
 */
export function sortActivitiesSmart(activities: Activity[]): Activity[] {
  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Separa em grupos
  const overdue: Activity[] = [];
  const todayActivities: Activity[] = [];
  const future: Activity[] = [];
  
  activities.forEach(activity => {
    const activityDate = new Date(activity.date);
    const activityDateOnly = new Date(activityDate.getFullYear(), activityDate.getMonth(), activityDate.getDate());
    
    if (activityDateOnly < todayDate) {
      overdue.push(activity);
    } else if (activityDateOnly.getTime() === todayDate.getTime()) {
      todayActivities.push(activity);
    } else {
      future.push(activity);
    }
  });
  
  // Ordena cada grupo
  // Atrasadas: mais antigas primeiro (crescente) = mais urgente
  overdue.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Hoje: ordena por hora (mais próximas primeiro)
  todayActivities.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Futuras: mais próximas primeiro (crescente)
  future.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Retorna: atrasadas + hoje + futuras
  return [...overdue, ...todayActivities, ...future];
}


/**
 * Ordenação da TIMELINE DE UM CARD: mais recente primeiro.
 *
 * Por que não usar `sortActivitiesSmart` aqui: aquela ordenação foi escrita para a
 * LISTA DE TAREFAS (atrasadas primeiro, porque o que venceu é o mais urgente de
 * resolver). Numa timeline de card a leitura é outra — a pessoa quer ver o que
 * acabou de acontecer. Com a ordenação de tarefas, uma nota escrita agora caía
 * DEPOIS de tudo, no rodapé, fora da área visível: foi exatamente por isso que a
 * nota do Pedro pareceu não existir mesmo já estando gravada e já sendo exibida.
 *
 * Mantemos as duas funções separadas de propósito: inverter `sortActivitiesSmart`
 * consertaria a timeline e quebraria a página Atividades.
 *
 * @param activities - Atividades já filtradas por deal.
 * @returns Novo array, da mais recente para a mais antiga. Datas inválidas vão para o fim.
 */
export function sortActivitiesTimeline(activities: Activity[]): Activity[] {
  const tempo = (a: Activity) => {
    const t = new Date(a.date).getTime();
    return Number.isNaN(t) ? -Infinity : t; // data quebrada não disputa o topo
  };

  return [...activities].sort((a, b) => tempo(b) - tempo(a));
}
