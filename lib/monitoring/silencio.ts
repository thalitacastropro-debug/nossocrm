/**
 * @fileoverview Monitor de silêncio — detecta que a entrada de leads parou.
 *
 * ## Por que isto existe
 *
 * A entrada de leads da Niva depende de uma automação que roda na conta da
 * AGÊNCIA de tráfego (Make/n8n do parceiro). Se ela é desligada, expira ou
 * quebra, os leads simplesmente param de chegar — e nada no CRM acusa. O funil
 * fica quieto, que é exatamente como ele fica num dia fraco.
 *
 * Aconteceu de verdade: as chamadas cessaram em 21/08/2026 às 06:22 e a Niva
 * levou três dias para perceber, olhando o Gerenciador de Anúncios por outro
 * motivo.
 *
 * ## Por que o limite não é "não chegou lead"
 *
 * Medido na base em 24/08/2026, últimos 32 dias úteis:
 * - **16 deles (metade) tiveram ZERO leads.** Um alarme baseado só em lead
 *   tocaria toda semana, e um alarme que toca toda semana é ignorado em duas.
 * - **Apenas 4 tiveram zero leads E zero mensagens recebidas** — e só uma vez
 *   em dias consecutivos (11 e 12/08).
 *
 * Então o sinal é a coincidência: lead parado é normal; lead parado **junto com**
 * WhatsApp mudo não é. Quando entra lead, a Ana escreve e a pessoa responde —
 * mensagem recebida é a prova de vida da esteira inteira.
 *
 * ## O limite honesto
 *
 * Mesmo assim isto é um AVISO, não uma prova. Pelos números acima, a regra
 * abaixo teria disparado ~1 alarme falso em 6 semanas. O jeito de tornar o sinal
 * exato é pedir à agência um **heartbeat**: uma chamada de sinal de vida a cada
 * hora, mesmo sem lead. Aí silêncio deixa de ser ambíguo. Está registrado no
 * documento de integração entregue à agência.
 *
 * @module lib/monitoring/silencio
 */

/** Expediente comercial da Niva (mesma janela usada na entrada de leads). */
export const EXPEDIENTE = {
  timezone: 'America/Sao_Paulo',
  inicio: 8,      // 08:00
  fim: 17.5,      // 17:30
  diasUteis: [1, 2, 3, 4, 5], // segunda a sexta
} as const;

export type NivelDeSilencio = 'ok' | 'atencao' | 'alerta';

export interface LeituraDeSilencio {
  /** Horas ÚTEIS desde o último lead que entrou. */
  horasSemLead: number;
  /** Horas ÚTEIS desde a última mensagem recebida no WhatsApp. */
  horasSemMensagem: number;
}

export interface LimitesDeSilencio {
  /** Horas úteis de silêncio nos DOIS canais para o primeiro aviso. */
  atencao: number;
  /** Horas úteis de silêncio nos DOIS canais para o alerta forte. */
  alerta: number;
}

/**
 * Padrão calibrado nos números acima.
 *
 * `atencao` em 6h úteis ≈ pouco menos de um dia de expediente: pega uma parada
 * que começou de manhã antes de o dia acabar.
 * `alerta` em 16h úteis ≈ dois dias de expediente, que historicamente nunca
 * aconteceu com os dois canais mudos sem haver problema real.
 */
export const LIMITES_PADRAO: LimitesDeSilencio = { atencao: 6, alerta: 16 };

export interface VeredictoDeSilencio {
  nivel: NivelDeSilencio;
  /** Frase pronta para o Telegram. Vazia quando o nível é 'ok'. */
  mensagem: string;
  /** Por que este nível — para o log, e para depurar alarme falso depois. */
  motivo: string;
}

/**
 * Conta horas ÚTEIS entre dois instantes, respeitando o fuso de São Paulo.
 *
 * Percorre em passos de 15 min porque o expediente termina 17:30 — passo de hora
 * cheia erraria a meia hora final todo dia. O intervalo típico aqui é de horas a
 * poucos dias, então o custo é irrelevante.
 *
 * @param inicio - instante mais antigo.
 * @param fim - instante mais recente.
 * @returns horas úteis decorridas (0 se `fim` <= `inicio`).
 */
