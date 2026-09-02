/**
 * GET /api/cron/gestor-comercial
 *
 * O diário comercial da Thalita, às 8h da manhã no Telegram. Protegido por
 * CRON_SECRET (Bearer), chamado pelo pg_cron — migração
 * `20260831190000_gestor_comercial_cron.sql`.
 *
 * ## Por que isto é um cron do CRM e não uma tarefa agendada do app
 *
 * Descoberto em 31/08/2026: o briefing da Implantação, criado em 28/08, **nunca
 * foi entregue nenhuma vez**. Cinco execuções agendadas, cinco mortes — todas
 * nos primeiros segundos, sempre na primeira consulta ao banco, sem erro
 * registrado e sem nunca chegar ao passo do Telegram. Pior: `lastRunAt` ficava
 * preenchido, então pelo painel a tarefa "rodou". Silêncio virou "está tudo bem".
 *
 * Tarefa agendada depende do desktop dela estar aberto. `pg_cron` + rota roda na
 * infraestrutura, 24/7 — é como a cadência de follow-up da Ana já funciona.
 *
 * ## Falha alto, de propósito
 *
 * Se a montagem do diário quebrar, este endpoint **avisa no Telegram que
 * quebrou** em vez de terminar em silêncio. Foi exatamente o silêncio que
 * escondeu o problema por 3 dias.
 */
import { createStaticAdminClient } from '@/lib/supabase/server';
import { sendTelegramMessage } from '@/lib/notifications/telegram';
import { montarDiario } from '@/lib/gestor/regras';
import { formatarDiario, formatarParaColaborador } from '@/lib/gestor/formato';
import { enviarDiariosIndividuais, type PerfilDestino } from '@/lib/gestor/envioIndividual';

export const maxDuration = 60;

const TZ_OFFSET_HOURS = -3;

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Escapa o que vai dentro de uma mensagem com `parse_mode: 'HTML'`.
 *
 * Vale ATÉ para mensagem de erro — principalmente para ela. Uma exceção com
 * `<anonymous>` no texto faria o Telegram recusar a mensagem inteira com
 * "can't parse entities", e o aviso de falha morreria calado justo no dia em
 * que existe algo a avisar.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Quem recebe a visão da equipe junto do próprio bloco.
 *
 * Hoje `admin` = Thalita e Denilson, e a decisão de 26/08 é não promover mais
 * ninguém — então o papel serve de hierarquia sem inventar tabela nova. Se um
 * dia houver admin que não cobra ninguém, aí sim vale um campo próprio; hoje
 * seria estrutura para um caso que não existe.
 */
function ehGestor(role: string | null | undefined): boolean {
  return role === 'admin';
}

/** Segunda a sexta. Sábado e domingo não têm daily. */
function ehDiaUtil(now: Date): boolean {
  const local = new Date(now.getTime() + TZ_OFFSET_HOURS * 36e5);
  const dia = local.getUTCDay();
  return dia >= 1 && dia <= 5;
}

/**
 * O dia em Brasília (`YYYY-MM-DD`), que é a chave da trava de reenvio.
 *
 * Precisa ser o dia LOCAL: o cron dispara 11h UTC, e usar a data UTC daria o
 * mesmo resultado por sorte hoje — mas viraria um bug silencioso no dia em que
 * alguém adiantasse o horário para antes das 3h da manhã de Brasília.
 */
function diaChave(now: Date): string {
  return new Date(now.getTime() + TZ_OFFSET_HOURS * 36e5).toISOString().slice(0, 10);
}

/**
 * Manda o diário individual de quem ligou, e conta o que aconteceu.
 *
 * Isolado numa função com try/catch próprio de propósito: o diário da dona já
 * saiu quando isto roda. Uma exceção aqui não pode virar "o diário não
 * conseguiu rodar hoje" na tela dela.
 *
 * O resultado precisa chegar a um humano. Antes, ele só existia no corpo da
 * resposta HTTP — que o `net.http_get` do pg_cron descarta. Se o Pedro parasse
 * de receber, ninguém ficaria sabendo. Agora, falha vira mensagem para a dona;
 * sucesso continua calado, senão a manhã dela ganha um relatório sobre o
 * relatório.
 */
