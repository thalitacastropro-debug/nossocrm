/**
 * @fileoverview Serviço Supabase (client-side, RLS) para lookups leves de
 * messaging_conversations a partir do board — não duplica o CRUD completo
 * que já existe em app/api/messaging/conversations (usado pela página de Inbox).
 *
 * @module lib/supabase/conversations
 */

import { supabase } from './client';

export interface ConversationSummary {
  id: string;
  contactId: string;
  unreadCount: number;
  lastMessageAt: string | null;
}

export const conversationsService = {
  /**
   * Busca a conversa mais recente por contato (1 por `contactId`), para
   * alimentar o botão de WhatsApp do card do Kanban (conversationId + unread).
   * Se um contato tiver mais de uma conversa (múltiplos canais), fica com a
   * de `last_message_at` mais recente.
   */
  async getLatestByContactIds(
    contactIds: string[],
    options?: { signal?: AbortSignal }
  ): Promise<{ data: Map<string, ConversationSummary>; error: Error | null }> {
    if (!supabase) {
      return { data: new Map(), error: new Error('Supabase não configurado') };
    }
    const uniqueIds = [...new Set(contactIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return { data: new Map(), error: null };
    }

    let query = supabase
      .from('messaging_conversations')
      .select('id, contact_id, unread_count, last_message_at')
      .in('contact_id', uniqueIds)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (options?.signal) query = query.abortSignal(options.signal);

    const { data, error } = await query;
    if (error) return { data: new Map(), error };

    const byContact = new Map<string, ConversationSummary>();
    for (const row of data || []) {
      const contactId = row.contact_id as string | null;
      if (!contactId || byContact.has(contactId)) continue; // já pegou a mais recente (ordenado)
      byContact.set(contactId, {
        id: row.id as string,
        contactId,
        unreadCount: (row.unread_count as number | null) ?? 0,
        lastMessageAt: (row.last_message_at as string | null) ?? null,
      });
    }
    return { data: byContact, error: null };
  },
};
