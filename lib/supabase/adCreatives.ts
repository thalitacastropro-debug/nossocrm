/**
 * @fileoverview Serviço Supabase para o cadastro de criativos de anúncio (`ad_creatives`).
 *
 * De qual vídeo o lead veio. O caso real (26/08/2026): um lead disse ao Pedro
 * que tinha vindo "por causa do vídeo do anúncio" e o Pedro não sabia qual
 * vídeo era nem o que ele prometia. O id do anúncio já chega no formulário e já
 * fica gravado em `deals.custom_fields.lead_form.fields.anuncio` — mas um id
 * não diz nada no meio da ligação.
 *
 * O cadastro é MANUAL de propósito: no banco inteiro existe um único id
 * ('120245158337780451') repetido em 35 leads, com `campanha` sempre vazia — o
 * dado que chega não distingue criativo. A decisão da Thalita foi não depender
 * da agência nem da Marketing API do Meta: ela mesma liga id -> nome + URL do
 * vídeo + promessa, e o consultor lê isso no card.
 *
 * Quem aplica a regra de acesso é a RLS (migração
 * `20260826120000_ad_creatives.sql`): qualquer membro da organização LÊ (o
 * consultor precisa da promessa), só `admin` escreve. Este serviço só lê e
 * escreve para a tela de Configurações → Anúncios.
 *
 * @module lib/supabase/adCreatives
 */

import { supabase } from './client';
import { sanitizeText, sanitizeUUID } from './utils';

/** Um criativo cadastrado: o id que chega do Meta traduzido para gente. */
export interface AdCreative {
  id: string;
  organizationId: string;
  /** Id do anúncio como chega do Meta. Texto — os ids 120... estouram o inteiro seguro do JS. */
  adId: string;
  name: string;
  /** Link do vídeo (Drive/YouTube). É o que o consultor abre antes de ligar. */
  creativeUrl: string | null;
  /** O que o anúncio prometeu. Era isso que faltava ao Pedro na ligação. */
  promise: string | null;
  platform: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload de cadastro/edição vindo da tela. */
export interface AdCreativeInput {
  adId: string;
  name: string;
  creativeUrl?: string | null;
  promise?: string | null;
  platform?: string | null;
  notes?: string | null;
}

interface DbAdCreative {
  id: string;
  organization_id: string;
  ad_id: string;
  name: string;
  creative_url: string | null;
  promise: string | null;
  platform: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLUNAS =
  'id, organization_id, ad_id, name, creative_url, promise, platform, notes, created_at, updated_at';

function transformAdCreative(db: DbAdCreative): AdCreative {
  return {
    id: db.id,
    organizationId: db.organization_id,
    adId: db.ad_id,
    name: db.name,
    creativeUrl: db.creative_url,
    promise: db.promise,
    platform: db.platform,
    notes: db.notes,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

// =============================================================================
// Organização de quem está logado (client-side, RLS-safe) — mesmo padrão de
// lib/supabase/products.ts. A leitura já é filtrada pela RLS; isto aqui serve
// para o INSERT, que precisa gravar organization_id explicitamente.
// =============================================================================
let cachedOrgId: string | null = null;
let cachedOrgUserId: string | null = null;

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (cachedOrgUserId === user.id && cachedOrgId) return cachedOrgId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return null;

  const orgId = sanitizeUUID((profile as { organization_id: string | null } | null)?.organization_id);
  cachedOrgUserId = user.id;
  cachedOrgId = orgId;
  return orgId;
}

export const adCreativesService = {
  /**
   * Todos os criativos cadastrados da organização, mais recente primeiro.
   *
   * Não filtra por `organization_id` no código: a policy `ad_creatives_select`
   * já compara com `minha_org()`. Repetir o filtro aqui só mascararia um furo
   * de RLS se algum dia ela for afrouxada.
   */
  async getAll(): Promise<{ data: AdCreative[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      const { data, error } = await supabase
        .from('ad_creatives')
        .select(COLUNAS)
        .order('created_at', { ascending: false });

      if (error) return { data: [], error };

      const rows = (data ?? []) as DbAdCreative[];
      return { data: rows.map(transformAdCreative), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  /**
   * Cadastra ou atualiza o criativo de um `ad_id`.
   *
   * Upsert em cima do índice `ad_creatives_org_ad_id_key` (organization_id,
   * ad_id): cadastrar o mesmo id de novo corrige o cadastro em vez de duplicar
   * a linha — que é o que a dona faz na prática quando percebe que digitou o
   * nome errado do vídeo.
   *
   * @param input Dados da tela. `adId` e `name` são obrigatórios.
   */
  async upsert(input: AdCreativeInput): Promise<{ data: AdCreative | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const adId = input.adId.trim();
      const name = input.name.trim();
      if (!adId) return { data: null, error: new Error('Informe o ID do anúncio.') };
      if (!name) return { data: null, error: new Error('Informe o nome do criativo.') };

      const organizationId = await getCurrentOrganizationId();
      if (!organizationId) {
        return { data: null, error: new Error('Não foi possível identificar a organização do usuário.') };
      }

      const payload: Record<string, string | null> = {
        organization_id: organizationId,
        ad_id: adId,
        name,
        creative_url: sanitizeText(input.creativeUrl),
        promise: sanitizeText(input.promise),
        // A tabela não tem trigger de updated_at — quem carimba é aqui,
        // senão o campo congela na data da criação e a dona perde a
        // referência de quando revisou o criativo pela última vez.
        updated_at: new Date().toISOString(),
      };

      // `platform` e `notes` não têm campo na tela de Configurações (ela pediu
      // só as 4 colunas). Mandar os dois como null a cada save apagaria em
      // silêncio o que estivesse gravado — e a aba Origem do card MOSTRA as
      // `notes`. Coluna que não vai no corpo, o upsert não sobrescreve: por
      // isso só entram quando quem chamou realmente informou algo.
      if (input.platform !== undefined) payload.platform = sanitizeText(input.platform);
      if (input.notes !== undefined) payload.notes = sanitizeText(input.notes);

      const { data, error } = await supabase
        .from('ad_creatives')
        .upsert(payload, { onConflict: 'organization_id,ad_id' })
        .select(COLUNAS)
        .single();

      if (error) return { data: null, error };
      return { data: transformAdCreative(data as DbAdCreative), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Remove um cadastro. Não mexe nos deals — o `ad_id` continua no lead_form. */
  async remove(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const { error } = await supabase
        .from('ad_creatives')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
