'use client';

/**
 * @fileoverview Aba "Origem" do card — de onde o lead veio e quem o trouxe.
 *
 * Em 26/08/2026 um lead disse ao Pedro que tinha vindo "por causa do vídeo do
 * anúncio", e o Pedro não sabia qual vídeo era nem o que ele prometia. O id do
 * anúncio JÁ chegava e JÁ era gravado em `custom_fields.lead_form.fields.anuncio`
 * — só que id de anúncio não ajuda ninguém numa ligação. Aqui esse id vira nome,
 * promessa e link do criativo, lendo o cadastro que a própria Thalita mantém na
 * tabela `ad_creatives` (decisão dela: não depender da agência nem da Marketing
 * API do Meta).
 *
 * O painel também guarda a ORIGEM COMERCIAL (tráfego pago x carteira própria),
 * que não vem de dado nenhum — é a pessoa que marca no card.
 *
 * @module features/deals/components/OrigemDoLeadPanel
 */

import React, { useEffect, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ExternalLink,
  Film,
  Handshake,
  Loader2,
  Megaphone,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
// queryKeys pelo caminho DIRETO, e não por '@/lib/query': aquele barrel reexporta
// '@/lib/query/hooks', que os testes do DealDetailModal mockam com factory.
import { queryKeys } from '@/lib/query/queryKeys';
// Caminho DIRETO, não pelo barrel '@/lib/query/hooks': os testes do
// DealDetailModal (que renderiza este painel) mockam o barrel com factory, e
// todo hook novo pedido por lá derruba a suíte com "No export is defined on the mock".
import { useOrgMembersQuery } from '@/lib/query/hooks/useOrgMembersQuery';

/** Como o lead entrou na casa, do ponto de vista COMERCIAL (não do canal). */
export type OrigemComercialTipo = 'trafego' | 'carteira_propria';

export interface OrigemComercial {
  tipo: OrigemComercialTipo;
  /** Id do membro do time que trouxe o cliente. Só existe na carteira própria. */
  quem_trouxe: string | null;
  /** Quando alguém marcou (ISO). Serve pra auditar a marcação depois. */
  definido_em: string;
}

/** Cadastro do criativo — a Thalita preenche em Configurações > Anúncios. */
interface AdCreative {
  id: string;
  ad_id: string;
  name: string;
  creative_url: string | null;
  promise: string | null;
  platform: string | null;
  notes: string | null;
}

/** Snapshot do formulário gravado pela rota de intake (`/api/public/v1/leads`). */
interface LeadForm {
  source?: unknown;
  received_at?: unknown;
  form_id?: unknown;
  fields?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

interface OrigemDoLeadPanelProps {
  dealId: string;
  customFields?: Record<string, unknown> | null;
  /**
   * Grava a origem comercial. Quem chama repassa o MESMO caminho que o
   * DealDetailModal já usa pra campo customizado (useUpdateDeal →
   * `deals.custom_fields`) — este painel não abre rota nem escreve direto.
   */
  onSalvarOrigemComercial: (valor: OrigemComercial) => Promise<unknown> | void;
}

const ROTULO_ORIGEM: Record<string, string> = {
  meta_lead_ads: 'Meta Lead Ads (anúncio)',
  whatsapp: 'WhatsApp',
  manual: 'Cadastro manual',
};

// Performance: reaproveita a instância do formatador entre renders.
const PT_BR_DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/** Normaliza qualquer valor do JSON para texto exibível (ou null se vazio). */
function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'object') return null; // objeto/array não vira linha de leitura
  const s = String(valor).trim();
  return s === '' ? null : s;
}

function formatarDataHora(valor: unknown): string | null {
  const bruto = texto(valor);
  if (!bruto) return null;
  const data = new Date(bruto);
  // Data ilegível volta como veio: mostrar o texto cru é melhor que "Invalid Date".
  if (Number.isNaN(data.getTime())) return bruto;
  return PT_BR_DATA_HORA.format(data);
}

/**
 * Id do anúncio. Fica em `fields.anuncio`; `raw.anuncio` é a rede de segurança
 * pra payload de conector que não passou pelo mapeamento de campos.
 */
function idDoAnuncio(leadForm: LeadForm | null): string | null {
  return texto(leadForm?.fields?.anuncio) ?? texto(leadForm?.raw?.anuncio);
}

function idDoFormulario(leadForm: LeadForm | null): string | null {
  return (
    texto(leadForm?.form_id) ?? texto(leadForm?.fields?.form_id) ?? texto(leadForm?.raw?.form_id)
  );
}