export function horasUteisEntre(inicio: Date, fim: Date): number {
  if (!(inicio instanceof Date) || Number.isNaN(inicio.getTime())) return 0;
  if (!(fim instanceof Date) || Number.isNaN(fim.getTime())) return 0;
  if (fim <= inicio) return 0;

  const PASSO_MS = 15 * 60 * 1000;
  const formatador = new Intl.DateTimeFormat('en-US', {
    timeZone: EXPEDIENTE.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const DIA_POR_SIGLA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // Teto de segurança: 60 dias corridos. Silêncio maior que isso já é outro problema.
  const TETO_MS = 60 * 24 * 60 * 60 * 1000;
  const limite = Math.min(fim.getTime(), inicio.getTime() + TETO_MS);

  let uteis = 0;
  for (let t = inicio.getTime(); t < limite; t += PASSO_MS) {
    const partes = formatador.formatToParts(new Date(t));
    const sigla = partes.find((p) => p.type === 'weekday')?.value ?? '';
    const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');
    const minuto = Number(partes.find((p) => p.type === 'minute')?.value ?? '0');
    const diaSemana = DIA_POR_SIGLA[sigla];
    if (diaSemana === undefined) continue;
    if (!(EXPEDIENTE.diasUteis as readonly number[]).includes(diaSemana)) continue;

    const horaDecimal = hora + minuto / 60;
    if (horaDecimal >= EXPEDIENTE.inicio && horaDecimal < EXPEDIENTE.fim) {
      uteis += PASSO_MS / (60 * 60 * 1000);
    }
  }
  return Math.round(uteis * 100) / 100;
}

/**
 * Decide se o silêncio merece alarme.
 *
 * A regra é a COINCIDÊNCIA: só acusa quando lead E mensagem estão parados. Lead
 * parado sozinho é rotina (metade dos dias úteis); mensagem parada sozinha pode
 * ser só um dia sem resposta. Os dois juntos é que indicam esteira interrompida.
 *
 * @param leitura - horas úteis de silêncio em cada canal.
 * @param limites - opcional; use para afrouxar ou apertar sem mexer no código.
 */
export function avaliarSilencio(
  leitura: LeituraDeSilencio,
  limites: LimitesDeSilencio = LIMITES_PADRAO,
): VeredictoDeSilencio {
  const { horasSemLead, horasSemMensagem } = leitura;
  const silencioNosDois = Math.min(horasSemLead, horasSemMensagem);

  if (silencioNosDois >= limites.alerta) {
    return {
      nivel: 'alerta',
      motivo: `dois canais mudos há ${silencioNosDois}h úteis (limite de alerta: ${limites.alerta}h)`,
      mensagem:
        `🔴 A entrada de leads parou.\n\n` +
        `Sem lead novo há ${formatarHoras(horasSemLead)} de expediente.\n` +
        `Sem mensagem recebida no WhatsApp há ${formatarHoras(horasSemMensagem)} de expediente.\n\n` +
        `Os dois canais mudos ao mesmo tempo quase nunca é dia fraco. Confira, nesta ordem: ` +
        `se a automação da agência ainda está disparando, se as campanhas estão no ar e se a conta de anúncios não foi restringida.`,
    };
  }

  if (silencioNosDois >= limites.atencao) {
    return {
      nivel: 'atencao',
      motivo: `dois canais mudos há ${silencioNosDois}h úteis (limite de atenção: ${limites.atencao}h)`,
      mensagem:
        `🟡 Entrada de leads quieta.\n\n` +
        `Sem lead novo há ${formatarHoras(horasSemLead)} de expediente e sem mensagem recebida há ${formatarHoras(horasSemMensagem)}.\n\n` +
        `Pode ser só um dia fraco. Se continuar assim amanhã, é para investigar.`,
    };
  }

  return {
    nivel: 'ok',
    motivo: `silêncio de ${silencioNosDois}h úteis, abaixo do limite de ${limites.atencao}h`,
    mensagem: '',
  };
}

/** "6h" / "1 dia e 2h" — para caber numa mensagem de Telegram sem parecer relatório. */
function formatarHoras(horasUteis: number): string {
  const DIA_UTIL = EXPEDIENTE.fim - EXPEDIENTE.inicio; // 9.5h
  if (horasUteis < DIA_UTIL) return `${Math.round(horasUteis)}h`;
  const dias = Math.floor(horasUteis / DIA_UTIL);
  const resto = Math.round(horasUteis - dias * DIA_UTIL);
  const parteDias = dias === 1 ? '1 dia' : `${dias} dias`;
  return resto > 0 ? `${parteDias} e ${resto}h` : parteDias;
}
