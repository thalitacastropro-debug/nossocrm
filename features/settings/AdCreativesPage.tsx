/**
 * @fileoverview Configurações → Anúncios: de qual criativo o lead veio.
 *
 * O caso que originou a tela (26/08/2026): um lead disse ao Pedro que tinha
 * vindo "por causa do vídeo do anúncio" e o consultor não sabia qual vídeo era
 * nem o que ele prometia. O id do anúncio já chega no formulário e já fica
 * gravado no deal — falta a tradução de id para vídeo, e é isso que a Thalita
 * cadastra aqui.
 *
 * Por que manual: hoje o dado que chega não distingue criativo (um único id
 * repetido em 35 leads, `campanha` sempre vazia). A decisão foi não depender da
 * agência nem da Marketing API do Meta.
 *
 * Só `admin` vê e escreve — mesmo gating da tela de Equipe, e a RLS de
 * `ad_creatives` é quem barra de fato.
 */
import React, { useMemo, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, Megaphone, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  useAdCreatives,
  useDeleteAdCreative,
  useSaveAdCreative,
} from '@/lib/query/hooks/useAdCreativesQuery';
import type { AdCreative } from '@/lib/supabase/adCreatives';

const INPUT_CLASS =
  'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/40';

const LABEL_CLASS = 'block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1';

const ICON_BUTTON_CLASS =
  'px-2 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * A URL do criativo é opcional, mas se vier tem que ser http(s): é um link que
 * o consultor clica no card. Colar "drive.google.com/..." sem protocolo vira
 * caminho relativo e joga ele para dentro do próprio CRM.
 */