/**
 * Lê a origem comercial já gravada, tolerando lixo no JSON (o campo é escrito
 * por esta tela, mas `custom_fields` é jsonb livre e recebe escrita de vários lugares).
 */
function lerOrigemComercial(customFields?: Record<string, unknown> | null): OrigemComercial | null {
  const bruto = customFields?.origem_comercial;
  if (!bruto || typeof bruto !== 'object') return null;
  const registro = bruto as Record<string, unknown>;
  const tipo = registro.tipo;
  if (tipo !== 'trafego' && tipo !== 'carteira_propria') return null;
  const quem = registro.quem_trouxe;
  return {
    tipo,
    quem_trouxe: typeof quem === 'string' && quem.trim() !== '' ? quem : null,
    definido_em: typeof registro.definido_em === 'string' ? registro.definido_em : '',
  };
}

/**
 * Só vira link o que é http(s). O `creative_url` é digitado à mão no cadastro,
 * e um `javascript:` colado ali viraria clique executável dentro do CRM.
 */
function linkSeguro(url: string | null | undefined): string | null {
  const bruto = texto(url);
  if (!bruto) return null;
  return /^https?:\/\//i.test(bruto) ? bruto : null;
}

const SELECT_CLASSES =
  'text-xs rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 ' +
  'px-2 py-1.5 text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-primary-500 ' +
  'cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const CARTAO_CLASSES =
  'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 shadow-sm';

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-xs">
      <dt className="text-slate-500 dark:text-slate-400 shrink-0 max-w-[45%] break-words">{rotulo}</dt>
      <dd
        className={`text-slate-900 dark:text-white font-medium break-words ${mono ? 'font-mono' : ''}`}
      >
        {valor}
      </dd>
    </div>
  );
}

/**
 * Componente React `OrigemDoLeadPanel`.
 *
 * @param {OrigemDoLeadPanelProps} props - Card, custom_fields e o gravador de origem comercial.
 * @returns {Element} Painel da aba "Origem".
 */
