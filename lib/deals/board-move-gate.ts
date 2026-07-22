import { CONSULTOR_BOARD_ID } from '@/lib/config/boards';

interface QualForGate {
  tem_cnpj?: string | null;
  vidas?: number | null;
  idades?: number[] | null;
  tem_plano_atual?: string | null;
  cidade_uf?: string | null;
}

/**
 * Portão de dados pra mover um card ENTRE FUNIS (feature de move manual).
 *
 * Regra (Thalita, caso Mavi): só o funil do **Consultor** tem portão. Pra entrar
 * nele, o card precisa do núcleo de qualificação + reunião confirmada — senão o
 * consultor recebe um lead incompleto. Qualquer outro funil não tem portão.
 *
 * Retorna a lista do que ainda FALTA (vazia = pode mover sem aviso). NÃO bloqueia:
 * quem decide é a UI (avisa e deixa mover). Aqui só computamos o "falta".
 */
export function missingForBoardMove(
  targetBoardId: string,
  customFields?: Record<string, unknown> | null,
): string[] {
  if (targetBoardId !== CONSULTOR_BOARD_ID) return [];

  const cf = customFields ?? {};
  const q = (cf.qualificacao ?? {}) as QualForGate;
  const missing: string[] = [];

  // Plano atual (tem/não) — precisa estar definido.
  if (q.tem_plano_atual !== 'sim' && q.tem_plano_atual !== 'nao') {
    missing.push('plano atual (tem/não)');
  }

  // Nº de vidas / idades.
  const idades = Array.isArray(q.idades) ? q.idades.filter((n) => typeof n === 'number') : [];
  const temVidas = (typeof q.vidas === 'number' && q.vidas > 0) || idades.length > 0;
  if (!temVidas) missing.push('nº de vidas / idades');

  // CNPJ (PME/MEI/não) — 'desconhecido' ou vazio não conta.
  if (!q.tem_cnpj || q.tem_cnpj === 'desconhecido') {
    missing.push('CNPJ (PME/MEI/não)');
  }

  // Cidade.
  if (!q.cidade_uf || String(q.cidade_uf).trim() === '') {
    missing.push('cidade');
  }

  // Reunião confirmada (o funil do Consultor é pós-agendamento).
  const ra = cf.reuniao_agendada as { status?: string } | undefined;
  const reuniaoOk = ra?.status === 'confirmada' || ra?.status === 'confirmed';
  if (!reuniaoOk) missing.push('reunião confirmada');

  return missing;
}