function urlValida(url: string): boolean {
  const valor = url.trim();
  if (!valor) return true;
  try {
    const parsed = new URL(valor);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

interface FormularioCriativo {
  adId: string;
  name: string;
  creativeUrl: string;
  promise: string;
}

const FORM_VAZIO: FormularioCriativo = { adId: '', name: '', creativeUrl: '', promise: '' };

/**
 * Componente React `AdCreativesPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const AdCreativesPage: React.FC = () => {
  const { profile } = useAuth();
  const { addToast } = useToast();

  const isAdmin = profile?.role === 'admin';

  const { data: criativos, isLoading, error } = useAdCreatives({ enabled: isAdmin });
  const salvarCriativo = useSaveAdCreative();
  const removerCriativo = useDeleteAdCreative();

  const [novo, setNovo] = useState<FormularioCriativo>(FORM_VAZIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<FormularioCriativo>(FORM_VAZIO);
  const [paraExcluir, setParaExcluir] = useState<AdCreative | null>(null);

  const lista = useMemo(() => {
    const itens = [...(criativos ?? [])];
    itens.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return itens;
  }, [criativos]);

  const salvando = salvarCriativo.isPending || removerCriativo.isPending;
  const podeCriar = novo.adId.trim().length > 0 && novo.name.trim().length > 0;

  /** Valida o que a RLS não valida: obrigatórios e formato da URL. */
  const validar = (form: FormularioCriativo): string | null => {
    if (!form.adId.trim()) return 'Informe o ID do anúncio.';
    if (!form.name.trim()) return 'Dê um nome ao criativo — é por ele que você vai reconhecer o vídeo.';
    if (!urlValida(form.creativeUrl)) return 'A URL do criativo precisa começar com http:// ou https://.';
    return null;
  };

  const salvar = async (form: FormularioCriativo, aoTerminar: () => void) => {
    const problema = validar(form);
    if (problema) {
      addToast(problema, 'error');
      return;
    }

    try {
      await salvarCriativo.mutateAsync({
        adId: form.adId,
        name: form.name,
        creativeUrl: form.creativeUrl,
        promise: form.promise,
      });
      addToast('Anúncio salvo', 'success');
      aoTerminar();
    } catch (e) {
      addToast(`Erro ao salvar: ${(e as Error).message}`, 'error');
    }
  };

  const iniciarEdicao = (criativo: AdCreative) => {
    setEditandoId(criativo.id);
    setEdicao({
      adId: criativo.adId,
      name: criativo.name,
      creativeUrl: criativo.creativeUrl ?? '',
      promise: criativo.promise ?? '',
    });
  };

  const cancelarEdicao = () => {
    setEditandoId(null);
    setEdicao(FORM_VAZIO);
  };

  const confirmarExclusao = async () => {
    if (!paraExcluir) return;
    try {
      await removerCriativo.mutateAsync(paraExcluir.id);
      addToast('Anúncio removido', 'success');
    } catch (e) {
      addToast(`Erro ao remover: ${(e as Error).message}`, 'error');
    } finally {
      setParaExcluir(null);
    }
  };

  // Mesmo gating da tela de Equipe: só admin. Fica depois dos hooks de propósito
  // (regras dos hooks) — a query nem dispara, porque `enabled` já é false.
  if (!isAdmin) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
            <KeyRound className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">Acesso Restrito</h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-sm">
            Apenas administradores podem cadastrar os anúncios.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
            <Megaphone className="h-5 w-5" /> Anúncios
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Cadastre aqui de qual criativo o lead veio. O consultor vê isso no card, na aba Origem.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {(error as Error).message}
          </div>
        )}

        {/* Cadastro */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-3">
            <label className={LABEL_CLASS} htmlFor="novo-ad-id">ID do anúncio</label>
            <input
              id="novo-ad-id"
              value={novo.adId}
              onChange={(e) => setNovo({ ...novo, adId: e.target.value })}
              placeholder="120245158337780451"
              className={INPUT_CLASS}
            />
          </div>
          <div className="lg:col-span-3">
            <label className={LABEL_CLASS} htmlFor="novo-nome">Nome</label>
            <input
              id="novo-nome"
              value={novo.name}
              onChange={(e) => setNovo({ ...novo, name: e.target.value })}
              placeholder="Ex.: Vídeo do reajuste de 2 anos"
              className={INPUT_CLASS}
            />
          </div>
          <div className="lg:col-span-3">
            <label className={LABEL_CLASS} htmlFor="nova-url">URL do criativo</label>
            <input
              id="nova-url"
              value={novo.creativeUrl}
              onChange={(e) => setNovo({ ...novo, creativeUrl: e.target.value })}
              placeholder="https://drive.google.com/..."
              className={INPUT_CLASS}
            />
          </div>
          <div className="lg:col-span-2">
            <label className={LABEL_CLASS} htmlFor="nova-promessa">Promessa</label>
            <input
              id="nova-promessa"
              value={novo.promise}
              onChange={(e) => setNovo({ ...novo, promise: e.target.value })}
              placeholder="O que o anúncio prometeu"
              className={INPUT_CLASS}
            />
          </div>
          <div className="lg:col-span-1">
            <button
              type="button"
              onClick={() => salvar(novo, () => setNovo(FORM_VAZIO))}
              disabled={salvando || !podeCriar}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Adicionar anúncio"
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="mt-6 border-t border-slate-200 dark:border-white/10 pt-4">
          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando anúncios...
            </div>
          ) : lista.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400 py-6">
              Nenhum anúncio cadastrado ainda. O ID você encontra no card do lead, na aba Origem.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-semibold">ID do anúncio</th>
                    <th className="py-2 pr-3 font-semibold">Nome</th>
                    <th className="py-2 pr-3 font-semibold">URL do criativo</th>
                    <th className="py-2 pr-3 font-semibold">Promessa</th>
                    <th className="py-2 pl-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((criativo) => {
                    const editando = editandoId === criativo.id;
                    return (
                      <tr
                        key={criativo.id}
                        className="border-t border-slate-200 dark:border-white/10 align-top"
                      >
                        <td className="py-3 pr-3 font-mono text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {criativo.adId}
                          {editando && (
                            // O upsert é por (organização, ID do anúncio) — trocar o ID
                            // aqui criaria um segundo cadastro e deixaria o antigo órfão.
                            <div className="mt-1 font-sans text-[11px] text-slate-400 dark:text-slate-500 whitespace-normal max-w-[16rem]">
                              Para corrigir o ID, exclua e cadastre de novo.
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          {editando ? (
                            <input
                              value={edicao.name}
                              onChange={(e) => setEdicao({ ...edicao, name: e.target.value })}
                              aria-label="Nome do criativo"
                              className={INPUT_CLASS}
                            />
                          ) : (
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {criativo.name}
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-3 max-w-[16rem]">
                          {editando ? (
                            <input
                              value={edicao.creativeUrl}
                              onChange={(e) => setEdicao({ ...edicao, creativeUrl: e.target.value })}
                              placeholder="https://..."
                              aria-label="URL do criativo"
                              className={INPUT_CLASS}
                            />
                          ) : criativo.creativeUrl ? (
                            <a
                              href={criativo.creativeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary-600 dark:text-primary-400 hover:underline break-all"
                            >
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              {criativo.creativeUrl}
                            </a>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-3 max-w-[18rem]">
                          {editando ? (
                            <input
                              value={edicao.promise}
                              onChange={(e) => setEdicao({ ...edicao, promise: e.target.value })}
                              aria-label="Promessa do anúncio"
                              className={INPUT_CLASS}
                            />
                          ) : (
                            <span className="text-slate-600 dark:text-slate-300">
                              {criativo.promise || '—'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 pl-3">
                          <div className="flex items-center justify-end gap-2">
                            {editando ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => salvar(edicao, cancelarEdicao)}
                                  className={ICON_BUTTON_CLASS}
                                  title="Salvar"
                                  aria-label="Salvar alterações"
                                  disabled={salvando}
                                >
                                  <Save className="h-4 w-4 text-primary-600" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelarEdicao}
                                  className={ICON_BUTTON_CLASS}
                                  title="Cancelar"
                                  aria-label="Cancelar edição"
                                  disabled={salvando}
                                >
                                  <X className="h-4 w-4 text-slate-500" />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => iniciarEdicao(criativo)}
                                className={ICON_BUTTON_CLASS}
                                title="Editar"
                                aria-label="Editar anúncio"
                                disabled={salvando}
                              >
                                <Pencil className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setParaExcluir(criativo)}
                              className={ICON_BUTTON_CLASS}
                              title="Excluir"
                              aria-label="Excluir anúncio"
                              disabled={salvando}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={paraExcluir !== null}
        onClose={() => setParaExcluir(null)}
        onConfirm={confirmarExclusao}
        title="Excluir anúncio"
        message={
          <>
            Remover o cadastro de <strong>{paraExcluir?.name}</strong>? Os leads que vieram dele
            continuam no funil — o consultor é que deixa de ver qual vídeo foi.
          </>
        }
        confirmText="Excluir"
      />
    </div>
  );
};

export default AdCreativesPage;
