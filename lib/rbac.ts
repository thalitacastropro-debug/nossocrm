/**
 * @fileoverview RBAC central — papéis do CRM e allowlist de rotas/seções.
 *
 * Papéis (`profiles.role`):
 * - `admin`    : acesso total (config de sistema, usuários, IA, integrações...).
 * - `vendedor` : operação comercial (funis, chat, contatos, relatórios...).
 * - `trafego`  : parceiro de tráfego (ex.: Lobato). Acesso MÍNIMO — só configura o
 *                intake do Meta em Configurações (seções Webhooks + Canais) e as
 *                preferências pessoais (página inicial / perfil). Nada mais.
 *
 * Modelo default-DENY para `trafego`: apenas o que está EXPLICITAMENTE liberado
 * aqui é permitido; qualquer outra rota/seção é negada. `admin` e `vendedor`
 * mantêm o comportamento atual (sem restrição de rota).
 *
 * Este módulo é PURO de propósito (sem React/Node/lucide): é consumido tanto no
 * proxy/edge (guard de rota no servidor — `lib/supabase/middleware.ts`) quanto no
 * cliente (nav lateral e Configurações). Não importe nada pesado aqui.
 *
 * @module lib/rbac
 */

/** Valores válidos de papel. Fonte única para o tipo e para os schemas Zod. */
export const ROLE_VALUES = ['admin', 'vendedor', 'trafego'] as const;

/** Papel de um usuário no CRM. */
export type Role = (typeof ROLE_VALUES)[number];

/** Type guard: valida um valor desconhecido como {@link Role}. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLE_VALUES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

/**
 * Rotas (pathname EXATO) liberadas para o papel `trafego`. Default-deny: só estas.
 * - `/settings` : Configurações (as seções internas são filtradas à parte — ver
 *                 {@link canSeeSettingsTab}). Subrotas como `/settings/ai` NÃO entram.
 * - `/profile`  : preferências pessoais / perfil.
 */
export const TRAFEGO_ALLOWED_ROUTES: readonly string[] = ['/settings', '/profile'];

/** Remove barra final (exceto raiz) para comparar pathname de forma estável. */
function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/**
 * Um papel pode acessar a rota (pathname)?
 * - `admin`/`vendedor`: sempre `true` (não há restrição de rota hoje).
 * - `trafego`: `true` só para as rotas explicitamente liberadas (default-deny).
 *
 * Usado no guard central do servidor (proxy) e para filtrar itens de navegação.
 */
export function canAccessRoute(role: Role, pathname: string): boolean {
  if (role !== 'trafego') return true;
  return TRAFEGO_ALLOWED_ROUTES.includes(normalizePath(pathname));
}

// ---------------------------------------------------------------------------
// Configurações (abas e sub-abas)
// ---------------------------------------------------------------------------

/** IDs das abas da página de Configurações. */
export type SettingsTabId =
  | 'general'
  | 'products'
  | 'business-units'
  | 'integrations'
  | 'ai'
  | 'data'
  | 'users';

/** IDs das sub-abas dentro de Configurações → Integrações. */
export type IntegrationsSubTabId = 'channels' | 'webhooks' | 'api' | 'mcp';

/** Ordem canônica das sub-abas de Integrações. */
export const INTEGRATIONS_SUBTABS: readonly IntegrationsSubTabId[] = [
  'channels',
  'webhooks',
  'api',
  'mcp',
];

/**
 * Um papel pode VER a aba de Configurações informada?
 * - `general`: todos (contém a preferência pessoal "Página Inicial").
 * - `integrations`: `admin` e `trafego` (é onde vivem Webhooks + Canais).
 * - `ai` / `data`: todos MENOS `trafego`.
 * - `products` / `business-units` / `users`: só `admin`.
 *
 * Default-deny: papel/aba não mapeado retorna `false`.
 */
export function canSeeSettingsTab(role: Role | undefined, tab: SettingsTabId): boolean {
  switch (tab) {
    case 'general':
      return true;
    case 'integrations':
      return role === 'admin' || role === 'trafego';
    case 'ai':
    case 'data':
      return role !== 'trafego';
    case 'products':
    case 'business-units':
    case 'users':
      return role === 'admin';
    default:
      return false;
  }
}

/**
 * Dentro de Integrações, um papel pode ver a sub-aba informada?
 * `trafego`: SÓ `webhooks` — a entrada de leads do Meta (webhook-in). Nunca Canais/API/MCP
 *   (decisão da Thalita 07-19: Canais é gestão de WhatsApp/admin; o intake dele vive no Webhooks).
 * Demais papéis que enxergam Integrações (hoje só `admin`) veem tudo.
 */
export function canSeeIntegrationsSubTab(
  role: Role | undefined,
  sub: IntegrationsSubTabId,
): boolean {
  if (role === 'trafego') return sub === 'webhooks';
  return true;
}

/** Sub-abas de Integrações visíveis para o papel (na ordem canônica). */
export function visibleIntegrationsSubTabs(role: Role | undefined): IntegrationsSubTabId[] {
  return INTEGRATIONS_SUBTABS.filter((sub) => canSeeIntegrationsSubTab(role, sub));
}
