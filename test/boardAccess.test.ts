import { describe, it, expect, vi, beforeEach } from 'vitest';

// O serviço lê o client do barrel interno; o mock precisa estar no lugar antes do import.
const selectEq = vi.fn();
const insert = vi.fn();
const deleteIn = vi.fn();
const deleteEq = vi.fn(() => ({ in: deleteIn }));
const del = vi.fn(() => ({ eq: deleteEq }));

const from = vi.fn(() => ({
  select: vi.fn(() => ({ eq: selectEq })),
  insert,
  delete: del,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (...args: unknown[]) => (from as any)(...args),
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
  },
}));

const { boardAccessService } = await import('@/lib/supabase/boardAccess');

const PEDRO = 'user-pedro';
const COMERCIAL = 'board-comercial';
const NUTRICAO = 'board-nutricao';
const SDR = 'board-sdr';

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockResolvedValue({ error: null });
  deleteIn.mockResolvedValue({ error: null });
});

describe('boardAccessService.setForUser', () => {
  it('concede só o funil que falta e não mexe no que já estava liberado', async () => {
    selectEq.mockResolvedValue({ data: [{ board_id: COMERCIAL }], error: null });

    const { error } = await boardAccessService.setForUser(PEDRO, [COMERCIAL, NUTRICAO]);

    expect(error).toBeNull();
    expect(insert).toHaveBeenCalledWith([
      { board_id: NUTRICAO, user_id: PEDRO, granted_by: 'admin-1' },
    ]);
    expect(del).not.toHaveBeenCalled();
  });

  it('revoga só o funil que saiu da lista', async () => {
    selectEq.mockResolvedValue({ data: [{ board_id: COMERCIAL }, { board_id: SDR }], error: null });

    await boardAccessService.setForUser(PEDRO, [COMERCIAL]);

    expect(insert).not.toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith('user_id', PEDRO);
    expect(deleteIn).toHaveBeenCalledWith('board_id', [SDR]);
  });

  it('não escreve nada quando o conjunto já é o desejado', async () => {
    selectEq.mockResolvedValue({ data: [{ board_id: COMERCIAL }], error: null });

    await boardAccessService.setForUser(PEDRO, [COMERCIAL]);

    expect(insert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  // O modo de falha que importa: se a concessão falhar e a revogação rodar mesmo
  // assim, a pessoa termina sem funil nenhum — CRM vazio no meio do expediente.
  it('não revoga nada se a concessão falhar', async () => {
    selectEq.mockResolvedValue({ data: [{ board_id: SDR }], error: null });
    insert.mockResolvedValue({ error: new Error('boom') });

    const { error } = await boardAccessService.setForUser(PEDRO, [COMERCIAL]);

    expect(error).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
  });

  it('propaga erro de leitura sem escrever nada', async () => {
    selectEq.mockResolvedValue({ data: null, error: new Error('sem permissão') });

    const { error } = await boardAccessService.setForUser(PEDRO, [COMERCIAL]);

    expect(error).toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('primeira concessão de quem não tinha funil nenhum', async () => {
    selectEq.mockResolvedValue({ data: [], error: null });

    await boardAccessService.setForUser(PEDRO, [COMERCIAL]);

    expect(insert).toHaveBeenCalledWith([
      { board_id: COMERCIAL, user_id: PEDRO, granted_by: 'admin-1' },
    ]);
  });
});
