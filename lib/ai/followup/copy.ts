/**
 * Copy dos toques de follow-up. FRIA = roteiro fixo (ângulos de valor). QUENTE = IA
 * (ver generate.ts), com estas linhas como fallback. Bolhas curtas, sem emoji, sem
 * travessão, "consultor" (nunca "vendedor"). Aprovado pela Thalita em 2026-07-13.
 */

export const FOLLOWUP_TAG = 'sem-resposta';

// Cada toque = array de bolhas. renderBubbles junta com '\n\n' para o splitIntoBubbles
// do sendAIResponse mandar cada uma como uma mensagem separada (estilo WhatsApp).
export const COLD_TOUCHES: string[][] = [
  // Toque 1 (+3h) — reabre a porta
  [
    'Oi {nome}, consegue falar por aqui?',
    'Já vou adiantando seu caso pro consultor pra ele chegar certeiro quando for te ligar.',
  ],
  // Toque 2 (+1 dia) — você nos procurou por um motivo
  [
    '{nome}, você chegou até a gente porque tem algo pra resolver no seu plano de saúde.',
    'É exatamente isso que a gente faz: entende o seu caso e acha a melhor saída pra você e sua família.',
    'Consigo te reservar 15 minutos com um consultor pra isso.',
  ],
  // Toque 3 (+4 dias) — reajuste composto
  [
    '{nome}, um detalhe que quase ninguém nota: todo ano no mesmo plano seu valor sobe, mesmo sem usar.',
    'Dá pra revisar isso antes do próximo reajuste, e normalmente sobra dinheiro no seu bolso.',
  ],
  // Toque 4 (+10 dias) — despedida
  [
    '{nome}, não vou insistir à toa.',
    'Paro por aqui, mas quando quiser resolver seu plano é só me chamar. Fico à disposição.',
  ],
];

// Fallback do toque quente (usado quando a IA falha) — uma bolha por toque.
export const WARM_FALLBACK: string[] = [
  '{nome}, ainda por aí? Podemos continuar de onde paramos.',
  '{nome}, consigo agilizar seu atendimento com o consultor. Quer que eu já organize?',
  '{nome}, vou pausar por aqui. Quando quiser retomar, é só responder.',
];

// O último toque quente (despedida) é SEMPRE fixo — não chama a IA.
export const WARM_FIXED_LAST_INDEX = WARM_FALLBACK.length - 1;

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Interpola {nome}, limpa pontuação órfã, e junta as bolhas com linha em branco. */
export function renderBubbles(bubbles: string[], name: string | null | undefined): string {
  const first = firstName(name);
  return bubbles
    .map((b) =>
      b.replaceAll('{nome}', first).replace(/\s{2,}/g, ' ').replace(/\s+([,!?.])/g, '$1').trim()
    )
    .filter(Boolean)
    .join('\n\n');
}
