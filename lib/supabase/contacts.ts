/**
 * @fileoverview Serviço Supabase para gerenciamento de contatos e empresas CRM.
 * 
 * Este módulo fornece operações CRUD para contatos e empresas (crm_companies),
 * com transformação automática entre o formato do banco e o formato da aplicação.
 * 
 * ## Conceitos Multi-Tenant
 * 
 * - Contatos são isolados por `organization_id` (tenant)
 * - `client_company_id` vincula o contato a uma empresa cadastrada no CRM
 * 
 * @module lib/supabase/contacts
 */

import { supabase } from './client';
import { Contact, CRMCompany, OrganizationId, PaginationState, PaginatedResponse, ContactsServerFilters } from '@/types';
import { sanitizeUUID, sanitizeText, sanitizeNumber } from './utils';
import { normalizePhoneE164 } from '@/lib/phone';

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  return (profile as any)?.organization_id ?? null;
}

/**
 * Quem está criando. Vira o `owner_id` do contato novo — e sem ele a criação FALHA inteira para
 * quem não é admin (ver o comentário de `create`).
 */
async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ============================================
// CONTACTS SERVICE
// ============================================

/**
 * Representação de contato no banco de dados.
 * 
 * @interface DbContact
 */
export interface DbContact {
  /** ID único do contato (UUID). */
  id: string;
  /** ID da organização/tenant (para RLS). */
  organization_id: string;
  /** Nome completo do contato. */
  name: string;
  /** Email do contato. */
  email: string | null;
  /** Telefone do contato. */
  phone: string | null;
  /** Cargo/função do contato. */
  role: string | null;
  /** Nome da empresa (texto livre, deprecado). */
  company_name: string | null;
  /** ID da empresa CRM vinculada. */
  client_company_id: string | null;
  /** URL do avatar. */
  avatar: string | null;
  /** Observações sobre o contato. */
  notes: string | null;
  /** Status do contato (ACTIVE, INACTIVE). */
  status: string;
  /** Estágio no funil (LEAD, MQL, etc). */
  stage: string;
  /** Fonte de origem do contato. */
  source: string | null;
  /** Data de aniversário. */
  birth_date: string | null;
  /** Data da última interação. */
  last_interaction: string | null;
  /** Data da última compra. */
  last_purchase_date: string | null;
  /** Valor total de compras. */
  total_value: number;
  /** Data de criação. */
  created_at: string;
  /** Data de atualização. */
  updated_at: string;
  /** ID do dono/responsável. */
  owner_id: string | null;
  /** Quando true, o agente de IA não responde a este contato. */
  ai_paused: boolean;
}

/**
 * Representação de empresa CRM no banco de dados.
 * 
 * @interface DbCRMCompany
 */
export interface DbCRMCompany {
  /** ID único da empresa (UUID). */
  id: string;
  /** ID da organização/tenant. */
  organization_id: string;
  /** Nome da empresa. */
  name: string;
  /** Setor/indústria. */
  industry: string | null;
  /** Website da empresa. */
  website: string | null;
  /** Data de criação. */
  created_at: string;
  /** Data de atualização. */
  updated_at: string;
  /** ID do dono/responsável. */
  owner_id: string | null;
}

/**
 * Transforma contato do formato DB para o formato da aplicação.
 * 
 * @param db - Contato no formato do banco.
 * @returns Contato no formato da aplicação.
 */
const transformContact = (db: DbContact): Contact => ({
  id: db.id,
  organizationId: db.organization_id,
  name: db.name,
  email: db.email || '',
  phone: normalizePhoneE164(db.phone),
  role: db.role || '',
  clientCompanyId: db.client_company_id || undefined,
  companyId: db.client_company_id || '', // @deprecated - backwards compatibility
  avatar: db.avatar || '',
  notes: db.notes || '',
  status: db.status as Contact['status'],
  stage: db.stage,
  source: db.source as Contact['source'] || undefined,
  birthDate: db.birth_date || undefined,
  lastInteraction: db.last_interaction || undefined,
  lastPurchaseDate: db.last_purchase_date || undefined,
  totalValue: db.total_value || 0,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
  aiPaused: db.ai_paused ?? false,
});

