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
} from 'lucide-react';
import { canAccessRoute, type Role } from '@/lib/rbac';

export type PrimaryNavId = 'inbox' | 'messaging' | 'boards' | 'contacts' | 'activities' | 'more';

export interface PrimaryNavItem {
  id: PrimaryNavId;
  label: string;
  /** Route to navigate. For "more", this is omitted because it opens a menu/sheet. */
  href?: string;
  icon: ComponentType<{ className?: string }>;
}

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: 'inbox', label: 'Inbox', href: '/inbox', icon: Inbox },
  { id: 'messaging', label: 'Chat ao vivo', href: '/messaging', icon: MessageSquare },
  { id: 'boards', label: 'Funis', href: '/boards', icon: KanbanSquare },
  { id: 'contacts', label: 'Contatos', href: '/contacts', icon: Users },
  { id: 'activities', label: 'Atividades', href: '/activities', icon: CheckSquare },
  { id: 'more', label: 'Mais', icon: MoreHorizontal },
];

export type SecondaryNavId = 'dashboard' | 'reports' | 'settings' | 'profile';

export interface SecondaryNavItem {
  id: SecondaryNavId;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

/** Mirrors non-primary destinations available in the desktop sidebar/user menu. */
export const SECONDARY_NAV: SecondaryNavItem[] = [
  { id: 'dashboard', label: 'Visão Geral', href: '/dashboard', icon: LayoutDashboard },
  { id: 'reports', label: 'Relatórios', href: '/reports', icon: BarChart3 },
  { id: 'settings', label: 'Configurações', href: '/settings', icon: Settings },
  { id: 'profile', label: 'Perfil', href: '/profile', icon: User },
];

/**
 * Itens de navegação primários visíveis para o papel (default-deny p/ 'trafego').
 * Itens sem `href` (ex.: "Mais") são sempre exibidos — o conteúdo do menu que
 * eles abrem é filtrado à parte por {@link visibleSecondaryNav}.
 * Sem papel (carregando), devolve tudo para evitar flicker do usuário comum.
 */
export function visiblePrimaryNav(role: Role | undefined): PrimaryNavItem[] {
  if (!role) return PRIMARY_NAV;
  return PRIMARY_NAV.filter((item) => !item.href || canAccessRoute(role, item.href));
}

/** Itens de navegação secundários visíveis para o papel (default-deny p/ 'trafego'). */
export function visibleSecondaryNav(role: Role | undefined): SecondaryNavItem[] {
  if (!role) return SECONDARY_NAV;
  return SECONDARY_NAV.filter((item) => canAccessRoute(role, item.href));
}
