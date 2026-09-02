/**
 * PUT    /api/profile/telegram — sorteia o código que a pessoa vai mandar ao bot.
 * POST   /api/profile/telegram — procura esse código no Telegram e liga o diário.
 * DELETE /api/profile/telegram — desliga.
 *
 * A pessoa manda um código para o bot; aqui procuramos esse código entre as
 * mensagens que o bot recebeu e guardamos o `chat_id` dela. É o único caminho
 * possível: o bot não pode puxar conversa (o Telegram proíbe), então quem
 * começa é sempre a pessoa.
 *
 * ## Quatro escolhas que não são óbvias
 *
 * 1. **O código é sorteado e morre no uso** (`telegram_vinculos_pendentes`,
 *    migração 20260902160000). A primeira versão derivava o código do
 *    `profiles.id`, que a organização inteira lê — dava para forjar o vínculo
 *    do gestor e receber o relatório dele. Ver a migração para o ataque inteiro.
 *
 * 2. **O código não mora em `profiles`.** Lá, a policy de leitura da
 *    organização o entregaria para todo mundo e o sorteio não teria resolvido
 *    nada.
 *
 * 3. **Service role para LER o token do bot.** `organization_settings` é
 *    admin-only desde 24/08 — foi o que fez "Google AI key not configured"
 *    aparecer só para o vendedor. Se esta rota lesse com o client do usuário, o
 *    Pedro (vendedor) receberia "token não configurado" e o Denilson não,
 *    exatamente o mesmo bug de novo. O token nunca sai desta função.
 *
 * 4. **Só o PRÓPRIO perfil.** Todo update é fixado em `.eq('id', user.id)`, sem
 *    aceitar id do corpo. Ninguém liga (nem desliga) o diário de outra pessoa.
 */
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import {
  acharChatPeloCodigo,
  buscarUpdatesDoBot,
  gerarCodigo,
  VALIDADE_DO_CODIGO_MIN,
} from '@/lib/notifications/telegramColaborador';
import { sendTelegramMessage } from '@/lib/notifications/telegram';

export const maxDuration = 30;

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function usuarioDaSessao() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** PUT — sorteia (ou re-sorteia) o código desta pessoa. */
export async function PUT(req: Request): Promise<Response> {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const user = await usuarioDaSessao();
  if (!user) return json({ error: 'Sessão expirada. Entre de novo.' }, 401);

  const admin = createStaticAdminClient();
  const codigo = gerarCodigo();
  const expiraEm = new Date(Date.now() + VALIDADE_DO_CODIGO_MIN * 60_000).toISOString();

  const { error } = await admin
    .from('telegram_vinculos_pendentes')
    .upsert({ profile_id: user.id, codigo, expira_em: expiraEm }, { onConflict: 'profile_id' });

  if (error) {
    console.error('[profile/telegram] não consegui sortear o código:', error.message);
    return json({ error: 'Não foi possível gerar o seu código agora. Tente de novo.' }, 500);
  }

  return json({ codigo, expiraEm, validadeMin: VALIDADE_DO_CODIGO_MIN });
}

/** POST — procura o código no Telegram e liga. */
export async function POST(req: Request): Promise<Response> {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const user = await usuarioDaSessao();
  if (!user) return json({ error: 'Sessão expirada. Entre de novo.' }, 401);

  const admin = createStaticAdminClient();

  const { data: pendente, error: erroPendente } = await admin
    .from('telegram_vinculos_pendentes')
    .select('codigo, expira_em')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (erroPendente) {
    console.error('[profile/telegram] leitura do pendente falhou:', erroPendente.message);
    return json({ error: 'Não foi possível verificar agora. Tente de novo.' }, 500);
  }

  // Sem código, ou vencido: a tela sorteia outro e recomeça o passo a passo. É
  // melhor do que aceitar um código velho, que é justamente o que uma pessoa
  // mal-intencionada teria tempo de descobrir.
  if (!pendente || new Date(pendente.expira_em as string).getTime() < Date.now()) {
    return json({ expirado: true }, 200);
  }

  const { data: cfg } = await admin
    .from('organization_settings')
    .select('telegram_bot_token')
    .maybeSingle();

  const token = cfg?.telegram_bot_token as string | undefined;
  if (!token) {
    return json({ error: 'O Telegram ainda não está configurado no CRM. Fale com a administração.' }, 400);
  }

  try {
    const updates = await buscarUpdatesDoBot(token);
    const chat = acharChatPeloCodigo(updates, pendente.codigo as string);

    // Não achou: quase sempre é a pessoa clicando ANTES de mandar a mensagem.
    if (!chat) {
      return json({ encontrado: false, filaCheia: updates.length >= 100 }, 200);
    }

    const { error } = await admin
      .from('profiles')
      .update({ telegram_chat_id: chat.chatId })
      .eq('id', user.id);

    if (error) {
      // 23505 = o índice único de `telegram_chat_id`: aquele chat já é de outra
      // pessoa. Sem esta mensagem, o sintoma seria "não consegui salvar" e
      // ninguém entenderia por quê.
      const jaEDeOutro = error.code === '23505';
      console.error('[profile/telegram] update falhou:', error.code, error.message);
      return json(
        {
          error: jaEDeOutro
            ? 'Este Telegram já está ligado à conta de outra pessoa. Se for engano, peça para ela desligar no perfil dela.'
            : 'Não foi possível salvar. Tente de novo.',
        },
        jaEDeOutro ? 409 : 500,
      );
    }

    // O código morre aqui: usado uma vez, não serve mais.
    await admin.from('telegram_vinculos_pendentes').delete().eq('profile_id', user.id);

    // Confirma NO TELEGRAM, não só na tela: é a prova de que aquele chat é
    // alcançável de verdade. Se não sair, a pessoa precisa saber AGORA — no
    // silêncio de amanhã às 8h isso passaria por "não tenho nada pendente".
    let confirmou = true;
    try {
      await sendTelegramMessage(
        token,
        chat.chatId,
        '✅ <b>Pronto.</b> É por aqui que você vai receber o seu resumo do dia, ' +
          'às 8h, em dia útil.\n\n<i>Se quiser parar de receber, é só desligar no seu perfil, no CRM.</i>',
      );
    } catch (e) {
      confirmou = false;
      console.error('[profile/telegram] confirmação não saiu:', e);
    }

    return json({ encontrado: true, primeiroNome: chat.primeiroNome, confirmou });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[profile/telegram] falhou:', msg);
    // A `description` crua da API não ajuda quem está lendo a tela ("terminated
    // by other getUpdates request" não é acionável para o Pedro).
    return json(
      { error: 'O Telegram não respondeu agora. Tente de novo em alguns segundos — se insistir, avise a administração.' },
      502,
    );
  }
}

export async function DELETE(req: Request): Promise<Response> {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const user = await usuarioDaSessao();
  if (!user) return json({ error: 'Sessão expirada. Entre de novo.' }, 401);

  const admin = createStaticAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({ telegram_chat_id: null })
    .eq('id', user.id);

  if (error) {
    console.error('[profile/telegram] desligar falhou:', error.message);
    return json({ error: 'Não foi possível desligar. Tente de novo.' }, 500);
  }
  return json({ ok: true });
}
