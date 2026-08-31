/**
 * @fileoverview Fonte ÚNICA da navegação do CRM.
 *
 * O menu é dividido em dois grupos, decisão da Thalita em 30/08/2026 ao preparar
 * o CRM para ser vendido por assinatura:
 *
 * - **OPERAÇÃO** — o trabalho do dia: atender, mover card, cobrar follow-up.
 * - **CONTA** — o que é do assinante e não da operação: perfil, configuração e,
 *   quando existirem, tutorial, assinatura, indicação e suporte.
 *
 * A separação existe porque o mesmo app passa a ter dois donos de contexto: quem
 * OPERA (consultor) e quem PAGA (assinante). Hoje o `vendedor` nem enxerga
 * Configurações (ver `VENDEDOR_BLOCKED_PREFIXES` em `lib/rbac`), então para ele
 * o grupo CONTA é só "Perfil" — e é exatamente esse o recado: as preferências
 * pessoais dele moram ali.
 *
 * ⚠️ Antes de 30/08 a lista do desktop vivia hardcoded dentro de `Layout.tsx` e
 * a do tablet/mobile aqui — as duas divergiam sozinhas. Não recriar essa
 * duplicação: item novo entra em {@link NAV_GROUPS} e aparece nas três telas.
 *
 * @module components/navigation/navConfig
 */

import type { ComponentType } from 'react';
import {
  Inbox,
  MessageSquare,
  KanbanSquare,
  Users,
  CheckSquare,
  MoreHorizontal,
  LayoutDashboard,
  BarChart3,
  Settings,
  User,
  Map,
} from 'lucide-react';
import { canAccessRoute, type Role } from '@/lib/rbac';
import type { RouteName } from '@/lib/prefetch';

/** Ícone de navegação: lucide aceita tanto `className` quanto `size`. */
export type NavIcon = ComponentType<{ className?: string; size?: number | string }>;

// ---------------------------------------------------------------------------
// Grupos (fonte única)
// ---------------------------------------------------------------------------

export type NavGroupId = 'operacao' | 'conta';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: NavIcon;
  /** Chave de prefetch do chunk da rota, quando a rota tem uma. */
  prefetch?: RouteName;
}

export interface NavGroup {
  id: NavGroupId;
  /** Cabeçalho exibido acima do grupo na sidebar. */
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'operacao',
    label: 'Operação',
    items: [
      { id: 'inbox', label: 'Inbox', href: '/inbox', icon: Inbox, prefetch: 'inbox' },
      { id: 'messaging', label: 'Chat ao vivo', href: '/messaging', icon: MessageSquare },
      { id: 'dashboard', label: 'Visão Geral', href: '/dashboard', icon: LayoutDashboard, prefetch: 'dashboard' },
      { id: 'boards', label: 'Funis', href: '/boards', icon: KanbanSquare, prefetch: 'boards' },
      { id: 'contacts', label: 'Contatos', href: '/contacts', icon: Users, prefetch: 'contacts' },
      { id: 'activities', label: 'Atividades', href: '/activities', icon: CheckSquare, prefetch: 'activities' },
      { id: 'reports', label: 'Relatórios', href: '/reports', icon: BarChart3, prefetch: 'reports' },
    ],
  },
  {
    id: 'conta',
    label: 'Conta',
    items: [
      // Roadmap vive na CONTA, não na Operação: não é trabalho do dia, é a
      // relação do time com o produto — o mesmo lugar onde vão entrar tutorial,
      // suporte e assinatura.
      { id: 'roadmap', label: 'Roadmap', href: '/roadmap', icon: Map },
      { id: 'settings', label: 'Configurações', href: '/settings', icon: Settings, prefetch: 'settings' },
      { id: 'profile', label: 'Perfil', href: '/profile', icon: User },
    ],
  },
];

/**
 * Grupos com os itens filtrados pelo papel (default-deny p/ `trafego`).
 * Grupo que ficou sem item algum é removido — não renderiza cabeçalho órfão.
 * Sem papel (ainda carregando) devolve tudo, para não piscar o menu do usuário comum.
 */
export function visibleNavGroups(role: Role | undefined): NavGroup[] {
  if (!role) return NAV_GROUPS;
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccessRoute(role, item.href)),
  })).filter((group) => group.items.length > 0);
}

/** Todos os itens visíveis, achatados (para buscas por href/id). */
export function visibleNavItems(role: Role | undefined): NavItem[] {
  return visibleNavGroups(role).flatMap((group) => group.items);
}

// ---------------------------------------------------------------------------
// Barra inferior do mobile (5 slots + "Mais")
// ---------------------------------------------------------------------------

export type PrimaryNavId = 'inbox' | 'messaging' | 'boards' | 'contacts' | 'activities' | 'more';

export interface PrimaryNavItem {
  id: PrimaryNavId;
  label: string;
  /** Route to navigate. For "more", this is omitted because it opens a menu/sheet. */
  href?: string;
  icon: NavIcon;
}

/** IDs de OPERAÇÃO que ganham slot fixo na barra inferior, na ordem. */
const BOTTOM_NAV_IDS = ['inbox', 'messaging', 'boards', 'contacts', 'activities'] as const;

const OPERACAO_ITEMS = NAV_GROUPS.find((g) => g.id === 'operacao')!.items;

export const PRIMARY_NAV: PrimaryNavItem[] = [
  ...BOTTOM_NAV_IDS.map((id) => {
    const item = OPERACAO_ITEMS.find((i) => i.id === id)!;
    return { id: id as PrimaryNavId, label: item.label, href: item.href, icon: item.icon };
  }),
  { id: 'more', label: 'Mais', icon: MoreHorizontal },
];

/**
 * Itens de navegação primários visíveis para o papel (default-deny p/ 'trafego').
 * Itens sem `href` (ex.: "Mais") são sempre exibidos — o conteúdo do menu que
 * eles abrem é filtrado à parte por {@link visibleMoreMenuGroups}.
 * Sem papel (carregando), devolve tudo para evitar flicker do usuário comum.
 */
export function visiblePrimaryNav(role: Role | undefined): PrimaryNavItem[] {
  if (!role) return PRIMARY_NAV;
  return PRIMARY_NAV.filter((item) => !item.href || canAccessRoute(role, item.href));
}

/**
 * O que entra no "Mais" do mobile: tudo que NÃO tem slot na barra inferior,
 * mantendo os cabeçalhos de grupo. Assim o assinante encontra Conta no celular
 * pelo mesmo nome que vê no desktop.
 */
export function visibleMoreMenuGroups(role: Role | undefined): NavGroup[] {
  const naBarra = new Set<string>(BOTTOM_NAV_IDS);
  return visibleNavGroups(role)
    .map((group) => ({ ...group, items: group.items.filter((item) => !naBarra.has(item.id)) }))
    .filter((group) => group.items.length > 0);
}