/**
 * Transforma empresa CRM do formato DB para o formato da aplicação.
 * 
 * @param db - Empresa no formato do banco.
 * @returns Empresa no formato da aplicação.
 */
const transformCRMCompany = (db: DbCRMCompany): CRMCompany => ({
  id: db.id,
  organizationId: db.organization_id,
  name: db.name,
  industry: db.industry || undefined,
  website: db.website || undefined,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
});

/**
 * Transforma contato do formato da aplicação para o formato DB.
 * 
 * @param contact - Contato parcial no formato da aplicação.
 * @returns Contato parcial no formato do banco.
 */
const transformContactToDb = (contact: Partial<Contact>): Partial<DbContact> => {
  const db: Partial<DbContact> = {};

  if (contact.name !== undefined) db.name = contact.name;
  if (contact.email !== undefined) db.email = contact.email || null;
  if (contact.phone !== undefined) {
    const e164 = normalizePhoneE164(contact.phone);
    db.phone = e164 ? e164 : null;
  }
  if (contact.role !== undefined) db.role = contact.role || null;
  // Support both new clientCompanyId and deprecated companyId
  if (contact.clientCompanyId !== undefined) db.client_company_id = contact.clientCompanyId || null;
  else if (contact.companyId !== undefined) db.client_company_id = contact.companyId || null;
  if (contact.avatar !== undefined) db.avatar = contact.avatar || null;
  if (contact.notes !== undefined) db.notes = contact.notes || null;
  if (contact.status !== undefined) db.status = contact.status;
  if (contact.stage !== undefined) db.stage = contact.stage;
  if (contact.source !== undefined) db.source = contact.source || null;
  if (contact.birthDate !== undefined) db.birth_date = contact.birthDate || null;
  if (contact.lastInteraction !== undefined) db.last_interaction = contact.lastInteraction || null;
  if (contact.lastPurchaseDate !== undefined) db.last_purchase_date = contact.lastPurchaseDate || null;
  if (contact.totalValue !== undefined) db.total_value = contact.totalValue;
  if (contact.aiPaused !== undefined) db.ai_paused = contact.aiPaused;

  return db;
};

/**
 * Serviço de contatos do Supabase.
 * 
 * Fornece operações CRUD para a tabela `contacts`.
 * Todos os dados são filtrados por RLS baseado no `organization_id`.
 * 
 * @example
 * ```typescript
 * // Buscar todos os contatos
 * const { data, error } = await contactsService.getAll();
 * 
 * // Criar um novo contato
 * const { data, error } = await contactsService.create(
 *   { name: 'João', email: 'joao@email.com', status: 'ACTIVE', stage: 'LEAD' },
 *   organizationId
 * );
 * ```
 */
