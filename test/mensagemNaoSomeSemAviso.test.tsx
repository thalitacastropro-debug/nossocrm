import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * "A MENSAGEM SOME" (21/09/2026, Pedro tentando falar com a Camila Santos).
 *
 * O envio é otimista: o texto é limpo do campo e a bolha entra na tela ANTES da resposta do
 * servidor. Quando o envio falhava, o `onError` do hook removia a bolha do cache e ninguém
 * avisava — sumia a bolha E o texto que a pessoa tinha escrito, sem erro nenhum na tela.
 *
 * Estes testes travam as duas coisas que a falha precisa fazer: devolver o texto ao campo e
 * dizer o que aconteceu. Vale para texto e para template (o template falhava igualmente calado).
 */

const addToast = vi.fn();
const enviarTexto = vi.fn();
const enviarTemplate = vi.fn();

vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast, removeToast: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u-ped' } }) }));
vi.mock('@/lib/query/hooks/useMessagingMessagesQuery', () => ({
  useSendTextMessage: () => ({ mutate: enviarTexto }),
  useSendMessage: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/lib/query/hooks/useConversationsQuery', () => ({
  useAssignConversation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/lib/query/hooks/useMediaUploadMutation', () => ({
  useMediaUploadMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/query/hooks/useTemplatesQuery', () => ({
  useApprovedTemplatesQuery: () => ({ data: [{ id: 't-1', name: 'reabertura' }], isLoading: false }),
  useSendTemplateMutation: () => ({ mutate: enviarTemplate, isPending: false }),
}));
vi.mock('@/features/messaging/components/TemplateSelector', () => ({
  TemplateSelector: ({ onSelect }: { onSelect: (t: unknown) => void }) => (
    <button type="button" onClick={() => onSelect({ id: 't-1', name: 'reabertura' })}>
      escolher template
    </button>
  ),
}));

import { MessageInput } from '@/features/messaging/components/MessageInput';

const CONVERSA = {
  id: 'conv-camila',
  channelId: 'canal-1',
  assignedUserId: 'u-ped',
  isWindowExpired: false,
} as never;

describe('MessageInput — a falha de envio precisa aparecer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('texto: quando o envio falha, o texto volta ao campo e a pessoa é avisada', async () => {
    // O hook chama o onError de quem mandou — é assim que a bolha otimista é removida.
    enviarTexto.mockImplementation((_vars, opts) => opts?.onError?.(new Error('Failed to fetch')));

    render(<MessageInput conversation={CONVERSA} />);
    const campo = screen.getByLabelText('Digite uma mensagem');
    fireEvent.change(campo, { target: { value: 'oi Camila, tudo bem?' } });
    fireEvent.click(screen.getByLabelText('Enviar mensagem'));

    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(addToast.mock.calls[0][0]).toContain('não foi enviada');
    expect(addToast.mock.calls[0][0]).toContain('Failed to fetch');
    expect(addToast.mock.calls[0][1]).toBe('error');
    // Ninguém pode perder o que escreveu por causa de um erro nosso.
    expect((campo as HTMLTextAreaElement).value).toBe('oi Camila, tudo bem?');
  });

  it('texto: quando o envio dá certo, o campo esvazia e não há aviso de erro', async () => {
    enviarTexto.mockImplementation(() => {});

    render(<MessageInput conversation={CONVERSA} />);
    const campo = screen.getByLabelText('Digite uma mensagem');
    fireEvent.change(campo, { target: { value: 'oi Camila' } });
    fireEvent.click(screen.getByLabelText('Enviar mensagem'));

    await waitFor(() => expect((campo as HTMLTextAreaElement).value).toBe(''));
    expect(addToast).not.toHaveBeenCalled();
  });

  it('template: falha calada também vira aviso', async () => {
    enviarTemplate.mockImplementation((_vars, opts) => opts?.onError?.(new Error('janela fechada')));

    render(<MessageInput conversation={{ ...(CONVERSA as object), isWindowExpired: true } as never} />);
    fireEvent.click(screen.getByText('Enviar template'));
    fireEvent.click(screen.getByText('escolher template'));

    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(addToast.mock.calls[0][0]).toContain('template não foi enviado');
    expect(addToast.mock.calls[0][0]).toContain('janela fechada');
  });
});
