/**
 * @fileoverview Liga o som de mensagem nova ao realtime do shell.
 *
 * Mora aqui e não no `MessagingPage` pelo mesmo motivo da assinatura de realtime (ver
 * `components/Layout.tsx`): o valor está justamente em avisar quem NÃO está olhando o chat.
 *
 * @module hooks/useSomMensagemNova
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  criarTocador,
  criarContextoDoNavegador,
  ehMensagemNovaDoCliente,
  somEstaLigado,
  definirSom,
} from '@/lib/notifications/somMensagemNova';

export function useSomMensagemNova() {
  // Começa `true` no servidor e no primeiro render para não divergir na hidratação; o valor
  // real do localStorage entra no efeito abaixo.
  const [ligado, setLigado] = useState(true);
  const ligadoRef = useRef(true);

  const tocador = useMemo(
    () => criarTocador({ criarContexto: criarContextoDoNavegador }),
    []
  );

  useEffect(() => {
    const atual = somEstaLigado(typeof window === 'undefined' ? null : window.localStorage);
    setLigado(atual);
    ligadoRef.current = atual;
  }, []);

  /**
   * Destrava o áudio no primeiro gesto do usuário.
   *
   * Sem isto o primeiro aviso do dia é ENGOLIDO: o navegador só deixa tocar depois de um
   * clique/tecla na página, e o primeiro cliente a responder cairia justamente nessa janela.
   * `once: true` — um gesto basta para o contexto ficar 'running' pelo resto da sessão.
   *
   * ⚠️ Tem que ser `preparar()` do MESMO tocador que vai tocar depois. Até 02/09/2026 isto
   * chamava `criarTocador(...)` e jogava o resultado fora — e como o contexto de áudio só
   * nasce lá dentro de `tocar`, o gesto do usuário não acordava coisa nenhuma. Era um
   * destravamento que não destravava; o Pedro relatou em 01/09 que o som não chegava.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const destravar = () => { void tocador.preparar(); };
    const opts = { once: true, passive: true } as const;
    window.addEventListener('pointerdown', destravar, opts);
    window.addEventListener('keydown', destravar, opts);
    return () => {
      window.removeEventListener('pointerdown', destravar);
      window.removeEventListener('keydown', destravar);
    };
  }, [tocador]);

  /** Passe direto no `onchange` do realtime. Ignora tudo que não seja mensagem do cliente. */
  const aoMudarRealtime = useCallback(
    (payload: unknown) => {
      if (!ligadoRef.current) return;
      if (!ehMensagemNovaDoCliente(payload)) return;
      void tocador.tocar();
    },
    [tocador]
  );

  const alternarSom = useCallback(() => {
    const novo = !ligadoRef.current;
    ligadoRef.current = novo;
    setLigado(novo);
    definirSom(novo, typeof window === 'undefined' ? null : window.localStorage);
    // Toca ao LIGAR: confirma que o som funciona neste navegador/volume, que é a dúvida
    // real de quem acabou de ativar.
    if (novo) void tocador.tocar();
  }, [tocador]);

  return { ligado, alternarSom, aoMudarRealtime };
}
