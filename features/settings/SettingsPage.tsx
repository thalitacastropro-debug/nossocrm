'use client'

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSettingsController } from './hooks/useSettingsController';
import { TagsManager } from './components/TagsManager';
import { CustomFieldsManager } from './components/CustomFieldsManager';
import { ApiKeysSection } from './components/ApiKeysSection';
import { WebhooksSection } from './components/WebhooksSection';
import { McpSection } from './components/McpSection';
import { ChannelsSection } from './components/ChannelsSection';
import { BusinessUnitsSection } from './components/BusinessUnitsSection';
import { DataStorageSettings } from './components/DataStorageSettings';
import { ProductsCatalogManager } from './components/ProductsCatalogManager';
import { AICenterSettings } from './AICenterSettings';

import { UsersPage } from './UsersPage';
import { AdCreativesPage } from './AdCreativesPage';
import { useAuth } from '@/context/AuthContext';
import { Settings as SettingsIcon, Users, Database, Sparkles, Plug, Package, Building2, Megaphone } from 'lucide-react';
import { SelectField } from '@/components/ui/FormField';
import { Button } from '@/components/ui/button';
import {
  canSeeSettingsTab,
  visibleIntegrationsSubTabs,
  type SettingsTabId,
  type IntegrationsSubTabId,
} from '@/lib/rbac';

type SettingsTab = SettingsTabId;

