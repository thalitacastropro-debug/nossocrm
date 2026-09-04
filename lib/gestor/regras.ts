/**
 * @fileoverview As regras do gestor comercial diário.
 *
 * Pedido da Thalita em 31/08/2026: *"como se eu fosse fazer uma daily com o
 * colaborador e atentá-lo para o que é necessário e mais urgente daquele dia"*.
 * Um bloco por colaborador; ela recebe tudo.
 *
 * ## A decisão que define este arquivo: DIÁRIO DO QUE MUDOU, não lista de pendências
 *
 * A revisão adversarial simulou a lista de pendências rodando 30 dias seguidos:
 * ela foi **idêntica à do dia anterior em 28 dos 30 dias**. Um alerta que repete
 * a mesma coisa toda manhã vira papel de parede na segunda semana — e aí o
 * relatório inteiro perde o poder de interromper alguém.
 *
 * Então cada regra separa duas coisas:
 * - **NOVO**: o que entrou no estado ontem. É isto que vai listado, com nome.
 * - **ESTOQUE**: quantos casos existem no total. Vai só como número.
 *
 * O "novo" é calculado por TIMESTAMP, não por comparação com o relatório de
 * ontem. Sem estado guardado, o relatório não mente se um dia falhar: ele não
 * depende de ter rodado ontem para saber o que é novo hoje.
 *
 * ## O que este módulo NÃO faz
 * Não calcula taxa de comparecimento, no-show nem conversão. Com 7 reuniões em
 * agosto e 1 venda válida em 2 meses, uma reunião a mais move a "taxa" em 33
 * pontos — é aritmética de uma observação, não estatística. Métrica assim
 * pareceria informação e seria ruído; pior, puniria alguém por um buraco de
 * preenchimento. Entra quando houver volume e o campo tiver lastro.
 *
 * @module lib/gestor/regras
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Brasília. Mesmo offset fixo do resto do CRM (scheduling, follow-up). */
const TZ_OFFSET_HOURS = -3;

/** Silêncio que já é constrangedor dentro do expediente. */
const HORAS_SEM_RESPOSTA = 4;

/**
 * Quanto tempo o lead tem para responder ao PRIMEIRO contato antes de virar
 * tarefa de telefone.
 *
 * 24h porque a cadência da Ana ainda tenta por mensagem dentro do primeiro dia;
 * depois disso, insistir por escrito é repetir o que já não funcionou.
 */
const HORAS_SEM_PRIMEIRA_RESPOSTA = 24;

/** A partir daqui o card está parado, não em andamento. */
const DIAS_PARADO = 30;

/**
 * Silêncio tolerado na etapa mais perto da receita.
 *
 * 3 dias porque negociação é a etapa em que o lead já disse sim ao diagnóstico e
 * está decidindo — o esfriamento aqui é rápido e caro. Decisão da Thalita em
 * 03/09/2026, com os números na mão: com 3 dias entram 6 dos 12 cards abertos;
 * com 2 entrariam 10 (papel de parede na estreia) e com 5 a Angela Cristina,
 * que originou o pedido, não apareceria.
 */
const DIAS_NEGOCIACAO_PARADA = 3;

/** Teto por lista NO TEXTO: o Pedro tem 156 cards abertos; relatório de 40 linhas ninguém lê. */
const MAX_POR_LISTA = 5;

/**
 * Quantos itens cada regra GUARDA antes de o texto ser montado.
 *
 * Precisa ser maior que `MAX_POR_LISTA` por causa do relatório individual: o
 * corte acontecia aqui, sobre a lista do time inteiro, e só depois o texto de
 * cada pessoa filtrava por dono. Resultado silencioso — se os 5 itens mais
 * antigos fossem todos do Denilson, o Pedro recebia "nada novo entrou desde
 * ontem" tendo dois leads sem resposta. O relatório mentia sem errar uma conta.
 *
 * Agora guardamos com folga e quem corta é o formatador, depois de saber para
 * quem está escrevendo.
 */
const MAX_GUARDADOS = 30;

export interface ItemAlerta {
  /** Para quem é a cobrança. `null` = sem dono (é uma pendência da casa). */
  donoId: string | null;
  donoNome: string;
  contato: string;
  detalhe: string;
  /** Há quantos dias/horas — para ordenar por gravidade. */
  idadeHoras: number;
  dealId?: string;
}

