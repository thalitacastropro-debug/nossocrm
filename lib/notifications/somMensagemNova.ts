/**
 * @fileoverview Som de aviso quando o cliente manda mensagem.
 *
 * O badge de não-lida existe desde 27/08/2026, mas é MUDO: quem está com o CRM aberto em
 * outra aba (ou olhando o funil) não percebe o cliente respondendo — só vê quando volta na
 * mensageria. Pedido do Denilson em 28/08: *"som quando chega notificação"*.
 *
 * Decisões:
 * - O gatilho é o INSERT de realtime em `messaging_messages` com `direction='inbound'`, e não
 *   o contador do badge. O contador conta CONVERSAS não lidas: cliente que manda a 2ª, 3ª e 4ª
 *   mensagem na mesma conversa não mexe o número — e é exatamente aí que o som importa.
 * - O som é SINTETIZADO (WebAudio), não um arquivo. Sem asset no bundle, sem requisição, sem
 *   CSP pra ajustar, e funciona offline.
 * - Nasce LIGADO. O pedido era ouvir; quem quiser silêncio desliga no menu.
 *
 * @module lib/notifications/somMensagemNova
 */

export const CHAVE_SOM_MENSAGEM = 'niva:som-mensagem-nova';

/** Só o que precisamos de um Storage — deixa o teste passar um objeto simples. */
type StorageMinimo = Pick<Storage, 'getItem' | 'setItem'>;

/** Recorte do payload do Supabase Realtime que interessa aqui. */
export interface EventoRealtime {
  eventType?: string;
  table?: string;
  new?: Record<string, unknown> | null;
}

/**
 * Toca? Só para mensagem NOVA (INSERT) que veio DO CLIENTE (inbound).
 *
 * O guard de `outbound` não é detalhe: sem ele a Ana faz barulho a cada bolha que ela mesma
 * manda — e ela manda em rajada (opener em 3-4 bolhas com stagger).
 */
export function ehMensagemNovaDoCliente(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const e = payload as EventoRealtime;
  if (e.eventType !== 'INSERT') return false;
  if (e.table !== 'messaging_messages') return false;
  if (!e.new || typeof e.new !== 'object') return false;
  return e.new.direction === 'inbound';
}

/**
 * Preferência do usuário. Ausente = ligado.
 *
 * Toda leitura é embrulhada: em aba anônima (ou com dados de site bloqueados) o próprio
 * acesso ao localStorage JOGA, e um erro aqui derrubaria o shell inteiro do CRM.
 */
export function somEstaLigado(storage: StorageMinimo | null | undefined): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(CHAVE_SOM_MENSAGEM) !== 'off';
  } catch {
    return true;
  }
}

export function definirSom(ligado: boolean, storage: StorageMinimo | null | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(CHAVE_SOM_MENSAGEM, ligado ? 'on' : 'off');
  } catch {
    /* modo privado: a preferência não persiste, mas a tela não pode cair por isso */
  }
}

/** Subconjunto do AudioContext que o tocador usa (o teste injeta um dublê). */
interface ContextoDeAudio {
  state: string;
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: { setValueAtTime(valor: number, quando: number): void };
    connect(destino: unknown): void;
    start(quando: number): void;
    stop(quando: number): void;
  };
  createGain(): {
    gain: {
      setValueAtTime(valor: number, quando: number): void;
      exponentialRampToValueAtTime(valor: number, quando: number): void;
    };
    connect(destino: unknown): void;
  };
}

export interface TocadorDeps {
  criarContexto: () => ContextoDeAudio | null;
}

/** Duas notas curtas, subindo — lê como "chegou algo", não como alarme. */
const NOTAS_HZ = [880, 1174.66]; // Lá5, Ré6
const DURACAO_NOTA = 0.12;

/**
 * Cria o tocador. O AudioContext é criado UMA vez e reaproveitado: navegador limita quantos
 * contextos existem por aba, e criar um por mensagem trava o áudio depois de algumas dezenas.
 */
export function criarTocador(deps: TocadorDeps) {
  let contexto: ContextoDeAudio | null = null;

  /**
   * Cria e acorda o contexto SEM tocar nada. É o que o primeiro gesto do usuário chama.
   *
   * Precisa ser função DESTE tocador (e não um `criarTocador` novo, que era o bug até
   * 02/09/2026): quem toca o som é o contexto guardado aqui dentro. Um tocador criado só
   * para "destravar" nem chega a instanciar contexto — a criação é preguiçosa, dentro de
   * `tocar` — então o gesto do usuário passava em branco e o contexto real continuava
   * `suspended` até a primeira mensagem, já fora da janela do gesto, quando o navegador
   * pode recusar o `resume`. Resultado: o aviso saía mudo.
   */
  async function preparar(): Promise<boolean> {
    try {
      if (!contexto) contexto = deps.criarContexto();
      if (!contexto) return false;
      if (contexto.state === 'suspended') await contexto.resume();
      return contexto.state === 'running';
    } catch {
      return false;
    }
  }

  async function tocar(): Promise<boolean> {
    try {
      if (!contexto) contexto = deps.criarContexto();
      if (!contexto) return false;

      // Autoplay: antes do primeiro gesto do usuário o contexto nasce 'suspended'. Tentamos
      // acordar; se o navegador recusar, o som simplesmente não sai — nunca vira erro na tela.
      if (contexto.state === 'suspended') await contexto.resume();
      if (contexto.state === 'closed') return false;

      const inicio = contexto.currentTime;
      NOTAS_HZ.forEach((hz, i) => {
        const ctx = contexto as ContextoDeAudio;
        const quando = inicio + i * DURACAO_NOTA;
        const osc = ctx.createOscillator();
        const ganho = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(hz, quando);
        // Decaimento exponencial: sem isso o corte seco estala.
        ganho.gain.setValueAtTime(0.0001, quando);
        ganho.gain.exponentialRampToValueAtTime(0.18, quando + 0.01);
        ganho.gain.exponentialRampToValueAtTime(0.0001, quando + DURACAO_NOTA);
        osc.connect(ganho);
        ganho.connect(ctx.destination);
        osc.start(quando);
        osc.stop(quando + DURACAO_NOTA);
      });
      return true;
    } catch {
      return false;
    }
  }

  return { tocar, preparar };
}

/** Fábrica real do navegador. Fora do browser (SSR) devolve null. */
export function criarContextoDoNavegador(): ContextoDeAudio | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    (window as unknown as { AudioContext?: new () => ContextoDeAudio }).AudioContext ??
    (window as unknown as { webkitAudioContext?: new () => ContextoDeAudio }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}
