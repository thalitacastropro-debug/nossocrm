'use client';

/**
 * @fileoverview O bloco do perfil onde a pessoa liga (ou desliga) o resumo do
 * próprio dia no Telegram.
 *
 * Existe porque o bot **não pode puxar conversa**: o Telegram só deixa o bot
 * responder a quem falou com ele antes. Então a pessoa precisa mandar uma
 * mensagem primeiro, e esta tela é o que transforma esse passo estranho em algo
 * de 20 segundos.
 *
 * ## Por que o código aparece SEMPRE, e não escondido atrás de "deu errado"
 *
 * O caminho feliz é o deep link (`?start=CÓDIGO`): o Telegram mostra o botão
 * INICIAR e manda o código sozinho. Mas isso só vale em conversa NOVA — quem já
 * falou com o bot alguma vez (inclusive numa tentativa anterior que falhou)
 * abre a conversa sem botão nenhum e precisa mandar o código na mão. Como não
 * dá para saber de fora em qual dos dois casos a pessoa está, a tela mostra os
 * dois: o botão para quem nunca falou, e o código para quem já falou.
 *
 * Por que CADA UM liga o seu: o `chat_id` só existe depois que a pessoa fala
 * com o bot. Ninguém consegue fazer isso pelo outro — e é bom que seja assim,
 * porque quem não quer receber simplesmente não liga.
 *
 * @module features/profile/DiarioNoTelegram
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Check, Copy, Loader2, Send } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const BOT = 'stellaCeoBot';

type Estado = 'parado' | 'conectando' | 'nao-achou' | 'erro';

export const DiarioNoTelegram: React.FC = () => {
  const { profile, refreshProfile } = useAuth();
  const [estado, setEstado] = useState<Estado>('parado');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [desligando, setDesligando] = useState(false);
  const [codigo, setCodigo] = useState<string | null>(null);

  const ligado = !!profile?.telegram_chat_id;

  /** Sorteia o código no servidor. Ele vale poucos minutos e morre no uso. */
  const pedirCodigo = useCallback(async (): Promise<string | null> => {
    try {
      const r = await fetch('/api/profile/telegram', { method: 'PUT' });
      const corpo = (await r.json().catch(() => ({}))) as { codigo?: string; error?: string };
      if (!r.ok || !corpo.codigo) {
        setErro(corpo.error ?? 'Não consegui gerar o seu código agora.');
        setEstado('erro');
        return null;
      }
      setCodigo(corpo.codigo);
      return corpo.codigo;
    } catch {
      setErro('Não deu para falar com o servidor.');
      setEstado('erro');
      return null;
    }
  }, []);

  // Quem já está ligado não precisa de código nenhum.
  useEffect(() => {
    if (!ligado && !codigo) void pedirCodigo();
  }, [ligado, codigo, pedirCodigo]);

  const copiar = async () => {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem clipboard (webview do WhatsApp, http, permissão negada) o silêncio
      // faria a pessoa clicar de novo achando que travou.
      setAviso('Não consegui copiar aqui — anote o código ou selecione com o dedo.');
    }
  };

  const conectar = async () => {
    setEstado('conectando');
    setErro(null);
    setAviso(null);
    try {
      const r = await fetch('/api/profile/telegram', { method: 'POST' });
      const corpo = (await r.json().catch(() => ({}))) as {
        encontrado?: boolean;
        expirado?: boolean;
        confirmou?: boolean;
        filaCheia?: boolean;
        error?: string;
      };

      if (!r.ok) {
        setErro(corpo.error ?? 'Não deu para conectar agora.');
        setEstado('erro');
        return;
      }

      // Código vencido: sorteia outro e pede para repetir, em vez de deixar a
      // pessoa mandando um código que não vale mais.
      if (corpo.expirado) {
        setCodigo(null);
        const novo = await pedirCodigo();
        if (novo) {
          setErro('O código anterior venceu. Mande este novo para o bot e clique de novo.');
          setEstado('erro');
        }
        return;
      }

      if (!corpo.encontrado) {
        setEstado('nao-achou');
        if (corpo.filaCheia) {
          setAviso('A caixa do bot está cheia de mensagens antigas. Se não funcionar, avise a administração.');
        }
        return;
      }

      if (corpo.confirmou === false) {
        setAviso('Liguei aqui, mas a mensagem de confirmação não chegou no seu Telegram. Confira se o bot não está bloqueado.');
      }
      setEstado('parado');
    } catch {
      setErro('Não deu para falar com o servidor.');
      setEstado('erro');
      return;
    }

    // Fora do try: se a releitura do perfil falhar, o vínculo JÁ foi feito —
    // mostrar erro aqui faria a pessoa repetir tudo à toa.
    try {
      await refreshProfile();
    } catch {
      /* a tela atualiza no próximo carregamento */
    }
  };

  const desligar = async () => {
    setDesligando(true);
    setErro(null);
    try {
      const r = await fetch('/api/profile/telegram', { method: 'DELETE' });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => ({}))) as { error?: string };
        setErro(corpo.error ?? 'Não consegui desligar. Tente de novo.');
        setEstado('erro');
        return;
      }
      await refreshProfile();
      setCodigo(null);
    } catch {
      setErro('Não deu para falar com o servidor.');
      setEstado('erro');
    } finally {
      setDesligando(false);
    }
  };

  if (!profile) return null;

  /**
   * Deep link: `?start=PAYLOAD` faz o app enviar "/start PAYLOAD" quando a
   * pessoa aperta INICIAR — o código vai junto sem ela digitar nada. Só
   * funciona em conversa nova, que é por que o código continua visível abaixo.
   */
  const linkComCodigo = codigo
    ? `https://t.me/${BOT}?start=${encodeURIComponent(codigo)}`
    : `https://t.me/${BOT}`;

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card p-5">
      <header className="flex items-start gap-3">
        <div className="rounded-lg bg-primary-500/10 p-2 text-primary-600 dark:text-primary-400">
          <Send className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Resumo do seu dia no Telegram
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Em dia útil, às 8h, o que precisa da sua atenção primeiro — montado a partir do
            que está no CRM. Em dia sem nada pendente, não chega mensagem.
          </p>
        </div>
      </header>

      <div aria-live="polite" className="empty:hidden">
        {erro && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-900 dark:text-red-200"
          >
            {erro}
          </p>
        )}
        {aviso && (
          <p className="mt-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            {aviso}
          </p>
        )}
        {estado === 'nao-achou' && (
          <p className="mt-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
            Ainda não achei a sua mensagem. Confira se mandou <strong>{codigo}</strong> para{' '}
            <strong>@{BOT}</strong> e clique de novo — às vezes leva alguns segundos.
          </p>
        )}
      </div>

      {ligado ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-800 dark:text-emerald-300">
            <Bell className="h-4 w-4" aria-hidden="true" />
            Ligado
          </span>
          <button
            onClick={desligar}
            disabled={desligando}
            aria-busy={desligando}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/10 px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50 focus-visible-ring"
          >
            {desligando ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
            {desligando ? 'Desligando…' : 'Parar de receber'}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <ol className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10 text-xs font-semibold">
                1
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={linkComCodigo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#229ED9] px-3 py-2 text-sm font-medium text-white hover:brightness-110 focus-visible-ring"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Abrir o bot no Telegram
                </a>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  <strong>Se aparecer o botão INICIAR</strong>, aperte — o seu código vai junto
                  sozinho. <strong>Se a conversa já existir</strong> (sem botão), mande o código
                  abaixo como mensagem.
                </p>
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10 text-xs font-semibold">
                2
              </span>
              <div className="min-w-0 flex-1">
                <span>Este é o seu código:</span>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="select-all rounded-lg bg-slate-100 dark:bg-white/10 px-3 py-1.5 font-mono text-sm font-semibold tracking-wider text-slate-900 dark:text-white">
                    {codigo ?? '…'}
                  </code>
                  <button
                    onClick={copiar}
                    disabled={!codigo}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 disabled:opacity-50 focus-visible-ring"
                  >
                    {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiado ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                {/* O código é secreto e de uso único: é ele que impede alguém de
                    ficar com o vínculo (e com o relatório) de outra pessoa. */}
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Vale por alguns minutos e é só seu — não passe para ninguém.
                </p>
              </div>
            </li>

            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-white/10 text-xs font-semibold">
                3
              </span>
              <span>Volte aqui e clique no botão abaixo.</span>
            </li>
          </ol>

          <button
            onClick={conectar}
            disabled={estado === 'conectando' || !codigo}
            aria-busy={estado === 'conectando'}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 focus-visible-ring"
          >
            {estado === 'conectando' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {estado === 'conectando' ? 'Procurando…' : 'Já fiz — pode ligar'}
          </button>
        </div>
      )}
    </section>
  );
};

export default DiarioNoTelegram;