export interface Regra {
  id: string;
  titulo: string;
  emoji: string;
  /** Só a Thalita vê (decisão dela em 31/08: contradição não vai para o time). */
  sigiloso?: boolean;
  novos: ItemAlerta[];
  estoque: number;
  /**
   * Quantos do estoque são de cada pessoa. É o que permite o relatório dele
   * dizer "ainda em aberto com você: 10" — sem isso, quem tinha 10 reuniões
   * vencidas e nenhuma novidade recebia bloco vazio e sumia do radar.
   * `null` como chave = sem dono.
   */
  estoquePorDono?: Record<string, number>;
  /**
   * Os itens do estoque, com nome — não só a contagem.
   *
   * Pedido da Thalita em 03/09/2026: *"falaram e nao respondeu, Que lead é
   * esse? quais sao as reunioes sem desfecho? o direcionamento precisa estar
   * claro"*. Contagem não é tarefa: quem lê "Falaram e ninguém respondeu: 17"
   * ainda precisa abrir o CRM para descobrir quem são.
   *
   * Continua valendo a regra de não repetir lista inteira todo dia — quem corta
   * é o formatador, que mostra só os primeiros e conta o resto.
   */
  estoqueItens?: ItemAlerta[];
  /**
   * O gesto EXATO que tira o item da lista, na segunda pessoa.
   *
   * Pedido da Thalita em 02/09/2026: o relatório do Pedro tem que ser
   * explicativo — *"ele precisa entender as prioridades do dia e que será
   * cobrado de acordo com o que preenche ou deixa de preencher no sistema"*.
   * Sem isto o alerta diz o que está errado e deixa a pessoa adivinhar o que
   * fazer; com isto ele vira tarefa. Só aparece no relatório INDIVIDUAL — no da
   * dona seria ruído, ela não é quem executa.
   */
  acao?: string;
}

/** Conta os itens por dono, para o acumulado individual. */
function contarPorDono(itens: ItemAlerta[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const i of itens) {
    const chave = i.donoId ?? 'sem-dono';
    mapa[chave] = (mapa[chave] ?? 0) + 1;
  }
  return mapa;
}

export interface Diario {
  data: string;
  regras: Regra[];
  /** Sinal de vida da operação: o que de fato aconteceu ontem. */
  ontem: { mensagensDeLead: number; notasEscritas: number; reunioesMarcadas: number };
}

const horasEntre = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 36e5;

/**
 * Conversas que NÃO são cobrança de ninguém.
 *
 * Rodando as regras contra a produção em 31/08/2026, a lista de "falaram e
 * ninguém respondeu" trouxe junto: o número da própria Thalita, um disparo
 * publicitário da Claro e uma conversa cuja última mensagem era só "👍🏻". Nada
 * disso é lead esperando resposta, e cada linha falsa custa a credibilidade das
 * verdadeiras.
 */
const RUIDO_TEXTO = /^(ok|okay|obrigad[oa]|valeu|blz|beleza|👍|👌|🙏|❤️|tá|ta|sim|não|nao)[\s!.]*$/i;

/** Só emoji/pontuação = não é pedido de resposta. */
const SO_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s!.,]*$/u;

export function ehRuido(opts: {
  nomeContato: string | null;
  telefoneContato: string | null;
  ultimaFala: string | null;
  /** Telefones do próprio time/canal — conversa com a casa não é lead. */
  telefonesInternos: Set<string>;
  nomesInternos: Set<string>;
}): boolean {
  const fala = (opts.ultimaFala ?? '').trim();
  if (fala && (RUIDO_TEXTO.test(fala) || SO_EMOJI.test(fala))) return true;

  const tel = (opts.telefoneContato ?? '').replace(/\D/g, '');
  if (tel && opts.telefonesInternos.has(tel)) return true;

  const nome = (opts.nomeContato ?? '').trim().toLowerCase();
  if (nome && opts.nomesInternos.has(nome)) return true;

  return false;
}

const nomeDe = (p: { nickname?: string | null; name?: string | null; first_name?: string | null } | undefined | null) =>
  p ? p.nickname || p.name || p.first_name || 'Sem nome' : 'Sem dono';

/** "há 3 dias" / "há 5h" — como uma pessoa falaria. */
export function idadeLegivel(horas: number): string {
  if (horas < 24) return `há ${Math.round(horas)}h`;
  const dias = Math.round(horas / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

export interface DepsGestor {
  supabase: SupabaseClient;
  now: Date;
}

/**
 * Monta o diário. Uma consulta por regra, sem IA: tudo aqui é fato que o
 * sistema registrou sozinho, sem depender de ninguém clicar. É o que dá para
 * afirmar sem risco de acusar alguém por buraco de preenchimento.
 */
export async function montarDiario(deps: DepsGestor): Promise<Diario> {
  const { supabase, now } = deps;
  const ontem = new Date(now.getTime() - 24 * 36e5);

  const { data: perfisRaw } = await supabase
    .from('profiles')
    .select('id, name, nickname, first_name, role');
  const perfis = new Map(
    ((perfisRaw ?? []) as Array<{ id: string }>).map((p) => [p.id, p as Parameters<typeof nomeDe>[0]]),
  );

  const regras: Regra[] = [];

  // A ORDEM AQUI É A ORDEM DAS PRIORIDADES no relatório individual — o
  // formatador percorre as regras nesta sequência e corta nas 5 primeiras.
  // Negociação parada vem primeiro por decisão da Thalita em 03/09: é a etapa
  // mais perto da receita, e venda quase feita esfriando custa mais caro que
  // mensagem sem responder, que é recuperável a qualquer hora do dia.
  regras.push(await regraNegociacaoParada(supabase, now, perfis));
  regras.push(await regraSemResposta(supabase, now, ontem, perfis));
  regras.push(await regraSemPrimeiraResposta(supabase, now, perfis));
  regras.push(await regraReuniaoVencida(supabase, now, ontem, perfis));
  regras.push(await regraContradicao(supabase, now, ontem, perfis));
  regras.push(await regraEnvioFalhou(supabase, now, ontem));
  regras.push(await regraVendaSemPremio(supabase, now, perfis));

  return { data: diaBrt(now), regras, ontem: await pulsoDeOntem(supabase, ontem) };
}

/** Data de hoje em Brasília, para o cabeçalho. */
function diaBrt(now: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit',
  }).format(now);
}