interface GeneralSettingsProps {
  hash?: string;
  isAdmin: boolean;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = ({ hash, isAdmin }) => {
  const controller = useSettingsController();

  // Scroll to hash element (e.g., #ai-config)
  useEffect(() => {
    if (hash) {
      const elementId = hash.slice(1); // Remove #
      setTimeout(() => {
        const element = document.getElementById(elementId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  }, [hash]);


  return (
    <div className="pb-10">
      {/* General Settings */}
      <div className="mb-12">
        <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Página Inicial</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Escolha qual tela deve abrir quando você iniciar o CRM.
          </p>
          <SelectField
            label="Página Inicial"
            containerClassName="max-w-xs"
            options={[
              { value: '/dashboard', label: 'Dashboard' },
              { value: '/inbox-list', label: 'Inbox (Lista)' },
              { value: '/inbox-focus', label: 'Inbox (Foco)' },
              { value: '/boards', label: 'Funis (Kanban)' },
              { value: '/contacts', label: 'Contatos' },
              { value: '/activities', label: 'Atividades' },
              { value: '/reports', label: 'Relatórios' },
            ]}
            value={controller.defaultRoute}
            onChange={(e) => controller.setDefaultRoute(e.target.value)}
            aria-label="Selecionar página inicial"
          />
        </div>
      </div>

      {isAdmin && (
        <>
          <TagsManager
            availableTags={controller.availableTags}
            newTagName={controller.newTagName}
            setNewTagName={controller.setNewTagName}
            onAddTag={controller.handleAddTag}
            onRemoveTag={controller.removeTag}
          />

          <CustomFieldsManager
            customFieldDefinitions={controller.customFieldDefinitions}
            newFieldLabel={controller.newFieldLabel}
            setNewFieldLabel={controller.setNewFieldLabel}
            newFieldType={controller.newFieldType}
            setNewFieldType={controller.setNewFieldType}
            newFieldOptions={controller.newFieldOptions}
            setNewFieldOptions={controller.setNewFieldOptions}
            editingId={controller.editingId}
            onStartEditing={controller.startEditingField}
            onCancelEditing={controller.cancelEditingField}
            onSaveField={controller.handleSaveField}
            onRemoveField={controller.removeCustomField}
          />
        </>
      )}

    </div>
  );
};

const ProductsSettings: React.FC = () => {
  return (
    <div className="pb-10">
      <ProductsCatalogManager />
    </div>
  );
};

const INTEGRATIONS_SUBTAB_LABELS: Record<IntegrationsSubTabId, string> = {
  channels: 'Canais (Messaging)',
  webhooks: 'Webhooks',
  api: 'API',
  mcp: 'MCP',
};

/**
 * @param allowed Sub-abas que o papel atual pode ver (default-deny). Para 'trafego'
 *   é só ['channels','webhooks'] — as seções API/MCP nem chegam a montar.
 */
const IntegrationsSettings: React.FC<{ allowed: IntegrationsSubTabId[] }> = ({ allowed }) => {
  const [subTab, setSubTab] = useState<IntegrationsSubTabId>(allowed[0] ?? 'channels');

  useEffect(() => {
    const syncFromHash = () => {
      const h = typeof window !== 'undefined' ? (window.location.hash || '').replace('#', '') : '';
      // Só aceita hash de sub-aba permitida ao papel (bloqueia deep-link p/ #api / #mcp).
      if ((allowed as string[]).includes(h)) setSubTab(h as IntegrationsSubTabId);
    };

    syncFromHash();

    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', syncFromHash);
      return () => window.removeEventListener('hashchange', syncFromHash);
    }
  }, [allowed]);

  const setSubTabAndHash = (t: IntegrationsSubTabId) => {
    setSubTab(t);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.hash = `#${t}`;
      window.history.replaceState({}, '', url.toString());
    }
  };

  return (
    <div className="pb-10">
      <div className="flex items-center gap-2 mb-6">
        {allowed.map((id) => {
          const active = subTab === id;
          return (
            <Button
              key={id}
              type="button"
              variant={active ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSubTabAndHash(id)}
            >
              {INTEGRATIONS_SUBTAB_LABELS[id]}
            </Button>
          );
        })}
      </div>

      {/* Guarda dupla: além do subTab, exige que a sub-aba esteja liberada ao papel,
          garantindo que ApiKeysSection/McpSection NUNCA montem para 'trafego'. */}
      {subTab === 'channels' && allowed.includes('channels') && <ChannelsSection />}
      {subTab === 'api' && allowed.includes('api') && <ApiKeysSection />}
      {subTab === 'webhooks' && allowed.includes('webhooks') && <WebhooksSection />}
      {subTab === 'mcp' && allowed.includes('mcp') && <McpSection />}
    </div>
  );
};

interface SettingsPageProps {
  tab?: SettingsTab;
}

/**
 * Componente React `SettingsPage`.
 *
 * @param {SettingsPageProps} { tab: initialTab } - Parâmetro `{ tab: initialTab }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
const SettingsPage: React.FC<SettingsPageProps> = ({ tab: initialTab }) => {
  const { profile } = useAuth();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'general');

  // Get hash from URL for scrolling
  const hash = typeof window !== 'undefined' ? window.location.hash : '';

  // Determine tab from pathname if available
  useEffect(() => {
    if (pathname?.includes('/settings/ai')) {
      setActiveTab('ai');
    } else if (pathname?.includes('/settings/products')) {
      setActiveTab('products');
    } else if (pathname?.includes('/settings/business-units') || pathname?.includes('/settings/unidades')) {
      setActiveTab('business-units');
    } else if (pathname?.includes('/settings/integracoes')) {
      setActiveTab('integrations');
    } else if (pathname?.includes('/settings/data')) {
      setActiveTab('data');
    } else if (pathname?.includes('/settings/users')) {
      setActiveTab('users');
    } else {
      setActiveTab('general');
    }
  }, [pathname]);

  const role = profile?.role;
  const isAdmin = role === 'admin';

  // Vendedor não entra em Configurações (decisão da Thalita, 24/08/2026 — ver
  // VENDEDOR_BLOCKED_PREFIXES em lib/rbac). O guard de rota no servidor já
  // redireciona; este bloco cobre a montagem por qualquer outro caminho e evita
  // que o fallback de aba caia na Geral e mostre a página assim mesmo.
  if (role === 'vendedor') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
            Acesso restrito
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            As configurações do CRM são da administração. Suas preferências pessoais ficam
            no seu Perfil.
          </p>
        </div>
      </div>
    );
  }

  // Fonte única das abas; a visibilidade por papel vem do rbac (default-deny p/ 'trafego').
  const allTabs: { id: SettingsTab; name: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'general', name: 'Geral', icon: SettingsIcon },
    { id: 'products', name: 'Produtos/Serviços', icon: Package },
    { id: 'ad-creatives', name: 'Anúncios', icon: Megaphone },
    { id: 'business-units', name: 'Unidades', icon: Building2 },
    { id: 'integrations', name: 'Integrações', icon: Plug },
    { id: 'ai', name: 'Central de I.A', icon: Sparkles },
    { id: 'data', name: 'Dados', icon: Database },
    { id: 'users', name: 'Equipe', icon: Users },
  ];
  const tabs = allTabs.filter((t) => canSeeSettingsTab(role, t.id));

  const renderContent = () => {
    // Default-deny: se o papel não pode ver a aba ativa (ex.: deep-link), cai na Geral.
    // Garante que AICenterSettings/DataStorageSettings/UsersPage/BusinessUnits NÃO montem
    // para papéis sem permissão (ex.: 'trafego').
    if (!canSeeSettingsTab(role, activeTab)) {
      return <GeneralSettings hash={hash} isAdmin={isAdmin} />;
    }

    switch (activeTab) {
      case 'products':
        return <ProductsSettings />;
      case 'ad-creatives':
        return <AdCreativesPage />;
      case 'business-units':
        return (
          <div className="pb-10 space-y-8">
            <BusinessUnitsSection />
          </div>
        );
      case 'integrations':
        return <IntegrationsSettings allowed={visibleIntegrationsSubTabs(role)} />;
      case 'ai':
        return <AICenterSettings />;
      case 'data':
        return <DataStorageSettings />;
      case 'users':
        return <UsersPage />;
      default:
        return <GeneralSettings hash={hash} isAdmin={isAdmin} />;
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Tabs minimalistas */}
      <div className="flex items-center gap-1 mb-8 border-b border-slate-200 dark:border-white/10">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${isActive
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 dark:bg-primary-400 rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {renderContent()}
    </div>
  );
};

export default SettingsPage;

