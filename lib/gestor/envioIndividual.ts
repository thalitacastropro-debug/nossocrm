/**
 * @fileoverview Manda para cada pessoa do time o resumo do dia dela.
 *
 * Ligado em 02/09/2026, depois de a Thalita avisar o time. O texto já existia
 * desde 31/08 (`formatarParaColaborador`); o que faltava era para onde mandar e
 * como não mandar duas vezes.
 *
 * ## As quatro regras que este módulo existe para garantir
 *
 * 1. **Só quem pediu recebe.** `telegram_chat_id` nulo = fora. Ninguém entra na
 *    lista por ter telefone cadastrado ou por ser do time: entra por ter ligado
 *    no próprio perfil.
 * 2. **Nunca duas vezes no mesmo dia.** A trava é a chave primária de
 *    `gestor_envios (dia, profile_id)` — gravamos ANTES de enviar. O cron roda
 *    uma vez, mas a rota é um GET com segredo: chamada manual, retry do pg_net
 *    ou redeploy repetiriam a manhã inteira. Alerta repetido é o jeito mais
 *    rápido de o time parar de ler.
 * 3. **A falha de um não derruba os outros.** Cada envio tem seu try/catch, e o
 *    erro é gravado na linha da pessoa — dá para responder "por que o Pedro não
 *    recebeu?" sem depender do log da Vercel, que expira.
 * 4. **Nada disso pode derrubar o diário da dona.** Ela recebe primeiro; o
 *    individual roda depois e o resultado dele é informação, não condição.
 *
 * Escolha explícita: gravar antes de enviar. Entre mandar duas vezes e não
 * mandar quando o envio falha no meio, o segundo erro é o barato — o diário de
 * amanhã cobre o mesmo estoque, porque a lista é montada do estado do CRM e não
 * de um acumulado.
 *
 * @module lib/gestor/envioIndividual
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatarParaColaborador } from './formato';
import type { Diario } from './regras';

/** Quem recebe a visão da equipe junto do próprio bloco. Ver a rota do cron. */
export type EhGestor = (role: string | null | undefined) => boolean;

export interface PerfilDestino {
  id: string;
  role: string | null;
  telegram_chat_id: string | null;
  nickname?: string | null;
  name?: string | null;
  first_name?: string | null;
}

export interface ResultadoIndividual {
  quem: string;
  enviado: boolean;
  /** Por que não enviou. Ausente quando enviou. */
  motivo?: 'sem-telegram' | 'nada-a-dizer' | 'ja-enviado-hoje' | 'falhou';
  erro?: string;
}

export interface DepsEnvioIndividual {
  supabase: SupabaseClient;
  diario: Diario;
  /** Dia em Brasília, `YYYY-MM-DD` — é a chave da trava de reenvio. */
  dia: string;
  enviar: (chatId: string, texto: string) => Promise<void>;
  ehGestor: EhGestor;
}

const nomeDe = (p: PerfilDestino) => p.nickname || p.name || p.first_name || p.id;

/**
 * O erro do Telegram diz que aquele chat não existe mais para nós?
 *
 * São os dois casos permanentes: a pessoa bloqueou o bot, ou apagou a conversa.
 * Qualquer outro erro (429, 5xx, rede) é transitório e o diário de amanhã
 * resolve — por isso a lista é curta de propósito.
 */
function ehChatMorto(erro: string): boolean {
  return /bot was blocked|chat not found|user is deactivated|bot was kicked/i.test(erro);
}

/**
 * Envia o diário individual de todo mundo que ligou.
 *
 * Sequencial de propósito: são duas ou três pessoas, e disparar em paralelo só
 * traria risco de rate limit do Telegram sem ganho perceptível.
 */
export async function enviarDiariosIndividuais(
  deps: DepsEnvioIndividual,
  perfis: PerfilDestino[],
): Promise<ResultadoIndividual[]> {
  const resultados: ResultadoIndividual[] = [];

  for (const perfil of perfis) {
    const quem = nomeDe(perfil);

    const chatId = perfil.telegram_chat_id?.trim();
    if (!chatId) {
      resultados.push({ quem, enviado: false, motivo: 'sem-telegram' });
      continue;
    }

    const texto = formatarParaColaborador(deps.diario, perfil.id, {
      ehGestor: deps.ehGestor(perfil.role),
    });

    // `null` = a pessoa não tem novidade NEM acumulado. Mandar "você está em dia"
    // toda manhã é o jeito mais rápido de ela parar de abrir a mensagem.
    if (!texto) {
      resultados.push({ quem, enviado: false, motivo: 'nada-a-dizer' });
      continue;
    }

    // A trava. Se a linha já existe, o insert falha e nós paramos aqui — é o
    // mesmo diário sendo pedido de novo no mesmo dia.
    const { error: erroTrava } = await deps.supabase
      .from('gestor_envios')
      .insert({ dia: deps.dia, profile_id: perfil.id, chat_id: chatId });

    if (erroTrava) {
      // ⚠️ `supabase-js` devolve TODO erro como `{ error }` — violação de chave,
      // banco fora do ar, timeout de rede. Ler qualquer um deles como "já
      // mandei hoje" seria o pior tipo de bug: ninguém recebe e o relatório
      // diz que estava tudo certo. Só 23505 (unique_violation) é reenvio.
      const ehReenvio = erroTrava.code === '23505';
      resultados.push({
        quem,
        enviado: false,
        motivo: ehReenvio ? 'ja-enviado-hoje' : 'falhou',
        erro: ehReenvio ? undefined : `trava: ${erroTrava.message}`,
      });
      continue;
    }

    try {
      await deps.enviar(chatId, texto);
      resultados.push({ quem, enviado: true });
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      // Deixa a marca na própria linha: a trava continua de pé (não vamos
      // reenviar sozinhos), mas fica registrado o que aconteceu.
      await deps.supabase
        .from('gestor_envios')
        .update({ erro: erro.slice(0, 500) })
        .eq('dia', deps.dia)
        .eq('profile_id', perfil.id);

      // Bloqueou o bot ou apagou a conversa: o Telegram nunca mais vai aceitar
      // esse chat. Sem desligar, o CRM tentaria todo dia para sempre e a tela
      // continuaria dizendo "Ligado" para alguém que não recebe nada. Desligar
      // devolve a pessoa ao estado honesto — e ela religa quando quiser.
      if (ehChatMorto(erro)) {
        await deps.supabase
          .from('profiles')
          .update({ telegram_chat_id: null })
          .eq('id', perfil.id);
      }

      resultados.push({ quem, enviado: false, motivo: 'falhou', erro });
    }
  }

  return resultados;
}