/**
 * 1. O LEAD FALOU E NINGUÉM RESPONDEU.
 *
 * O sinal mais confiável do banco: não depende de ninguém marcar nada. Foi ele
 * que achou a Lilian Bosi ("Não ligou ainda", 34 dias) e o "Cancelar" do
 * NegroRaroThiLipe parado 13 dias — casos que ninguém lembrava de cabeça.
 */
async function regraSemResposta(
  supabase: SupabaseClient, now: Date, ontem: Date, perfis: Map<string, unknown>,
): Promise<Regra> {
  const { data } = await supabase
    .from('messaging_conversations')
    .select('id, contact_id, assigned_user_id, last_message_at, last_message_direction, last_message_preview')
    .eq('last_message_direction', 'inbound')
    .lte('last_message_at', new Date(now.getTime() - HORAS_SEM_RESPOSTA * 36e5).toISOString())
    .order('last_message_at', { ascending: true });

  const linhas = (data ?? []) as Array<{
    id: string; contact_id: string | null; assigned_user_id: string | null;
    last_message_at: string; last_message_preview: string | null;
  }>;

  const contatoIds = [...new Set(linhas.map((l) => l.contact_id).filter(Boolean))] as string[];
  const { data: contatosRaw } = contatoIds.length
    ? await supabase.from('contacts').select('id, name, owner_id, phone').in('id', contatoIds)
    : { data: [] };
  const contatos = new Map(
    ((contatosRaw ?? []) as Array<{ id: string; name: string | null; owner_id: string | null; phone: string | null }>)
      .map((c) => [c.id, c]),
  );

  const { telefonesInternos, nomesInternos } = await internos(supabase);

  const todos: ItemAlerta[] = linhas
    .filter((l) => {
      const c = l.contact_id ? contatos.get(l.contact_id) : undefined;
      return !ehRuido({
        nomeContato: c?.name ?? null,
        telefoneContato: c?.phone ?? null,
        ultimaFala: l.last_message_preview,
        telefonesInternos,
        nomesInternos,
      });
    })
    .map((l) => {
      const c = l.contact_id ? contatos.get(l.contact_id) : undefined;
      const donoId = l.assigned_user_id ?? c?.owner_id ?? null;
      const previa = (l.last_message_preview ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
      return {
        donoId,
        donoNome: nomeDe(perfis.get(donoId ?? '') as Parameters<typeof nomeDe>[0]),
        contato: c?.name ?? 'Sem nome',
        detalhe: previa ? `"${previa}"` : '(sem texto)',
        idadeHoras: horasEntre(now, new Date(l.last_message_at)),
        dealId: undefined,
      };
    });

  // NOVO = ficou sem resposta desde ontem. O que já estava mudo antes é estoque:
  // aparece como número, não como lista repetida todo dia.
  const novos = todos.filter((i) => {
    const quando = new Date(now.getTime() - i.idadeHoras * 36e5);
    return quando >= ontem;
  });

  return {
    id: 'sem-resposta',
    titulo: 'Falaram e ninguém respondeu',
    emoji: '🔴',
    acao: 'Responder no chat do CRM.',
    novos: ordenar(novos),
    estoque: todos.length,
    estoquePorDono: contarPorDono(todos),
    estoqueItens: ordenar(todos),
  };
}

/**
 * 0. NEGOCIAÇÃO PARADA — a etapa mais perto da receita ficou muda.
 *
 * O buraco que ninguém tinha visto: até 03/09/2026 **nenhuma regra olhava
 * ETAPA**. Um grep por `stage_id`/`board_id` neste arquivo dava zero, e a
 * constante `DIAS_PARADO` estava declarada sem nenhum uso — a regra de card
 * parado foi planejada e nunca construída. Resultado: os cards a um passo do
 * fechamento não apareciam em lugar nenhum do diário.
 *
 * O caso que abriu isso foi a Angela Cristina Lessa: em negociação, e o último
 * sinal era ELA dizendo *"Boa tarde! Ok"* em 31/08. O lead concordou e ninguém
 * voltou. Ela só aparecia diluída no acumulado de "falaram e ninguém
 * respondeu", entre outros 16, sem dizer em que etapa estava.
 *
 * "Sinal de vida" aqui é qualquer mensagem (nos dois sentidos) ou nota no card.
 * Nota conta de propósito: o consultor pode ter ligado, e a ligação só existe
 * para o sistema se ele registrou.
 *
 * ⚠️ ESTA REGRA NÃO MOSTRA DINHEIRO. `deals.value` é a mensalidade que o LEAD
 * paga hoje no plano ANTIGO, não o valor da venda — foi exatamente o campo que
 * o validador de saída tratou como PII em agosto e matou 2 leads pagos. Dizer
 * "R$ 3.200 parados" seria mentira. Ordena por tempo parado, e só.
 */
async function regraNegociacaoParada(
  supabase: SupabaseClient, now: Date, perfis: Map<string, unknown>,
): Promise<Regra> {
  const vazia: Regra = {
    id: 'negociacao-parada',
    titulo: 'Negociação parada',
    emoji: '💸',
    acao: 'Falar com o lead hoje e mover o card: fechou, perdeu ou remarcou.',
    novos: [],
    estoque: 0,
  };

  const { data: etapasRaw } = await supabase
    .from('board_stages').select('id, name').eq('name', 'negociacao');
  const etapas = ((etapasRaw ?? []) as Array<{ id: string }>).map((e) => e.id);
  if (etapas.length === 0) return vazia;

  const { data: dealsRaw } = await supabase
    .from('deals')
    .select('id, title, owner_id, contact_id, last_stage_change_date')
    .in('stage_id', etapas)
    .eq('is_won', false)
    .eq('is_lost', false)
    .is('deleted_at', null);
  const negocios = (dealsRaw ?? []) as Array<{
    id: string; title: string | null; owner_id: string | null;
    contact_id: string | null; last_stage_change_date: string | null;
  }>;
  if (negocios.length === 0) return vazia;

  const contatoIds = [...new Set(negocios.map((d) => d.contact_id).filter(Boolean))] as string[];
  const { data: contatosRaw } = contatoIds.length
    ? await supabase.from('contacts').select('id, name, owner_id').in('id', contatoIds)
    : { data: [] };
  const contatos = new Map(
    ((contatosRaw ?? []) as Array<{ id: string; name: string | null; owner_id: string | null }>)
      .map((c) => [c.id, c]),
  );

  const { data: convsRaw } = contatoIds.length
    ? await supabase.from('messaging_conversations').select('contact_id, last_message_at').in('contact_id', contatoIds)
    : { data: [] };
  const ultimaMensagem = new Map<string, number>();
  for (const c of ((convsRaw ?? []) as Array<{ contact_id: string | null; last_message_at: string | null }>)) {
    if (!c.contact_id || !c.last_message_at) continue;
    const t = new Date(c.last_message_at).getTime();
    ultimaMensagem.set(c.contact_id, Math.max(ultimaMensagem.get(c.contact_id) ?? 0, t));
  }

  const { data: ativRaw } = await supabase
    .from('activities').select('deal_id, created_at')
    .in('deal_id', negocios.map((d) => d.id))
    .is('deleted_at', null);
  const ultimaNota = new Map<string, number>();
  for (const a of ((ativRaw ?? []) as Array<{ deal_id: string | null; created_at: string | null }>)) {
    if (!a.deal_id || !a.created_at) continue;
    const t = new Date(a.created_at).getTime();
    ultimaNota.set(a.deal_id, Math.max(ultimaNota.get(a.deal_id) ?? 0, t));
  }

  const limiteMs = DIAS_NEGOCIACAO_PARADA * 24 * 36e5;

  const todos: ItemAlerta[] = [];
  for (const d of negocios) {
    // Sem mensagem e sem nota, a entrada na etapa é o último sinal honesto que
    // temos — melhor que descartar o card mais abandonado de todos.
    const sinal = Math.max(
      d.contact_id ? (ultimaMensagem.get(d.contact_id) ?? 0) : 0,
      ultimaNota.get(d.id) ?? 0,
      d.last_stage_change_date ? new Date(d.last_stage_change_date).getTime() : 0,
    );
    if (sinal === 0) continue;

    const silencioMs = now.getTime() - sinal;
    if (silencioMs < limiteMs) continue;

    const c = d.contact_id ? contatos.get(d.contact_id) : undefined;
    const donoId = d.owner_id ?? c?.owner_id ?? null;
    todos.push({
      donoId,
      donoNome: nomeDe(perfis.get(donoId ?? '') as Parameters<typeof nomeDe>[0]),
      contato: c?.name ?? d.title ?? 'Card sem nome',
      detalhe: 'sem mensagem nem nota desde então',
      idadeHoras: silencioMs / 36e5,
      dealId: d.id,
    });
  }

  // `ordenar` já põe o mais parado primeiro — que aqui é o mais grave.
  return { ...vazia, novos: ordenar(todos), estoque: todos.length, estoquePorDono: contarPorDono(todos) };
}

/**
 * 1b. RECEBEU O PRIMEIRO CONTATO E NUNCA RESPONDEU.
 *
 * O buraco que a regra 1 deixava: ela filtra `last_message_direction='inbound'`,
 * ou seja, só enxerga conversa em que o lead FALOU. Lead pago que recebeu o
 * primeiro toque da Ana e não respondeu nada tem `outbound` por último e era
 * invisível para o diário inteiro — foi o caso do Pablo, da Célia e da Rose,
 * parados desde 01/09/2026 sem aparecer em lugar nenhum.
 *
 * É o oposto de "silêncio nosso": aqui o silêncio é DELE. Por isso a ação não é
 * responder, é LIGAR — insistir por mensagem seria repetir o canal que já
 * falhou.
 *
 * Quem já respondeu alguma vez fica de fora, mesmo que a gente tenha falado por
 * último: essa conversa está viva e é cobrança de outra natureza.
 */
async function regraSemPrimeiraResposta(
  supabase: SupabaseClient, now: Date, perfis: Map<string, unknown>,
): Promise<Regra> {
  const vazia: Regra = {
    id: 'sem-primeira-resposta',
    titulo: 'Não respondeu ao primeiro contato',
    emoji: '📞',
    acao: 'Ligar — ele não respondeu por mensagem.',
    novos: [],
    estoque: 0,
  };

  const { data } = await supabase
    .from('messaging_conversations')
    .select('id, contact_id, assigned_user_id, last_message_at, last_message_direction')
    .eq('last_message_direction', 'outbound')
    .lte('last_message_at', new Date(now.getTime() - HORAS_SEM_PRIMEIRA_RESPOSTA * 36e5).toISOString())
    .order('last_message_at', { ascending: true });

  const linhas = (data ?? []) as Array<{
    id: string; contact_id: string | null; assigned_user_id: string | null; last_message_at: string;
  }>;
  if (linhas.length === 0) return vazia;

  // Uma única inbound na vida já tira a conversa daqui.
  const { data: falaram } = await supabase
    .from('messaging_messages')
    .select('conversation_id')
    .eq('direction', 'inbound')
    .in('conversation_id', linhas.map((l) => l.id));
  const jaFalaram = new Set(
    ((falaram ?? []) as Array<{ conversation_id: string }>).map((m) => m.conversation_id),
  );

  const mudas = linhas.filter((l) => !jaFalaram.has(l.id));
  if (mudas.length === 0) return vazia;

  const contatoIds = [...new Set(mudas.map((l) => l.contact_id).filter(Boolean))] as string[];
  const { data: contatosRaw } = contatoIds.length
    ? await supabase.from('contacts').select('id, name, owner_id, phone').in('id', contatoIds)
    : { data: [] };
  const contatos = new Map(
    ((contatosRaw ?? []) as Array<{ id: string; name: string | null; owner_id: string | null; phone: string | null }>)
      .map((c) => [c.id, c]),
  );

  const { telefonesInternos, nomesInternos } = await internos(supabase);

  const todos: ItemAlerta[] = mudas
    .filter((l) => {
      const c = l.contact_id ? contatos.get(l.contact_id) : undefined;
      // `ultimaFala` fica de fora de propósito: a última fala aqui é NOSSA, e o
      // filtro de ruído existe para julgar o que o LEAD disse.
      return !ehRuido({
        nomeContato: c?.name ?? null,
        telefoneContato: c?.phone ?? null,
        ultimaFala: null,
        telefonesInternos,
        nomesInternos,
      });
    })
    .map((l) => {
      const c = l.contact_id ? contatos.get(l.contact_id) : undefined;
      return {
        donoId: l.assigned_user_id ?? c?.owner_id ?? null,
        donoNome: nomeDe(perfis.get((l.assigned_user_id ?? c?.owner_id) ?? '') as Parameters<typeof nomeDe>[0]),
        contato: c?.name ?? 'Sem nome',
        detalhe: 'recebeu o primeiro contato e não respondeu',
        idadeHoras: horasEntre(now, new Date(l.last_message_at)),
        dealId: undefined,
      };
    });

  // Sem corte por "novo": o item só sai daqui quando alguém liga. Repetir é o
  // certo — é lead pago parado, do mesmo jeito que prêmio pendente é dinheiro
  // parado na regra 5.
  //
  // ORDEM AO CONTRÁRIO DAS OUTRAS REGRAS: aqui o mais RECENTE vem primeiro.
  // Nas regras de silêncio nosso, o mais antigo é a maior dívida; aqui o
  // silêncio é do lead, e quem parou de responder há 39 dias já esfriou. Quem
  // recebeu o primeiro toque anteontem ainda atende o telefone. Ordenar pelo
  // mais velho enterraria justamente os recuperáveis embaixo dos mortos.
  const doMaisFresco = [...todos].sort((a, b) => a.idadeHoras - b.idadeHoras).slice(0, MAX_GUARDADOS);

  return { ...vazia, novos: doMaisFresco, estoque: todos.length, estoquePorDono: contarPorDono(todos) };
}

/**
 * 2. REUNIÃO QUE VENCEU E NINGUÉM MARCOU O QUE ACONTECEU.
 *
 * ⚠️ Esta é a regra que MAIS pede o corte "novo x estoque": a lista completa
 * ficou congelada em 13 casos por 11 dias seguidos. Só lista a que venceu nas
 * últimas 24h — a que virou cobrança de HOJE.
 */
async function regraReuniaoVencida(
  supabase: SupabaseClient, now: Date, ontem: Date, perfis: Map<string, unknown>,
): Promise<Regra> {
  const { data } = await supabase
    .from('activities')
    .select('id, deal_id, owner_id, title, date')
    .eq('type', 'CALL')
    .eq('completed', false)
    .is('deleted_at', null)
    .lte('date', now.toISOString())
    .order('date', { ascending: false });

  const linhas = (data ?? []) as Array<{ id: string; deal_id: string | null; owner_id: string | null; title: string | null; date: string }>;
  const dealIds = [...new Set(linhas.map((l) => l.deal_id).filter(Boolean))] as string[];
  const nomes = await nomesDosCards(supabase, dealIds);

  const todos: ItemAlerta[] = linhas.map((l) => ({
    donoId: l.owner_id,
    donoNome: nomeDe(perfis.get(l.owner_id ?? '') as Parameters<typeof nomeDe>[0]),
    contato: nomes.get(l.deal_id ?? '') ?? l.title ?? 'Card sem nome',
    detalhe: 'aconteceu? deu no-show? ninguém marcou',
    idadeHoras: horasEntre(now, new Date(l.date)),
    dealId: l.deal_id ?? undefined,
  }));

  const novos = todos.filter((i) => i.idadeHoras <= horasEntre(now, ontem));

  return {
    id: 'reuniao-vencida',
    titulo: 'Reunião de ontem sem desfecho',
    emoji: '⏸️',
    acao: 'Abrir o card e gravar o desfecho por áudio: aconteceu, deu no-show ou foi remarcada.',
    novos: ordenar(novos),
    estoque: todos.length,
    estoquePorDono: contarPorDono(todos),
    estoqueItens: ordenar(todos),
  };
}

/**
 * 3. CONTRADIÇÃO: card carimbado "reunião realizada" e nenhuma nota escrita.
 *
 * 🔒 SÓ PARA A THALITA (decisão dela em 31/08). Se isto chegasse ao time, o
 * efeito previsível seria aprenderem a espaçar os cliques, não a preencher
 * melhor.
 *
 * O caso que originou a regra: em 31/08 quatro cards foram carimbados como
 * "realizada" em 29 segundos. Dois tinham nota com conteúdo real — a ligação
 * existiu. Um não tinha nada. O carimbo não carrega prova nenhuma, então o
 * alerta não acusa: ele mostra o que falta.
 */
async function regraContradicao(
  supabase: SupabaseClient, now: Date, ontem: Date, perfis: Map<string, unknown>,
): Promise<Regra> {
  const { data } = await supabase
    .from('activities')
    .select('id, deal_id, owner_id, date, created_at')
    .eq('type', 'CALL')
    .eq('completed', true)
    .is('deleted_at', null)
    .gte('date', new Date(now.getTime() - 30 * 24 * 36e5).toISOString());

  const calls = (data ?? []) as Array<{ deal_id: string | null; owner_id: string | null; date: string; created_at: string }>;
  const dealIds = [...new Set(calls.map((c) => c.deal_id).filter(Boolean))] as string[];
  if (dealIds.length === 0) {
    return { id: 'contradicao', titulo: 'Marcou realizada, não escreveu desfecho', emoji: '⚡', sigiloso: true, novos: [], estoque: 0 };
  }

  // Nota com texto de verdade depois da reunião = desfecho existe.
  const { data: notasRaw } = await supabase
    .from('activities')
    .select('deal_id, description, date')
    .in('deal_id', dealIds)
    .eq('type', 'NOTE')
    .is('deleted_at', null);
  const notas = (notasRaw ?? []) as Array<{ deal_id: string; description: string | null; date: string }>;

  const temDesfecho = new Set(
    notas
      // "Responsável alterado" e afins não são desfecho: são log do sistema.
      .filter((n) => (n.description ?? '').trim().length >= 40)
      .map((n) => n.deal_id),
  );

  const nomes = await nomesDosCards(supabase, dealIds);

  const todos: ItemAlerta[] = calls
    .filter((c) => c.deal_id && !temDesfecho.has(c.deal_id))
    .map((c) => ({
      donoId: c.owner_id,
      donoNome: nomeDe(perfis.get(c.owner_id ?? '') as Parameters<typeof nomeDe>[0]),
      contato: nomes.get(c.deal_id ?? '') ?? 'Card sem nome',
      detalhe: 'carimbou realizada, sem nota de desfecho',
      idadeHoras: horasEntre(now, new Date(c.created_at)),
      dealId: c.deal_id ?? undefined,
    }));

  const novos = todos.filter((i) => i.idadeHoras <= horasEntre(now, ontem));

  return {
    id: 'contradicao',
    titulo: 'Marcou realizada, não escreveu desfecho',
    emoji: '⚡',
    sigiloso: true,
    novos: ordenar(novos),
    estoque: todos.length,
    estoquePorDono: contarPorDono(todos),
  };
}

/**
 * 4. MENSAGEM QUE NÃO CHEGOU NO CLIENTE.
 *
 * Não é cobrança de ninguém, é alarme técnico — e foi o de maior impacto real
 * na investigação: 304 falhas em 30 dias, 291 delas para um único número que
 * não existe no WhatsApp, 39 tentativas por dia durante 3 semanas.
 */
async function regraEnvioFalhou(supabase: SupabaseClient, now: Date, ontem: Date): Promise<Regra> {
  const { data } = await supabase
    .from('messaging_messages')
    .select('id, conversation_id, created_at, error_message')
    .eq('status', 'failed')
    .gte('created_at', ontem.toISOString());

  const linhas = (data ?? []) as Array<{ conversation_id: string; created_at: string; error_message: string | null }>;
  if (linhas.length === 0) {
    return { id: 'envio-falhou', titulo: 'Mensagem que não chegou no cliente', emoji: '📵', novos: [], estoque: 0 };
  }

  const convIds = [...new Set(linhas.map((l) => l.conversation_id))];
  const { data: convsRaw } = await supabase
    .from('messaging_conversations').select('id, contact_id').in('id', convIds);
  const convs = new Map(((convsRaw ?? []) as Array<{ id: string; contact_id: string | null }>).map((c) => [c.id, c.contact_id]));
  const contatoIds = [...new Set([...convs.values()].filter(Boolean))] as string[];
  const { data: contatosRaw } = contatoIds.length
    ? await supabase.from('contacts').select('id, name').in('id', contatoIds)
    : { data: [] };
  const contatos = new Map(((contatosRaw ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name]));

  // Agrupa por conversa: 39 falhas para o mesmo número é UMA notícia, não 39.
  const porConversa = new Map<string, number>();
  for (const l of linhas) porConversa.set(l.conversation_id, (porConversa.get(l.conversation_id) ?? 0) + 1);

  const novos: ItemAlerta[] = [...porConversa.entries()].map(([convId, qtd]) => {
    const contatoId = convs.get(convId);
    return {
      donoId: null,
      donoNome: 'Técnico',
      contato: (contatoId ? contatos.get(contatoId) : null) ?? 'Sem nome',
      detalhe: `${qtd} ${qtd === 1 ? 'mensagem não chegou' : 'mensagens não chegaram'} nas últimas 24h`,
      idadeHoras: 0,
    };
  });

  return {
    id: 'envio-falhou',
    titulo: 'Mensagem que não chegou no cliente',
    emoji: '📵',
    acao: 'Conferir o número no contato (DDD certo?) e reenviar.',
    novos: novos.sort((a, b) => b.detalhe.localeCompare(a.detalhe)).slice(0, MAX_GUARDADOS),
    estoque: linhas.length,
  };
}

/**
 * 5. VENDA FECHADA SEM O PRÊMIO INFORMADO.
 *
 * Sem prêmio não existe faturamento nem comissão — é a pendência que trava o
 * fechamento do mês.
 */
async function regraVendaSemPremio(
  supabase: SupabaseClient, now: Date, perfis: Map<string, unknown>,
): Promise<Regra> {
  const { data } = await supabase
    .from('deals')
    .select('id, title, owner_id, custom_fields, is_lost')
    .not('custom_fields->venda', 'is', null)
    .is('deleted_at', null);

  const linhas = (data ?? []) as Array<{
    id: string; title: string | null; owner_id: string | null; is_lost: boolean;
    custom_fields: { venda?: { premio_mensal?: number | null; vendido_em?: string } } | null;
  }>;

  const semPremio = linhas.filter((d) => {
    if (d.is_lost) return false; // venda desfeita não é pendência
    const v = d.custom_fields?.venda;
    return v && (v.premio_mensal == null || v.premio_mensal === 0);
  });

  const novos: ItemAlerta[] = semPremio.map((d) => ({
    donoId: d.owner_id,
    donoNome: nomeDe(perfis.get(d.owner_id ?? '') as Parameters<typeof nomeDe>[0]),
    contato: d.title ?? 'Card sem nome',
    detalhe: 'venda fechada sem o prêmio informado',
    idadeHoras: d.custom_fields?.venda?.vendido_em
      ? horasEntre(now, new Date(d.custom_fields.venda.vendido_em))
      : 0,
    dealId: d.id,
  }));

  // Aqui NÃO cortamos por "novo": prêmio pendente é dinheiro parado, e a lista é
  // curta por natureza (a base inteira tem 2 vendas). Repetir é o certo.
  return {
    id: 'venda-sem-premio',
    titulo: 'Venda sem o prêmio informado',
    emoji: '💰',
    acao: 'Informar o prêmio mensal no card — sem ele a venda não entra no fechamento do mês.',
    novos: ordenar(novos),
    estoque: semPremio.length,
    estoquePorDono: contarPorDono(novos),
  };
}

/** Sinal de vida: o que a operação de fato produziu ontem. */
async function pulsoDeOntem(supabase: SupabaseClient, ontem: Date) {
  const desde = ontem.toISOString();
  const [msgs, notas, calls] = await Promise.all([
    supabase.from('messaging_messages').select('id', { count: 'exact', head: true })
      .eq('direction', 'inbound').gte('created_at', desde),
    supabase.from('activities').select('id', { count: 'exact', head: true })
      .eq('type', 'NOTE').is('deleted_at', null).gte('created_at', desde),
    supabase.from('activities').select('id', { count: 'exact', head: true })
      .eq('type', 'CALL').is('deleted_at', null).gte('created_at', desde),
  ]);
  return {
    mensagensDeLead: msgs.count ?? 0,
    notasEscritas: notas.count ?? 0,
    reunioesMarcadas: calls.count ?? 0,
  };
}

/**
 * Telefones e nomes da própria casa: o número do canal do WhatsApp e o time.
 * Conversa com a casa não é lead esperando resposta.
 */
async function internos(supabase: SupabaseClient): Promise<{ telefonesInternos: Set<string>; nomesInternos: Set<string> }> {
  const telefonesInternos = new Set<string>();
  const nomesInternos = new Set<string>();

  const { data: canais } = await supabase.from('messaging_channels').select('credentials, phone_number');
  for (const c of (canais ?? []) as Array<{ credentials: Record<string, unknown> | null; phone_number: string | null }>) {
    const tel = (c.phone_number ?? '').replace(/\D/g, '');
    if (tel) telefonesInternos.add(tel);
    const dono = (c.credentials as { owner?: string } | null)?.owner;
    if (dono) telefonesInternos.add(String(dono).replace(/\D/g, ''));
  }

  const { data: time } = await supabase.from('profiles').select('name, nickname, first_name, phone');
  for (const p of (time ?? []) as Array<{ name: string | null; nickname: string | null; first_name: string | null; phone: string | null }>) {
    for (const n of [p.name, p.nickname, p.first_name]) if (n) nomesInternos.add(n.trim().toLowerCase());
    const tel = (p.phone ?? '').replace(/\D/g, '');
    if (tel) telefonesInternos.add(tel);
  }

  return { telefonesInternos, nomesInternos };
}

async function nomesDosCards(supabase: SupabaseClient, dealIds: string[]): Promise<Map<string, string>> {
  if (dealIds.length === 0) return new Map();
  const { data } = await supabase.from('deals').select('id, title, contact_id').in('id', dealIds);
  const linhas = (data ?? []) as Array<{ id: string; title: string | null; contact_id: string | null }>;
  const contatoIds = [...new Set(linhas.map((l) => l.contact_id).filter(Boolean))] as string[];
  const { data: cs } = contatoIds.length
    ? await supabase.from('contacts').select('id, name').in('id', contatoIds)
    : { data: [] };
  const nomes = new Map(((cs ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name]));
  return new Map(
    linhas.map((l) => [l.id, (l.contact_id ? nomes.get(l.contact_id) : null) || l.title || 'Card sem nome']),
  );
}

/** Mais antigo primeiro (é o mais urgente) e corta no teto de leitura. */
function ordenar(itens: ItemAlerta[]): ItemAlerta[] {
  return [...itens].sort((a, b) => b.idadeHoras - a.idadeHoras).slice(0, MAX_GUARDADOS);
}

export const _internos = { TZ_OFFSET_HOURS, HORAS_SEM_RESPOSTA, DIAS_PARADO, MAX_POR_LISTA, MAX_GUARDADOS };
