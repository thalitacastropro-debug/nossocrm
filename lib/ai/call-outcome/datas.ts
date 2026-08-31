/**
 * @fileoverview Normaliza a data das tarefas que a IA extrai do áudio do consultor.
 *
 * O CASO REAL (31/08/2026, card do Bruce Mendes): o Denilson gravou o desfecho da
 * call e disse *"agendei retorno para 02/09 às 10h"*. A IA entendeu, criou a tarefa
 * sozinha — e gravou **`2023-09-02 07:00`**. Dois erros na mesma data:
 *
 * 1. **Ano 2023.** O prompt nunca dizia que dia era hoje. Sem âncora, o modelo
 *    completou o ano com o que lhe pareceu natural — um ano do próprio treino.
 * 2. **07:00 em vez de 10h.** Ele escreveu `10:00Z` (UTC), que em Brasília é 07:00.
 *
 * E os dois juntos causaram um terceiro sintoma, que foi como a dona percebeu o
 * problema: a timeline do card ordena por DATA, então a tarefa recém-criada foi
 * parar no fim da lista, marcada como "atrasada", atrás de tudo de 2026.
 *
 * ## As duas decisões deste módulo
 *
 * **O relógio do consultor é o de Brasília, sempre.** A hora escrita na string é
 * lida como horário de Brasília e qualquer fuso que o modelo tenha grudado ali é
 * DESCARTADO. Parece agressivo, mas é o que corresponde à realidade: quem grava o
 * áudio diz "dez da manhã" pensando no próprio relógio, nunca em UTC. Confiar no
 * offset do modelo foi exatamente o que produziu 07:00.
 *
 * **Tarefa não nasce no passado.** Um próximo passo agendado para trás é sempre
 * erro de extração, nunca intenção. Quando a data cai no passado, tentamos o ano
 * corrente e depois o seguinte — "02/09" vira o 02/09 que ainda está por vir.
 *
 * @module lib/ai/call-outcome/datas
 */

/** Brasília. O CRM inteiro raciocina neste fuso (ver o briefing e o agendamento). */
const OFFSET_BRT = '-03:00';

/** Hora padrão quando o consultor diz só o dia ("me lembra dia 5"): 9h, começo do expediente. */
const HORA_PADRAO = '09:00:00';

/** Teto de sanidade: nada de próximo passo para daqui a 3 anos. */
const ANOS_MAX_NO_FUTURO = 3;

/**
 * Converte o que a IA devolveu em um ISO confiável, ou `null` se não der para
 * confiar.
 *
 * @param bruto  O que veio do modelo (ex.: "2023-09-02T10:00:00Z", "02/09 10h", null).
 * @param agora  Referência de "agora" — injetada para o teste não depender do relógio.
 */
export function normalizarDataTarefa(bruto: string | null | undefined, agora: Date): string | null {
  if (!bruto || typeof bruto !== 'string') return null;

  const partes = extrairPartes(bruto.trim());
  if (!partes) return null;

  const { mes, dia, hora, minuto } = partes;
  let { ano } = partes;

  // Ano ausente ou no passado: procura a próxima ocorrência real desta data.
  // Vale também para o ano que o modelo inventou — 2023 e "sem ano" têm o mesmo
  // conserto, porque nos dois casos o ano não carrega informação nenhuma.
  const anoAtual = agora.getUTCFullYear();
  if (ano == null || ano < anoAtual) ano = anoAtual;

  let iso = montar(ano, mes, dia, hora, minuto);
  if (!iso) return null;

  // Ainda no passado (ex.: hoje é 20/12 e a tarefa é "05/01") => ano que vem.
  if (new Date(iso).getTime() <= agora.getTime()) {
    iso = montar(ano + 1, mes, dia, hora, minuto);
    if (!iso) return null;
  }

  // Longe demais para ser um próximo passo de venda: é extração ruim, e uma data
  // errada silenciosa é pior que nenhuma (a tarefa some da vista do consultor).
  const limite = new Date(agora.getTime());
  limite.setUTCFullYear(limite.getUTCFullYear() + ANOS_MAX_NO_FUTURO);
  if (new Date(iso).getTime() > limite.getTime()) return null;

  return iso;
}

/** Monta o ISO em Brasília; devolve null se a data não existir (ex.: 31/02). */
function montar(ano: number, mes: number, dia: number, hora: number, minuto: number): string | null {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const texto = `${ano}-${p2(mes)}-${p2(dia)}T${p2(hora)}:${p2(minuto)}:00${OFFSET_BRT}`;
  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) return null;
  // 31/02 vira 03/03 silenciosamente no construtor: conferimos a volta.
  const emBrt = new Date(d.getTime() + 3 * 60 * 60 * 1000); // desloca p/ ler como BRT em UTC
  if (emBrt.getUTCDate() !== dia || emBrt.getUTCMonth() + 1 !== mes) return null;
  return d.toISOString();
}

interface Partes {
  ano: number | null;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}

/**
 * Lê as partes da data SEM deixar o `Date` interpretar fuso.
 *
 * Aceita o ISO que o modelo costuma devolver (com ou sem `Z`/offset — o fuso é
 * ignorado de propósito, ver o cabeçalho) e as formas brasileiras que escapam
 * quando o modelo resolve escrever como o consultor falou.
 */
function extrairPartes(s: string): Partes | null {
  // ISO: 2026-09-02T10:00[:00][Z|±hh:mm]  — o sufixo de fuso é lido e descartado.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (iso) {
    return {
      ano: Number(iso[1]),
      mes: Number(iso[2]),
      dia: Number(iso[3]),
      hora: iso[4] ? Number(iso[4]) : Number(HORA_PADRAO.slice(0, 2)),
      minuto: iso[5] ? Number(iso[5]) : 0,
    };
  }

  // Brasileiro: 02/09[/2026] [às] [10h|10:00]
  const br = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:.*?(\d{1,2})(?:[:h](\d{2}))?)?/);
  if (br) {
    let ano: number | null = br[3] ? Number(br[3]) : null;
    if (ano != null && ano < 100) ano += 2000; // "26" -> 2026
    return {
      ano,
      mes: Number(br[2]),
      dia: Number(br[1]),
      hora: br[4] ? Number(br[4]) : Number(HORA_PADRAO.slice(0, 2)),
      minuto: br[5] ? Number(br[5]) : 0,
    };
  }

  return null;
}

/** Data de hoje em Brasília, no formato que vai para o prompt (ex.: "segunda-feira, 31/08/2026"). */
export function hojeParaPrompt(agora: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(agora);
}
