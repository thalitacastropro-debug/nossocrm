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
export const TRAFEGO_ALLOWED_ROUTES: readonly string[] = [
  '/settings',
  '/profile',
  // Trocar a própria senha é direito de qualquer papel. Sem estas duas aqui, a
  // rota deixa de ser "livre para todos" e o guard do servidor passa a consultar
  // o papel de quem está trocando a senha — barrando o `trafego` no meio do
  // caminho. Descoberto em 25/08/2026 por um teste, ao liberar a recuperação de
  // senha para quem está deslogado.
  '/forgot-password',
  '/reset-password',
];

/**
 * Prefixos de rota FECHADOS para `vendedor` (a rota e tudo abaixo dela).
 *
 * Decisão da Thalita em 24/08/2026, com o Pedro já no time: *"acho que nenhum
 * vendedor deve ter acesso às configurações"*. Configurações concentra a
 * Central de I.A (a Ana e a chave que paga a IA), o "DELETAR TUDO" da aba Dados,
 * a Equipe, as Integrações e as Unidades — nada que um consultor precise para
 * vender. As preferências pessoais dele ficam em `/profile`.
 */
export const VENDEDOR_BLOCKED_PREFIXES: readonly string[] = ['/settings'];

/** Remove barra final (exceto raiz) para comparar pathname de forma estável. */
function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/**
 * Um papel pode acessar a rota (pathname)?
 * - `admin`: sempre `true`.
 * - `vendedor`: tudo, MENOS os prefixos de {@link VENDEDOR_BLOCKED_PREFIXES}.
 * - `trafego`: `true` só para as rotas explicitamente liberadas (default-deny).
 *
 * Usado no guard central do servidor (proxy) e para filtrar itens de navegação.
 */
export function canAccessRoute(role: Role, pathname: string): boolean {
  const path = normalizePath(pathname);

  if (role === 'trafego') return TRAFEGO_ALLOWED_ROUTES.includes(path);

  if (role === 'vendedor') {
    return !VENDEDOR_BLOCKED_PREFIXES.some(
      (prefixo) => path === prefixo || path.startsWith(`${prefixo}/`),
    );
  }

  return true;
}

/**
 * Para onde mandar alguém que caiu numa rota proibida.
 *
 * Não pode ser fixo em `/settings`: desde que o vendedor perdeu Configurações,
 * mandar ele para lá seria um laço de redirecionamento.
 */
export function homeRouteFor(role: Role): string {
  if (role === 'trafego') return '/settings';
  return '/boards';
}

// ---------------------------------------------------------------------------
// Configurações (abas e sub-abas)
// ---------------------------------------------------------------------------

/** IDs das abas da página de Configurações. */
export type SettingsTabId =
  | 'general'
  | 'products'
  | 'ad-creatives'
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
 * - `ai` / `data` / `products` / `ad-creatives` / `business-units` / `users`: só `admin`.
 *
 * `ai` e `data` eram visíveis para `vendedor` até 24/08/2026. Decisão da Thalita
 * ao trazer o Pedro para o time — um consultor fica com "Geral" e o próprio
 * perfil, nada além:
 * - **Dados** tem o botão "DELETAR TUDO" (varre atividades, negócios, funis...).
 * - **Central de I.A** é a configuração da Ana e da chave que paga a IA; mexer
 *   nela quebra o atendimento da operação inteira.
 * Nenhuma das duas é blindagem sozinha: a RLS é quem barra de fato (ver a
 * migração `20260824230000_fecha_credenciais_e_organizacao`). Isto aqui evita
 * oferecer o caminho.
 *
 * `ad-creatives` (cadastro de qual criativo o lead veio) é só `admin` por
 * decisão da Thalita em 26/08/2026: o consultor LÊ a promessa do anúncio no
 * card, mas quem cadastra id -> vídeo é ela. A RLS da tabela `ad_creatives`
 * é quem barra de fato (escrita exige `e_admin()`); isto aqui só evita
 * oferecer o caminho.
 *
 * Default-deny: papel/aba não mapeado retorna `false`.
 */
export function canSeeSettingsTab(role: Role | undefined, tab: SettingsTabId): boolean {
  // Vendedor não entra em Configurações (ver VENDEDOR_BLOCKED_PREFIXES). Isto
  // cobre o caso de o componente ser montado por outro caminho que não a rota.
  if (role === 'vendedor') return false;

  switch (tab) {
    case 'general':
      return true;
    case 'integrations':
      return role === 'admin' || role === 'trafego';
    case 'ai':
    case 'data':
    case 'products':
    case 'ad-creatives':
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
