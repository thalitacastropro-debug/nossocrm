import { describe, it, expect } from 'vitest';
import { juntarPaginasEmOrdem } from './MessageThread';
import type { MessagingMessage } from '@/lib/messaging/types';

const msg = (id: string, createdAt: string, contentType = 'text'): MessagingMessage =>
  ({ id, createdAt, contentType }) as unknown as MessagingMessage;

// Como o backend pagina: página 0 = as MAIS RECENTES (já cronológicas dentro
// dela); cada página seguinte é um lote mais antigo.
const paginaRecente = {
  messages: [msg('julho-fim', '2026-07-10T20:58:00Z'), msg('ontem', '2026-08-24T17:14:00Z'), msg('audio-hoje', '2026-08-25T13:15:00Z')],
};
const paginaAntiga = {
  messages: [msg('julho-inicio', '2026-07-10T13:39:00Z'), msg('julho-meio', '2026-07-10T15:24:00Z')],
};

describe('juntarPaginasEmOrdem', () => {
  it('uma página só sai como veio', () => {
    const r = juntarPaginasEmOrdem([paginaRecente]);
    expect(r.map((m) => m.id)).toEqual(['julho-fim', 'ontem', 'audio-hoje']);
  });

  // O bug de 25/08: com duas páginas, o lote antigo ia para o FIM da lista e o
  // scroll automático (que vai para o fim) parava em julho. A mensagem de ontem
  // e o áudio de hoje ficavam perdidos no meio, e a conversa parecia parada.
  it('a mensagem mais recente termina no FIM, mesmo com várias páginas', () => {
    const r = juntarPaginasEmOrdem([paginaRecente, paginaAntiga]);

    expect(r[r.length - 1].id).toBe('audio-hoje');
    expect(r.map((m) => m.id)).toEqual(['julho-inicio', 'julho-meio', 'julho-fim', 'ontem', 'audio-hoje']);
  });

  it('a lista fica em ordem cronológica crescente', () => {
    const r = juntarPaginasEmOrdem([paginaRecente, paginaAntiga]);
    const tempos = r.map((m) => new Date(m.createdAt).getTime());

    expect(tempos).toEqual([...tempos].sort((a, b) => a - b));
  });

  it('não altera o array de páginas recebido', () => {
    const paginas = [paginaRecente, paginaAntiga];
    juntarPaginasEmOrdem(paginas);

    expect(paginas[0]).toBe(paginaRecente);
  });

  it('reação não vira bolha na thread', () => {
    const r = juntarPaginasEmOrdem([
      { messages: [msg('texto', '2026-08-25T10:00:00Z'), msg('curtida', '2026-08-25T10:01:00Z', 'reaction')] },
    ]);

    expect(r.map((m) => m.id)).toEqual(['texto']);
  });

  it('sem páginas, lista vazia', () => {
    expect(juntarPaginasEmOrdem(undefined)).toEqual([]);
  });
});
