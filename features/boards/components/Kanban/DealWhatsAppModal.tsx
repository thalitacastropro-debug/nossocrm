'use client';

import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { MessageThread } from '@/features/messaging/components/MessageThread';
import { MessageInput } from '@/features/messaging/components/MessageInput';
import {
  useConversation,
  useMarkConversationRead,
  useEnsureDealConversation,
} from '@/lib/query/hooks/useConversationsQuery';

interface DealWhatsAppModalProps {
  /** null/undefined = modal fechado. */
  deal: { id: string; conversationId?: string | null; title: string } | null;
  onClose: () => void;
}

/**
 * Conversa do WhatsApp do lead direto na board, sem sair pro Inbox nem abrir o
 * wa.me em outra guia. Se o lead ainda NÃO tem conversa (ex.: base fria do
 * backfill), cria a conversa sob demanda — assim o modal funciona pra QUALQUER
 * lead, inclusive os que vamos abordar na reativação.
 */
export function DealWhatsAppModal({ deal, onClose }: DealWhatsAppModalProps) {
  const isOpen = Boolean(deal);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const ensure = useEnsureDealConversation();
  const { data: conversation, isLoading } = useConversation(conversationId);
  const { mutate: markAsRead } = useMarkConversationRead();

  // Ao abrir: usa a conversa existente ou cria uma sob demanda pro deal.
  useEffect(() => {
    if (!deal) {
      setConversationId(undefined);
      setEnsureError(null);
      return;
    }
    if (deal.conversationId) {
      setConversationId(deal.conversationId);
      return;
    }
    setConversationId(undefined);
    setEnsureError(null);
    // Só re-resolve quando muda o deal (a mutation muda de identidade a cada render,
    // por isso não entra nas deps de propósito).
    ensure.mutate(deal.id, {
      onSuccess: (id) => setConversationId(id),
      onError: (e) => setEnsureError(e instanceof Error ? e.message : 'Não foi possível abrir a conversa'),
    });
  }, [deal?.id]);

  useEffect(() => {
    if (conversationId && conversation && conversation.unreadCount > 0) {
      markAsRead(conversationId);
    }
  }, [conversationId, conversation, markAsRead]);

  const resolving = isOpen && !conversationId && !ensureError;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={conversation?.contactName || conversation?.externalContactName || deal?.title || ''}
      size="lg"
      bodyClassName="p-0 flex-1 flex flex-col min-h-0"
    >
      <div className="flex-1 flex flex-col min-h-0 h-[65vh]">
        {ensureError ? (
          <div className="flex-1 flex items-center justify-center px-6 text-center text-sm text-red-500">
            {ensureError}
          </div>
        ) : resolving || isLoading || !conversation ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
            {resolving ? 'Abrindo conversa...' : 'Carregando conversa...'}
          </div>
        ) : (
          <>
            <MessageThread conversationId={conversation.id} />
            <MessageInput conversation={conversation} />
          </>
        )}
      </div>
    </Modal>
  );
}
