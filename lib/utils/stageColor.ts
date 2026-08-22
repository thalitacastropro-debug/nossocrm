/**
 * Cor da etapa do board — ponte entre o que está gravado e o que a UI precisa.
 *
 * Contexto: `board_stages.color` guarda HEX no banco (`#6366f1`), mas o Kanban
 * usava esse valor direto como classe do Tailwind (`className={...${stage.color}}`).
 * Classe inválida = nenhuma cor. Na prática NENHUMA etapa mostrava cor.
 *
 * Como o Tailwind só gera as classes que consegue ver no código-fonte, cor vinda
 * do banco não pode virar classe: tem que virar estilo inline. É o que estas
 * funções entregam — aceitando tanto o hex atual quanto as classes legadas.
 */

/** Classes Tailwind que podem estar gravadas em bases antigas. */
const CLASSE_PARA_HEX: Record<string, string> = {
  'bg-gray-500': '#6b7280',
  'bg-slate-500': '#64748b',
  'bg-red-500': '#ef4444',
  'bg-orange-500': '#f97316',
  'bg-amber-500': '#f59e0b',
  'bg-yellow-500': '#eab308',
  'bg-green-500': '#22c55e',
  'bg-emerald-500': '#10b981',
  'bg-teal-500': '#14b8a6',
  'bg-cyan-500': '#06b6d4',
  'bg-sky-500': '#0ea5e9',
  'bg-blue-500': '#3b82f6',
  'bg-indigo-500': '#6366f1',
  'bg-violet-500': '#8b5cf6',
  'bg-purple-500': '#a855f7',
  'bg-pink-500': '#ec4899',
  'bg-rose-500': '#f43f5e',
};

/** Cinza neutro: etapa sem cor não pode ficar invisível. */
const PADRAO = '#6b7280';

/**
 * Devolve sempre um hex válido para a cor de uma etapa.
 *
 * @param color - valor gravado em `board_stages.color` (hex ou classe Tailwind).
 */
export function stageAccentHex(color?: string | null): string {
  const bruto = (color ?? '').trim().toLowerCase();
  if (!bruto) return PADRAO;

  if (bruto.startsWith('#')) {
    const digitos = bruto.slice(1);
    if (/^[0-9a-f]{6}$/.test(digitos)) return `#${digitos}`;
    if (/^[0-9a-f]{3}$/.test(digitos)) {
      return `#${digitos[0]}${digitos[0]}${digitos[1]}${digitos[1]}${digitos[2]}${digitos[2]}`;
    }
    return PADRAO;
  }

  return CLASSE_PARA_HEX[bruto] ?? PADRAO;
}

/**
 * Mesma cor, com transparência — para tingir fundo de coluna sem apagar o texto.
 *
 * @param hex - hex de 6 dígitos (use `stageAccentHex` antes).
 * @param alpha - 0 a 1.
 */
export function withAlpha(hex: string, alpha: number): string {
  const d = stageAccentHex(hex).slice(1);
  const r = parseInt(d.slice(0, 2), 16);
  const g = parseInt(d.slice(2, 4), 16);
  const b = parseInt(d.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Vermelho de ALERTA. Pintar uma etapa com esta cor é o jeito de dizer
 * "quem cai aqui precisa de ação imediata" — a coluna inteira fica vermelha.
 *
 * Nasceu da etapa "Call Agendada" do funil do consultor: todo lead que chega ali
 * já tem uma call marcada pela Ana, às vezes para o mesmo dia. O consultor precisa
 * ver isso de longe.
 *
 * É de propósito que a regra seja a COR e não um id fixo: se amanhã outra etapa
 * precisar do mesmo destaque, basta pintá-la deste vermelho — sem mexer no código.
 */
export const COR_ALERTA = '#dc2626';

/**
 * A etapa está marcada como urgente?
 *
 * @param color - valor de `board_stages.color`.
 */
export function isEtapaDeAlerta(color?: string | null): boolean {
  return stageAccentHex(color) === COR_ALERTA;
}