async function enviarIndividuais(opts: {
  supabase: ReturnType<typeof createStaticAdminClient>;
  diario: Awaited<ReturnType<typeof montarDiario>>;
  dia: string;
  token: string;
  chatDaDona: string;
}): Promise<{ resultados?: unknown[]; erro?: string }> {
  const { supabase, diario, dia, token, chatDaDona } = opts;

  try {
    const { data: time, error } = await supabase
      .from('profiles')
      .select('id, role, telegram_chat_id, nickname, name, first_name')
      .not('telegram_chat_id', 'is', null);

    // Ignorar este erro deixaria o time inteiro sem diário com a rota
    // respondendo ok:true — o modo de falha mais caro que existe aqui.
    if (error) throw new Error(`não consegui listar quem recebe: ${error.message}`);

    const perfis = ((time ?? []) as PerfilDestino[]).filter(
      // A dona já recebeu o diário COMPLETO. Se ela também ligou o individual
      // no perfil dela, receberia duas mensagens sobre o mesmo dia.
      (p) => p.telegram_chat_id !== chatDaDona,
    );

    const resultados = await enviarDiariosIndividuais(
      {
        supabase,
        diario,
        dia,
        enviar: (chatId, corpo) => sendTelegramMessage(token, chatId, corpo),
        ehGestor,
      },
      perfis,
    );

    const falhas = resultados.filter((r) => r.motivo === 'falhou');
    if (falhas.length > 0) {
      await sendTelegramMessage(
        token,
        chatDaDona,
        `⚠️ <b>O resumo individual não chegou em ${falhas.length} ${falhas.length === 1 ? 'pessoa' : 'pessoas'}:</b>\n` +
          falhas.map((f) => `· ${esc(f.quem)} — ${esc((f.erro ?? '').slice(0, 120))}`).join('\n'),
      ).catch(() => {
        /* o log do servidor é o que sobra */
      });
    }

    return { resultados };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Cron:gestor-comercial] individual falhou:', msg);
    await sendTelegramMessage(
      token,
      chatDaDona,
      `⚠️ <b>O resumo individual do time não saiu hoje.</b>\n\nMotivo técnico: ${esc(msg.slice(0, 300))}\n\nO seu diário acima está completo.`,
    ).catch(() => {
      /* idem */
    });
    return { erro: msg };
  }
}

export async function GET(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const now = new Date();
  const url = new URL(req.url);

  /**
   * `?dry=1` mostra o texto SEM enviar. Existe porque a Thalita perguntou, com
   * razão, "o que o Pedro receberia?" — e a resposta não pode ser eu descrevendo
   * de memória: tem que ser o texto que o código gera de verdade. Também é o que
   * ela usa para conferir o relatório de alguém antes de ligar a entrega
   * individual. Continua exigindo o segredo do cron.
   */
  const seco = url.searchParams.get('dry') === '1';
  if (!seco && !ehDiaUtil(now)) return json({ skipped: true, reason: 'Fim de semana' });

  const supabase = createStaticAdminClient();

  const { data: cfg } = await supabase
    .from('organization_settings')
    .select('telegram_bot_token, telegram_chat_id, telegram_chat_id_alerts')
    .maybeSingle();

  const token = cfg?.telegram_bot_token as string | undefined;
  if (!token) return json({ skipped: true, reason: 'Telegram não configurado' });

  // A dona recebe TUDO, inclusive o que é sigiloso (contradição). Decisão dela
  // em 31/08: contradição não vai para o time — se fosse, o efeito previsível
  // seria aprenderem a espaçar os cliques, não a preencher melhor.
  const destino = (cfg?.telegram_chat_id_alerts ?? cfg?.telegram_chat_id) as string | undefined;
  if (!destino) return json({ skipped: true, reason: 'Sem chat de destino' });

  try {
    const diario = await montarDiario({ supabase, now });

    if (seco) {
      // Um texto por pessoa que tem algo, mais o da dona — lado a lado, para
      // dar para comparar exatamente o que cada um veria.
      const { data: time } = await supabase.from('profiles').select('id, name, nickname, first_name, role');
      const porPessoa = (
        (time ?? []) as Array<{ id: string; name: string | null; nickname: string | null; first_name: string | null; role: string | null }>
      )
        .map((p) => ({
          quem: p.nickname || p.name || p.first_name || p.id,
          ehGestor: ehGestor(p.role),
          texto: formatarParaColaborador(diario, p.id, { ehGestor: ehGestor(p.role) }),
        }))
        .filter((x) => x.texto !== null);

      return json({
        seco: true,
        dona: formatarDiario(diario, true),
        colaboradores: porPessoa,
        regras: diario.regras.map((r) => ({ id: r.id, sigiloso: !!r.sigiloso, novos: r.novos.length, estoque: r.estoque })),
      });
    }

    const texto = formatarDiario(diario, true);

    await sendTelegramMessage(token, destino, texto);

    // O individual roda DEPOIS e é isolado: a dona JÁ recebeu o diário completo
    // acima, então nada daqui para baixo pode cair no catch lá de fora — ele
    // avisaria "o diário não conseguiu rodar hoje" logo depois de o diário ter
    // chegado, que é pior do que não avisar nada.
    const individuais = await enviarIndividuais({
      supabase,
      diario,
      dia: diaChave(now),
      token,
      chatDaDona: destino,
    });

    return json({
      ok: true,
      enviado: true,
      individuais,
      regras: diario.regras.map((r) => ({ id: r.id, novos: r.novos.length, estoque: r.estoque })),
    });
  } catch (erro) {
    // Falha ALTO. O diário que morre calado é pior que o diário que não existe:
    // a dona lê o silêncio como "operação limpa".
    const msg = erro instanceof Error ? erro.message : String(erro);
    console.error('[Cron:gestor-comercial] falhou:', msg);
    await sendTelegramMessage(
      token,
      destino,
      `⚠️ <b>O diário comercial não conseguiu rodar hoje.</b>\n\nMotivo técnico: ${esc(msg.slice(0, 300))}\n\nIsto é um aviso de falha, não um dia sem pendências.`,
    ).catch(() => {
      /* se nem o aviso sai, o log do servidor é o que sobra */
    });
    return json({ ok: false, erro: msg }, 500);
  }
}
