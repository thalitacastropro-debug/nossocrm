/**
 * O disparo individual do diário (02/09/2026).
 *
 * Os quatro modos de falha que estes testes existem para impedir, todos com
 * história no projeto:
 *  - mandar para quem não pediu;
 *  - mandar duas vezes (o briefing da Implantação morreu por falta de rastro, e
 *    alerta repetido é o que faz o time parar de ler);
 *  - a falha de um envio derrubar os outros — ou pior, derrubar o diário da dona;
 *  - mandar "você está em dia" todo dia para quem não tem nada.
 */
import { describe, it, expect, vi } from 'vitest';
import { enviarDiariosIndividuais, type PerfilDestino } from '@/lib/gestor/envioIndividual';
import type { Diario } from '@/lib/gestor/regras';

const PEDRO = 'u-ped';
const DENILSON = 'u-den';

const diario: Diario = {
  data: 'terça-feira, 02/09',
  ontem: { mensagensDeLead: 5, notasEscritas: 0, reunioesMarcadas: 0 },
  regras: [
    {
      id: 'sem-resposta',
      titulo: 'Falaram e ninguém respondeu',
      emoji: '🔴',
      acao: 'Responder no chat do CRM.',
      estoque: 23,
      estoquePorDono: { [PEDRO]: 21, [DENILSON]: 2 },
      novos: [
        { donoId: PEDRO, donoNome: 'Pedro Sellan', contato: 'Rose Meire', detalhe: '"os valores?"', idadeHoras: 19 },
        { donoId: DENILSON, donoNome: 'Denilson Silva', contato: 'Bruce Wilker', detalhe: '"me chama"', idadeHoras: 21 },
      ],
    },
  ],
};

const perfil = (id: string, over: Partial<PerfilDestino> = {}): PerfilDestino => ({
  id,
  role: id === DENILSON ? 'admin' : 'vendedor',
  telegram_chat_id: `chat-${id}`,
  nickname: id === DENILSON ? 'Denilson Silva' : 'Pedro Sellan',
  ...over,
});