export function OrigemDoLeadPanel({
  dealId,
  customFields,
  onSalvarOrigemComercial,
}: OrigemDoLeadPanelProps) {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  // Só admin cadastra anúncio (a RLS de `ad_creatives` exige `e_admin()`), então
  // só pra ele faz sentido dizer ONDE cadastrar. Vendedor lê o id e segue.
  const ehAdmin = profile?.role === 'admin';
  const { data: time = [], isLoading: carregandoTime } = useOrgMembersQuery();
  const idSelectTipo = useId();
  const idSelectQuem = useId();

  const leadForm = useMemo<LeadForm | null>(() => {
    const bruto = customFields?.lead_form;
    return bruto && typeof bruto === 'object' ? (bruto as LeadForm) : null;
  }, [customFields]);

  const adId = idDoAnuncio(leadForm);
  const formId = idDoFormulario(leadForm);
  const origemRotulo = (() => {
    const s = texto(leadForm?.source);
    if (!s) return null;
    return ROTULO_ORIGEM[s] ?? s;
  })();
  const recebidoEm = formatarDataHora(leadForm?.received_at);
  const conjunto = texto(leadForm?.fields?.conjunto) ?? texto(leadForm?.raw?.conjunto);

  const {
    data: criativo,
    isLoading: carregandoCriativo,
    isError: erroCriativo,
  } = useQuery<AdCreative | null>({
    // Pendurada na MESMA árvore que a tela Configurações > Anúncios invalida ao
    // cadastrar (queryKeys.adCreatives.all === ['adCreatives']): cadastrar o criativo
    // lá derruba o cache deste card na hora, em vez de o consultor esperar o
    // staleTime vencer. Abaixo dela vêm ORG + id do anúncio — dois cards do mesmo
    // anúncio dividem a mesma consulta.
    queryKey: [...queryKeys.adCreatives.all, 'byAdId', orgId ?? '', adId ?? ''],
    queryFn: async (): Promise<AdCreative | null> => {
      const { data, error } = await supabase
        .from('ad_creatives')
        .select('id, ad_id, name, creative_url, promise, platform, notes')
        .eq('organization_id', orgId!)
        .eq('ad_id', adId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as AdCreative | null;
    },
    enabled: !!orgId && !!adId,
    staleTime: 5 * 60 * 1000, // 5 minutos — cadastro de anúncio muda raramente
    gcTime: 30 * 60 * 1000,
  });

  const gravado = lerOrigemComercial(customFields);
  /** Escolha já enviada que o card ainda não devolveu na prop. */
  const [pendente, setPendente] = useState<OrigemComercial | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  // Trocar de card (ou outra pessoa marcar) faz a escolha local sair de cena e
  // voltar a valer o que está no banco.
  useEffect(() => {
    setPendente(null);
  }, [dealId, gravado?.tipo, gravado?.quem_trouxe]);

  // O aviso de erro NÃO pode sair junto com a escolha local: quando a gravação
  // falha, o useUpdateDeal desfaz o palpite otimista e `gravado` volta ao valor
  // antigo no mesmo instante — zerar o erro naquele efeito apagaria a mensagem
  // antes de a pessoa ler e o clique pareceria ter funcionado. Só trocar de card limpa.
  useEffect(() => {
    setErroSalvar(null);
  }, [dealId]);

  const atual = pendente ?? gravado;

  const salvar = async (tipo: OrigemComercialTipo, quemTrouxe: string | null) => {
    const valor: OrigemComercial = {
      tipo,
      // Tráfego pago não tem "quem trouxe" — o lead é da casa. Zerar aqui evita
      // deixar um nome pendurado quando alguém corrige a marcação.
      quem_trouxe: tipo === 'carteira_propria' ? quemTrouxe : null,
      definido_em: new Date().toISOString(),
    };
    setPendente(valor);
    setSalvando(true);
    setErroSalvar(null);
    try {
      await onSalvarOrigemComercial(valor);
    } catch {
      setPendente(null);
      setErroSalvar('Não foi possível salvar a origem comercial. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const linkCriativo = linkSeguro(criativo?.creative_url);
  const marcadoEm = atual?.definido_em ? formatarDataHora(atual.definido_em) : null;
  const quemTrouxe = atual?.quem_trouxe ?? null;
  /** Id já gravado em "quem trouxe" que não está na lista do time (cache frio ou pessoa que saiu). */
  const quemTrouxeForaDaLista =
    quemTrouxe && !time.some((membro) => membro.id === quemTrouxe) ? quemTrouxe : null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* (a) DE ONDE VEIO */}
      {leadForm ? (
        <div className={CARTAO_CLASSES}>
          <div className="flex items-center gap-2 mb-3">
            <Megaphone className="w-4 h-4 text-indigo-500" aria-hidden="true" />
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              De onde veio
            </h4>
          </div>
          <dl className="space-y-1.5">
            {origemRotulo && <Linha rotulo="Origem" valor={origemRotulo} />}
            {recebidoEm && <Linha rotulo="Recebido em" valor={recebidoEm} />}
            {formId && <Linha rotulo="Formulário" valor={formId} mono />}
            {adId && <Linha rotulo="ID do anúncio" valor={adId} mono />}
            {conjunto && conjunto !== adId && <Linha rotulo="Conjunto" valor={conjunto} mono />}
          </dl>
          {!origemRotulo && !recebidoEm && !formId && !adId && (
            <p className="text-xs text-slate-500 italic">
              O formulário chegou sem dados de atribuição.
            </p>
          )}
        </div>
      ) : (
        <div className={CARTAO_CLASSES}>
          <div className="flex items-center gap-2 mb-2">
            <Megaphone className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              De onde veio
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Este lead não veio de formulário de anúncio — o card foi criado por outro caminho
            (cadastro manual, WhatsApp ou indicação).
          </p>
        </div>
      )}

      {/* (b) O CRIATIVO — o que o anúncio prometeu pra este lead */}
      {adId && (
        <div className={CARTAO_CLASSES}>
          <div className="flex items-center gap-2 mb-3">
            <Film className="w-4 h-4 text-primary-500" aria-hidden="true" />
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              O criativo
            </h4>
          </div>

          {carregandoCriativo ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Procurando o anúncio cadastrado...
            </p>
          ) : erroCriativo ? (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
              {/* Texto num filho só: solto no flex, cada trecho virava um item e o id
                  ficava espremido numa coluna própria em vez de quebrar linha. */}
              <span>
                Não deu pra consultar o cadastro de anúncios agora. O ID do anúncio é{' '}
                <span className="font-mono break-words">{adId}</span>.
              </span>
            </p>
          ) : criativo ? (
            <div className="space-y-2">
              <p className="text-base font-bold text-slate-900 dark:text-white font-display leading-snug">
                {criativo.name}
              </p>
              {texto(criativo.promise) && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                    O anúncio prometeu
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-200 break-words">
                    {criativo.promise}
                  </p>
                </div>
              )}
              {texto(criativo.notes) && (
                <p className="text-xs text-slate-500 dark:text-slate-400 break-words">
                  {criativo.notes}
                </p>
              )}
              {linkCriativo && (
                <a
                  href={linkCriativo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-500/10 hover:bg-primary-100 dark:hover:bg-primary-500/20 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  Abrir o criativo
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-900 dark:text-white font-mono break-words">{adId}</p>
              {ehAdmin && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Anúncio ainda não cadastrado — cadastre em Configurações &gt; Anúncios.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* As RESPOSTAS do formulário NÃO aparecem aqui de propósito (pedido da Thalita,
          26/08): elas já estão na aba IA Insights (QualificacaoSDRPanel) — repetir o
          mesmo bloco em duas abas só confundia. Esta aba é ATRIBUIÇÃO: de onde o lead
          veio, não o que ele respondeu. */}

      {/* (c) ORIGEM COMERCIAL — tráfego pago x carteira própria.
          POR QUE existe: cliente de carteira própria não entra na conta do tráfego
          pago (senão o custo por lead do anúncio sai mentiroso) e a comissão é
          diferente — 140% para quem TRAZ o cliente, 100% para venda de lead da casa. */}
      <div className={CARTAO_CLASSES}>
        <div className="flex items-center gap-2 mb-2">
          <Handshake className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Origem comercial
          </h4>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
          Todo lead que cai no CRM nasce como <strong>tráfego pago</strong> — é o caminho normal.
          Só troque para <strong>carteira própria</strong> quando alguém do time trouxe o cliente
          (esses entram à mão): a marcação separa o que conta no anúncio do que é carteira.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor={idSelectTipo}
            className="text-xs font-medium text-slate-500 dark:text-slate-400"
          >
            Como chegou
          </label>
          <select
            id={idSelectTipo}
            /* SEM marcação gravada, o card É tráfego pago (pedido da Thalita, 26/08:
               "todo lead que cai no CRM vem do tráfego") — o select já nasce em
               Tráfego e ninguém precisa clicar para confirmar o caso normal. A escolha
               só é GRAVADA quando alguém troca para Carteira própria (ou de volta):
               card sem marcação continua sem marcação, e o selo "Carteira" do kanban
               segue aparecendo só no caso raro. */
            value={atual?.tipo ?? 'trafego'}
            disabled={salvando}
            onChange={(e) => {
              const escolhido = e.target.value;
              if (escolhido !== 'trafego' && escolhido !== 'carteira_propria') return;
              if (escolhido === atual?.tipo) return;
              // Card sem marcação já se apresenta como tráfego: "trocar" para tráfego
              // não grava nada (evita encher o banco de marcação que é só o padrão).
              if (!atual && escolhido === 'trafego') return;
              void salvar(escolhido, atual?.quem_trouxe ?? null);
            }}
            className={SELECT_CLASSES}
          >
            <option value="trafego">Tráfego pago</option>
            <option value="carteira_propria">Carteira própria</option>
          </select>

          {atual?.tipo === 'carteira_propria' && (
            <>
              <label
                htmlFor={idSelectQuem}
                className="text-xs font-medium text-slate-500 dark:text-slate-400"
              >
                Quem trouxe
              </label>
              <select
                id={idSelectQuem}
                value={atual.quem_trouxe ?? ''}
                disabled={salvando}
                onChange={(e) => void salvar('carteira_propria', e.target.value || null)}
                className={SELECT_CLASSES}
              >
                <option value="">Ainda não sei</option>
                {/* Sem esta opção o select cairia em "Ainda não sei" toda vez que o id
                    gravado não estivesse na lista — com o cache do time frio (card aberto
                    pelo Inbox) o painel diria que ninguém trouxe o cliente, e o próximo
                    clique apagaria a marcação de quem realmente trouxe. */}
                {quemTrouxeForaDaLista && (
                  <option value={quemTrouxeForaDaLista}>
                    {carregandoTime ? 'Carregando...' : 'Fora do time'}
                  </option>
                )}
                {/* Time inteiro, sem filtrar papel: aqui é ATRIBUIÇÃO de quem trouxe
                    o cliente (comissão), não posse do card. */}
                {time.map((membro) => (
                  <option key={membro.id} value={membro.id}>
                    {membro.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {salvando && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Salvando...
            </span>
          )}
        </div>

        {erroSalvar && (
          <p role="alert" className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
            {erroSalvar}
          </p>
        )}

        {marcadoEm && (
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            Marcado em {marcadoEm}.
          </p>
        )}
      </div>
    </div>
  );
}
