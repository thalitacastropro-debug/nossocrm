'use client';

import React, { useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { MessageThread } from '@/features/messaging/components/MessageThread';
import { MessageInput } from '@/features/messaging/components/MessageInput';
import { useConversation, useMarkConversationRead } from '@/lib/query/hooks/useConversationsQuery';

interface DealWhatsAppModalProps {
  /** null/undefined = modal fechado */
  conversationId: string | null | undefined;
  dealTitle: string;
  onClose: () => void;
}

/**
 * Conversa do WhatsApp do lead direto na board, sem sair pro Inbox nem abrir
 * o wa.me em outra guia. Reusa os mesmos componentes da página de Mensagens.
 */
export function DealWhatsAppModal({ conversationId, dealTitle, onClose }: DealWhatsAppModalProps) {
  const isOpen = Boolean(conversationId);
  const { data: conversation, isLoading } = useConversation(conversationId || undefined);
  const { mutate: markAsRead } = useMarkConversationRead();

  useEffect(() => {
    if (conversationId && conversation && conversation.unreadCount > 0) {
      markAsRead(conversationId);
    }
  }, [conversationId, conversation, markAsRead]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={conversation?.contactName || conversation?.externalContactName || dealTitle}
      size="lg"
      bodyClassName="p-0 flex-1 flex flex-col min-h-0"
    >
      <div className="flex-1 flex flex-col min-h-0 h-[65vh]">
        {isLoading || !conversation ? (
          <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
            Carregando conversa...
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