/** Supabase de mentira: registra os inserts e deixa o teste falhar o que quiser. */
function bancoFalso(opts: { insertFalhaPara?: string[]; bancoForaDoAr?: boolean } = {}) {
  const inserts: Array<{ dia: string; profile_id: string; chat_id: string }> = [];
  const updates: Array<{ profile_id: string; erro: string }> = [];

  const supabase = {
    from(tabela: string) {
      if (tabela !== 'gestor_envios') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        insert(linha: { dia: string; profile_id: string; chat_id: string }) {
          if (opts.insertFalhaPara?.includes(linha.profile_id)) {
            // 23505 = unique_violation. O código PRECISA distinguir isto de um
            // erro de banco qualquer — ver o teste logo abaixo.
            return Promise.resolve({ error: { code: '23505', message: 'duplicate key value' } });
          }
          if (opts.bancoForaDoAr) {
            return Promise.resolve({ error: { code: '', message: 'fetch failed' } });
          }
          inserts.push(linha);
          return Promise.resolve({ error: null });
        },
        update(patch: { erro: string }) {
          const alvo = { profile_id: '', erro: patch.erro };
          const chain = {
            eq(coluna: string, valor: string) {
              if (coluna === 'profile_id') {
                alvo.profile_id = valor;
                updates.push(alvo);
              }
              return chain;
            },
            then(resolve: (v: unknown) => void) {
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return chain;
        },
      };
    },
  } as never;

  return { supabase, inserts, updates };
}

const ehGestor = (role: string | null | undefined) => role === 'admin';

describe('enviarDiariosIndividuais', () => {
  it('manda para quem ligou, com o texto de cada um', async () => {
    const { supabase } = bancoFalso();
    const enviar = vi.fn(async () => {});

    const r = await enviarDiariosIndividuais(
      { supabase, diario, dia: '2026-09-02', enviar, ehGestor },
      [perfil(PEDRO), perfil(DENILSON)],
    );

    expect(r.every((x) => x.enviado)).toBe(true);
    expect(enviar).toHaveBeenCalledTimes(2);

    const [chatPedro, textoPedro] = enviar.mock.calls[0] as unknown as [string, string];
    const [chatDen, textoDen] = enviar.mock.calls[1] as unknown as [string, string];

    expect(chatPedro).toBe('chat-u-ped');
    expect(textoPedro).toContain('Rose Meire');
    // O do Pedro NUNCA pode conter a visão da equipe.
    expect(textoPedro).not.toContain('Sua equipe');
    expect(textoPedro).not.toContain('Bruce Wilker');

    expect(chatDen).toBe('chat-u-den');
    expect(textoDen).toContain('Sua equipe');
    expect(textoDen).toContain('Rose Meire');
  });

  it('NÃO manda para quem não ligou o Telegram', async () => {
    const { supabase, inserts } = bancoFalso();
    const enviar = vi.fn(async () => {});

    const r = await enviarDiariosIndividuais(
      { supabase, diario, dia: '2026-09-02', enviar, ehGestor },
      [perfil(PEDRO, { telegram_chat_id: null })],
    );

    expect(enviar).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(r[0].motivo).toBe('sem-telegram');
  });

  it('chat_id em branco conta como não ligado', async () => {
    const { supabase } = bancoFalso();
    const enviar = vi.fn(async () => {});

    await enviarDiariosIndividuais({ supabase, diario, dia: '2026-09-02', enviar, ehGestor }, [
      perfil(PEDRO, { telegram_chat_id: '   ' }),
    ]);

    expect(enviar).not.toHaveBeenCalled();
  });

  it('não manda nada para quem não tem novidade nem acumulado', async () => {
    const { supabase } = bancoFalso();
    const enviar = vi.fn(async () => {});

    const r = await enviarDiariosIndividuais(
      { supabase, diario, dia: '2026-09-02', enviar, ehGestor },
      [perfil('u-ninguem', { role: 'vendedor', nickname: 'Fulano' })],
    );

    expect(enviar).not.toHaveBeenCalled();
    expect(r[0].motivo).toBe('nada-a-dizer');
  });

  it('a trava do banco impede o segundo envio no mesmo dia', async () => {
    // A rota é um GET com segredo: chamada manual ou retry repetiriam a manhã.
    const { supabase } = bancoFalso({ insertFalhaPara: [PEDRO] });
    const enviar = vi.fn(async () => {});

    const r = await enviarDiariosIndividuais(
      { supabase, diario, dia: '2026-09-02', enviar, ehGestor },
      [perfil(PEDRO), perfil(DENILSON)],
    );

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r[0].motivo).toBe('ja-enviado-hoje');
    expect(r[1].enviado).toBe(true);
  });

  // O modo de falha mais caro: o banco cai, ninguém recebe, e o relatório diz
  // que estava tudo certo porque leu o erro como "já mandei hoje".
  it('banco fora do ar NÃO é lido como "já enviado hoje"', async () => {
    const { supabase } = bancoFalso({ bancoForaDoAr: true });
    const enviar = vi.fn(async () => {});

    const r = await enviarDiariosIndividuais(
      { supabase, diario, dia: '2026-09-02', enviar, ehGestor },
      [perfil(PEDRO)],
    );

    expect(enviar).not.toHaveBeenCalled();
    expect(r[0].motivo).toBe('falhou');
    expect(r[0].erro).toContain('fetch failed');
  });

  it('grava a trava ANTES de enviar', async () => {
    const ordem: string[] = [];
    const inserts: string[] = [];
    const supabase = {
      from: () => ({
        insert: (l: { profile_id: string }) => {
          ordem.push('insert');
          inserts.push(l.profile_id);
          return Promise.resolve({ error: null });
        },
      }),
    } as never;

    await enviarDiariosIndividuais(
      {
        supabase,
        diario,
        dia: '2026-09-02',
        enviar: async () => {
          ordem.push('enviar');
        },
        ehGestor,
      },
      [perfil(PEDRO)],
    );

    expect(ordem).toEqual(['insert', 'enviar']);
  });

  it('falha de um não derruba o outro, e o erro fica gravado', async () => {
    const { supabase, updates } = bancoFalso();
    const enviar = vi.fn(async (chatId: string) => {
      if (chatId === 'chat-u-ped') throw new Error('Telegram respondeu 403');
    });

    const r = await enviarDiariosIndividuais(
      { supabase, diario, dia: '2026-09-02', enviar, ehGestor },
      [perfil(PEDRO), perfil(DENILSON)],
    );

    expect(r[0]).toMatchObject({ enviado: false, motivo: 'falhou' });
    expect(r[0].erro).toContain('403');
    expect(r[1].enviado).toBe(true);
    expect(updates).toEqual([{ profile_id: PEDRO, erro: 'Telegram respondeu 403' }]);
  });

  it('lista vazia não explode', async () => {
    const { supabase } = bancoFalso();
    await expect(
      enviarDiariosIndividuais({ supabase, diario, dia: '2026-09-02', enviar: async () => {}, ehGestor }, []),
    ).resolves.toEqual([]);
  });
});