export const contactsService = {
  /**
   * Busca contagens de contatos por estágio do funil.
   * Usa RPC para query eficiente no servidor.
   * 
   * @returns Promise com objeto de contagens por estágio.
   * 
   * @example
   * ```typescript
   * const { data } = await contactsService.getStageCounts();
   * // data = { LEAD: 1500, MQL: 2041, PROSPECT: 800, ... }
   * ```
   */
  async getStageCounts(): Promise<{ data: Record<string, number> | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const { data, error } = await supabase.rpc('get_contact_stage_counts');

      if (error) return { data: null, error };

      // Transform array to object
      const counts: Record<string, number> = {};
      if (data) {
        for (const row of data as Array<{ stage: string; count: number }>) {
          counts[row.stage] = row.count;
        }
      }

      return { data: counts, error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Busca contatos por uma lista de IDs.
   * Otimizado para buscar apenas os contatos necessários.
   *
   * @param ids - Array de IDs de contatos a buscar.
   * @param options - Opções adicionais, incluindo AbortSignal para cancelar a request.
   * @returns Promise com array de contatos ou erro.
   */
  async getByIds(ids: string[], options?: { signal?: AbortSignal }): Promise<{ data: Contact[] | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      // Se não há IDs, retorna array vazio (evita query inválida)
      if (!ids || ids.length === 0) {
        return { data: [], error: null };
      }
      // Remove duplicatas e valores vazios
      const uniqueIds = [...new Set(ids.filter(Boolean))];
      if (uniqueIds.length === 0) {
        return { data: [], error: null };
      }

      let contactsQuery = supabase
        .from('contacts')
        .select('*')
        .is('deleted_at', null);
      if (options?.signal) contactsQuery = contactsQuery.abortSignal(options.signal);
      const { data, error } = await contactsQuery.in('id', uniqueIds);

      if (error) return { data: null, error };
      return { data: (data || []).map(c => transformContact(c as DbContact)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Busca todos os contatos da organização.
   *
   * @returns Promise com array de contatos ou erro.
   */
  async getAll(): Promise<{ data: Contact[] | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      // Safety limit: cap at 1000 for non-paginated access.
      // For full datasets, use getAllPaginated() with cursor pagination.
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) return { data: null, error };
      return { data: (data || []).map(c => transformContact(c as DbContact)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Busca contatos com paginação e filtros server-side.
   * 
   * @param pagination - Estado de paginação { pageIndex, pageSize }.
   * @param filters - Filtros opcionais (search, stage, status, dateRange).
   * @returns Promise com resposta paginada ou erro.
   * 
   * @example
   * ```typescript
   * const { data, error } = await contactsService.getAllPaginated(
   *   { pageIndex: 0, pageSize: 50 },
   *   { search: 'João', stage: 'LEAD' }
   * );
   * // data.data = Contact[]
   * // data.totalCount = 10000
   * // data.hasMore = true
   * ```
   */
  async getAllPaginated(
    pagination: PaginationState,
    filters?: ContactsServerFilters,
    options?: { signal?: AbortSignal }
  ): Promise<{ data: PaginatedResponse<Contact> | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const { pageIndex, pageSize } = pagination;
      const from = pageIndex * pageSize;
      const to = from + pageSize - 1;

      // Build query with count (exclude soft-deleted/merged contacts)
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .is('deleted_at', null);
      if (options?.signal) query = query.abortSignal(options.signal);

      // Apply filters
      if (filters) {
        // T007: Search filter (name OR email)
        if (filters.search && filters.search.trim()) {
          const searchTerm = filters.search.trim();
          query = query.or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
        }

        // T008: Stage filter
        if (filters.stage && filters.stage !== 'ALL') {
          query = query.eq('stage', filters.stage);
        }

        // T009 & T010: Status filter (including RISK logic)
        if (filters.status && filters.status !== 'ALL') {
          if (filters.status === 'RISK') {
            // T010: RISK = ACTIVE + lastPurchaseDate > 30 days ago
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            query = query
              .eq('status', 'ACTIVE')
              .lt('last_purchase_date', thirtyDaysAgo.toISOString());
          } else {
            query = query.eq('status', filters.status);
          }
        }

        // T011: Date range filters
        if (filters.dateStart) {
          query = query.gte('created_at', filters.dateStart);
        }
        if (filters.dateEnd) {
          query = query.lte('created_at', filters.dateEnd);
        }

        // Client company filter
        if (filters.clientCompanyId) {
          query = query.eq('client_company_id', filters.clientCompanyId);
        }
      }

      // Apply pagination and ordering
      const sortColumn = filters?.sortBy || 'created_at';
      const sortAscending = filters?.sortOrder === 'asc';

      const { data, count, error } = await query
        .order(sortColumn, { ascending: sortAscending })
        .range(from, to);

      if (error) return { data: null, error };

      const totalCount = count ?? 0;
      const contacts = (data || []).map(c => transformContact(c as DbContact));
      const hasMore = (pageIndex + 1) * pageSize < totalCount;

      return {
        data: {
          data: contacts,
          totalCount,
          pageIndex,
          pageSize,
          hasMore,
        },
        error: null,
      };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Cria um novo contato.
   *
   * ⚠️ `owner_id` É OBRIGATÓRIO AQUI, e não é preferência de produto — é o que faz a criação
   * FUNCIONAR para quem não é admin (16/09/2026, caso do Pedro).
   *
   * A cadeia, medida em produção: este insert sai SEM dono → o trigger `zz_dono_padrao_lead_novo`
   * carimba o Denilson (ele existe para os 5 caminhos AUTOMÁTICOS de entrada de lead; o próprio
   * comentário dele diz que "card criado na mão pela UI já nasce com o dono do criador") → o
   * `.select()` do PostgREST faz `INSERT ... RETURNING`, que o Postgres submete à policy de
   * SELECT (`contacts_select` = `ve_tudo() or owner_id = auth.uid()`) → o vendedor não enxerga a
   * linha que acabou de criar → **42501, e a transação inteira é revertida**. O contato não é
   * criado, o negócio não é criado, e a tela diz só "Erro ao criar negócio".
   *
   * Provado no banco: o mesmo insert SEM `returning` passa; COM `returning` dá 42501; e com
   * `owner_id` explícito passa com `returning`. Admin nunca viu o bug porque `ve_tudo()` é true
   * para ele — o bug só existia para o papel que mais cria lead na mão.
   *
   * @param contact - Dados do contato (sem id e createdAt).
   * @returns Promise com contato criado ou erro.
   */
  async create(contact: Omit<Contact, 'id' | 'createdAt'>): Promise<{ data: Contact | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const phoneE164 = normalizePhoneE164(contact.phone);
      const [organizationId, ownerId] = await Promise.all([
        getCurrentOrganizationId(),
        getCurrentUserId(),
      ]);
      const insertData = {
        name: contact.name,
        email: sanitizeText(contact.email),
        phone: sanitizeText(phoneE164),
        role: sanitizeText(contact.role),
        client_company_id: sanitizeUUID(contact.clientCompanyId || contact.companyId),
        avatar: sanitizeText(contact.avatar),
        notes: sanitizeText(contact.notes),
        status: contact.status || 'ACTIVE',
        stage: contact.stage || 'LEAD',
        source: sanitizeText(contact.source),
        birth_date: sanitizeText(contact.birthDate),
        last_interaction: sanitizeText(contact.lastInteraction),
        last_purchase_date: sanitizeText(contact.lastPurchaseDate),
        total_value: sanitizeNumber(contact.totalValue, 0),
        ...(organizationId ? { organization_id: organizationId } : {}),
        ...(ownerId ? { owner_id: ownerId } : {}),
      };

      const { data, error } = await supabase
        .from('contacts')
        .insert(insertData)
        .select()
        .single();

      if (error) return { data: null, error };

      return { data: transformContact(data as DbContact), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Atualiza um contato existente.
   * 
   * @param id - ID do contato a ser atualizado.
   * @param updates - Campos a serem atualizados.
   * @returns Promise com erro, se houver.
   */
  async update(id: string, updates: Partial<Contact>): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      const dbUpdates = transformContactToDb(updates);
      dbUpdates.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('contacts')
        .update(dbUpdates)
        .eq('id', id);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  /**
   * Exclui um contato.
   * 
   * @param id - ID do contato a ser excluído.
   * @returns Promise com erro, se houver.
   */
  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      // UX: ao excluir contato, também removemos atividades "contact-only"
      // (FK em activities.contact_id é SET NULL, então deletamos explicitamente
      // para evitar tarefas órfãs aparecerem no Inbox/Focus.)
      const { error: activitiesError } = await supabase
        .from('activities')
        .delete()
        .eq('contact_id', id);
      if (activitiesError) return { error: activitiesError };

      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', id);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  /**
   * Verifica se o contato tem deals associados.
   * 
   * @param contactId - ID do contato.
   * @returns Promise com informações sobre os deals associados.
   */
  async hasDeals(contactId: string): Promise<{ hasDeals: boolean; dealCount: number; deals: Array<{ id: string; title: string }>; error: Error | null }> {
    try {
      if (!supabase) {
        return {
          hasDeals: false,
          dealCount: 0,
          deals: [],
          error: new Error('Supabase não configurado'),
        };
      }
      const { data, count, error } = await supabase
        .from('deals')
        .select('id, title', { count: 'exact' })
        .eq('contact_id', contactId);

      if (error) return { hasDeals: false, dealCount: 0, deals: [], error };
      const deals = (data || []).map(d => ({ id: d.id, title: d.title }));
      return { hasDeals: (count || 0) > 0, dealCount: count || 0, deals, error: null };
    } catch (e) {
      return { hasDeals: false, dealCount: 0, deals: [], error: e as Error };
    }
  },

  /**
   * Exclui contato e todos os deals associados (cascade).
   * 
   * @param contactId - ID do contato.
   * @returns Promise com erro, se houver.
   */
  async deleteWithDeals(contactId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      // First delete all deals for this contact
      const { error: dealsError } = await supabase
        .from('deals')
        .delete()
        .eq('contact_id', contactId);

      if (dealsError) return { error: dealsError };

      // Then delete the contact
      const { error: contactError } = await supabase
        .from('contacts')
        .delete()
        .eq('id', contactId);

      return { error: contactError };
    } catch (e) {
      return { error: e as Error };
    }
  },
};

/**
 * Escapa o que o `ilike` do Postgres trataria como CURINGA.
 *
 * `ilike` recebe um PATTERN, não um texto: `%` casa qualquer coisa e `_` casa um caractere. O
 * postgrest-js manda o valor cru na URL, sem escapar nada. Sem isto, criar um negócio para
 * "SAUDE 100_ LTDA" acharia "SAUDE 1000 LTDA" e ligaria o negócio à EMPRESA ERRADA — silenciosamente,
 * que é o pior desfecho possível para uma busca que existe justamente para evitar confusão.
 *
 * A barra invertida é o escape padrão do LIKE, e precisa vir primeiro para não escapar os escapes.
 */
const escaparCuringasDoLike = (texto: string): string =>
  texto.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

/**
 * Empresa da organização com este nome, ou `null`.
 *
 * `ilike` com os curingas escapados é igualdade que ignora maiúsculas. Some-se a isso o `trim` do
 * alvo aqui e o `trim` de TODO caminho que grava nome (inclusive `update`, que não trimava até
 * 16/09/2026) e a busca passa a concordar com o índice `lower(btrim(name))`.
 *
 * ⚠️ POR QUE A CONCORDÂNCIA IMPORTA: se a busca não acha e o índice acha, o insert bate em 23505,
 * a reconsulta erra pelo mesmo motivo e o negócio NUNCA é criado — bloqueio permanente, porque o
 * estado do banco não muda entre as tentativas. Era exatamente isso que acontecia com um nome
 * gravado com espaço no fim.
 *
 * `.limit(1)` antes do `maybeSingle()` é proposital: `maybeSingle` sozinho ESTOURA (PGRST116)
 * quando há mais de uma linha, e o banco pode ter duplicatas anteriores ao índice. Achar uma
 * delas é o comportamento certo aqui; quebrar a criação por causa de lixo velho, não.
 */
async function buscarEmpresaPorNome(
  nome: string,
  organizationId: string | null,
): Promise<CRMCompany | null> {
  if (!supabase) return null;
  const alvo = nome.trim();
  if (!alvo) return null;
  try {
    let busca = supabase
      .from('crm_companies')
      .select('*')
      .ilike('name', escaparCuringasDoLike(alvo));
    if (organizationId) busca = busca.eq('organization_id', organizationId);
    const { data, error } = await busca.limit(1).maybeSingle();
    if (error || !data) return null;
    return transformCRMCompany(data as DbCRMCompany);
  } catch {
    // Busca é otimização contra duplicata: falhar aqui devolve ao insert, que ainda tem o índice
    // único atrás dele. Nunca pode impedir a criação.
    return null;
  }
}

/**
 * Serviço de empresas CRM do Supabase.
 *
 * Fornece operações CRUD para a tabela `crm_companies`.
 * Empresas CRM são as empresas dos clientes, não o tenant.
 *
 * @example
 * ```typescript
 * const { data, error } = await companiesService.getAll();
 * ```
 */
export const companiesService = {
  /**
   * Busca empresas por uma lista de IDs.
   * Otimizado para buscar apenas as empresas necessárias.
   *
   * @param ids - Array de IDs de empresas a buscar.
   * @param options - Opções adicionais, incluindo AbortSignal para cancelar a request.
   * @returns Promise com array de empresas ou erro.
   */
  async getByIds(ids: string[], options?: { signal?: AbortSignal }): Promise<{ data: CRMCompany[] | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      // Se não há IDs, retorna array vazio
      if (!ids || ids.length === 0) {
        return { data: [], error: null };
      }
      // Remove duplicatas e valores vazios
      const uniqueIds = [...new Set(ids.filter(Boolean))];
      if (uniqueIds.length === 0) {
        return { data: [], error: null };
      }

      let companiesQuery = supabase
        .from('crm_companies')
        .select('*');
      if (options?.signal) companiesQuery = companiesQuery.abortSignal(options.signal);
      const { data, error } = await companiesQuery.in('id', uniqueIds);

      if (error) return { data: null, error };
      return { data: (data || []).map(c => transformCRMCompany(c as DbCRMCompany)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Busca todas as empresas CRM da organização.
   *
   * @returns Promise com array de empresas ou erro.
   */
  async getAll(): Promise<{ data: CRMCompany[] | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      // Safety limit: cap at 1000 for non-paginated access
      const { data, error } = await supabase
        .from('crm_companies')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) return { data: null, error };
      return { data: (data || []).map(c => transformCRMCompany(c as DbCRMCompany)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Cria uma empresa CRM — ou devolve a que já existe com o mesmo nome.
   *
   * É **find-or-create**, não um insert cego, e essa é a única forma de não duplicar: este método
   * é o funil por onde passam TODOS os caminhos de empresa da interface logada (o modal de novo
   * negócio, via `useCreateDealWithContact`, e o modal "Nova Empresa" da tela de Contatos, via
   * `useCreateCompany`). Corrigir só um caller deixaria o outro duplicando.
   *
   * O caso que obrigou (16/09/2026): seis linhas idênticas "TEAM MONTEIRO TREINAMENTOS LTDA" em
   * dois minutos. A empresa é a PRIMEIRA escrita da criação de negócio e o contato vem depois —
   * quando o contato falhava, a mutation abortava mas a empresa já estava gravada, sem
   * compensação. Cada nova tentativa do vendedor deixava mais uma.
   *
   * ⚠️ REUSAR NÃO SOBRESCREVE. Se a empresa já existe, `industry` e `website` digitados agora são
   * ignorados: apagar em silêncio o que já estava lá seria pior do que a duplicata que este método
   * evita. Quem quiser corrigir esses campos usa `update`.
   *
   * ⚠️ O EMPATE É POR NOME, e nome é tudo o que esta tabela tem para desempatar (não há CNPJ;
   * `website` fica vazio em todos os caminhos automáticos). A comparação é a mesma do índice
   * `crm_companies_nome_unico_por_org`: sem espaço nas pontas, sem diferenciar maiúsculas. Não é
   * fuzzy de propósito — "Monteiro Ltda" e "Monteiro ME" continuam duas empresas.
   *
   * @param company - Dados da empresa.
   * @returns Promise com a empresa (nova ou reaproveitada) ou erro.
   */
  async create(company: Omit<CRMCompany, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ data: CRMCompany | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const nome = (company.name ?? '').trim();
      if (!nome) {
        return { data: null, error: new Error('Informe o nome da empresa.') };
      }
      const organizationId = await getCurrentOrganizationId();

      const jaExiste = await buscarEmpresaPorNome(nome, organizationId);
      if (jaExiste) return { data: jaExiste, error: null };

      const insertData = {
        name: nome,
        industry: sanitizeText(company.industry),
        website: sanitizeText(company.website),
        ...(organizationId ? { organization_id: organizationId } : {}),
      };

      const { data, error } = await supabase
        .from('crm_companies')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        // 23505 = o índice único pegou. Duas abas (ou dois usuários) passaram pela busca acima
        // antes de qualquer uma inserir: a busca-antes-de-inserir não é atômica, e é o banco que
        // decide o empate. Perder a corrida não é erro — é encontrar a empresa.
        if (String((error as { code?: string }).code ?? '') === '23505') {
          const vencedora = await buscarEmpresaPorNome(nome, organizationId);
          if (vencedora) return { data: vencedora, error: null };
          // O banco diz que existe e a busca não acha: os dois critérios discordaram. Não deveria
          // acontecer (todo caminho de escrita trima o nome), mas se acontecer é um beco sem saída
          // — repetir dá no mesmo, porque o estado do banco não muda. Uma mensagem que diz o que
          // fazer vale mais que a string crua do Postgres na cara de quem só queria criar um card.
          return {
            data: null,
            error: new Error(
              `Já existe uma empresa com o nome "${nome}", mas não consegui encontrá-la para `
              + 'reaproveitar. Escolha a empresa pela busca em vez de digitar o nome, ou ajuste o '
              + 'cadastro dela em Contatos → Empresas.',
            ),
          };
        }
        return { data: null, error };
      }
      return { data: transformCRMCompany(data as DbCRMCompany), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Atualiza uma empresa CRM existente.
   * 
   * @param id - ID da empresa.
   * @param updates - Campos a serem atualizados.
   * @returns Promise com erro, se houver.
   */
  async update(id: string, updates: Partial<CRMCompany>): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      const dbUpdates: Partial<DbCRMCompany> = {};
      // TRIM OBRIGATÓRIO. Este era o ÚNICO caminho de escrita que gravava o nome cru (todos os
      // outros — criação, import, rotas públicas, webhook — já aparavam), e bastava alguém colar
      // "TEAM MONTEIRO " de uma planilha aqui para o índice `lower(btrim(name))` e a busca por
      // nome passarem a discordar: a busca não acharia a empresa, o insert bateria no índice, e
      // criar negócio com esse nome ficaria bloqueado para sempre. O espaço é invisível na tela.
      if (updates.name !== undefined) dbUpdates.name = (updates.name ?? '').trim();
      if (updates.industry !== undefined) dbUpdates.industry = updates.industry || null;
      if (updates.website !== undefined) dbUpdates.website = updates.website || null;
      dbUpdates.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('crm_companies')
        .update(dbUpdates)
        .eq('id', id);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  /**
   * Exclui uma empresa CRM.
   * 
   * @param id - ID da empresa.
   * @returns Promise com erro, se houver.
   */
  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }

      // Primeiro, remove vínculo para evitar erro de FK.
      const { error: contactsUpdateError } = await supabase
        .from('contacts')
        .update({ client_company_id: null })
        .eq('client_company_id', id);
      if (contactsUpdateError) return { error: contactsUpdateError };

      const { error: dealsUpdateError } = await supabase
        .from('deals')
        .update({ client_company_id: null })
        .eq('client_company_id', id);
      if (dealsUpdateError) return { error: dealsUpdateError };

      const { error } = await supabase
        .from('crm_companies')
        .delete()
        .eq('id', id);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
