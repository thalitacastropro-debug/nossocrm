import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Duble encadeavel de query: `.eq().eq()` resolve em qualquer ponto da cadeia.
 * A rota amarra a activity ao deal (`.eq('id', x).eq('deal_id', y)`) — sem isso,
 * um consultor mexia na reuniao de outro passando o id no proprio card.
 */
function cadeiaEq() {
  const chamadas: unknown[][] = [];
  const alvo: any = {
    chamadas,
    eq: (...args: unknown[]) => { chamadas.push(args); return alvo; },
    then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
  };
  return alvo;
}


const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

let dealRow: Record<string, unknown>;
let dealUpdateSpy: ReturnType<typeof vi.fn>;
let activityInsertSpy: ReturnType<typeof vi.fn>;
let activityUpdateSpy: ReturnType<typeof vi.fn>;
let voiceInsertSpy: ReturnType<typeof vi.fn>;
let supabaseClientMock: Record<string, unknown>;
let adminMock: Record<string, unknown>;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({ createStaticAdminClient: vi.fn(() => adminMock) }));
vi.mock('@/lib/supabase/dealFilesServer', async () => {
  const real = await vi.importActual<typeof import('@/lib/supabase/dealFilesServer')>('@/lib/supabase/dealFilesServer');
  return {
    pathDeGravacaoDoDeal: real.pathDeGravacaoDoDeal,
    resolverGravacao: vi.fn(async () => ({ error: null })),
    substituirTentativasAnteriores: vi.fn(async () => undefined),
  };
});

import { POST } from '@/app/api/deals/[dealId]/call-outcome/apply/route';
import * as files from '@/lib/supabase/dealFilesServer';

function auth(userId: string | null = USER_ID) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) } };
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    audioFilePath: `${DEAL_ID}/voice/a.webm`,
    transcricao: 'fechei com a Valéria',
    desfecho: {
      desfecho: 'fechou', nota_resumo: 'Fechou 3 vidas Amil',
      tarefas: [{ descricao: 'Enviar contrato', data: null }],
      dados_negocio: { operadora: 'Amil', vidas: 3, valor: 2100 },
      objecoes: [], motivo_perda: null, motivo_perda_detalhe: null, reabordar_em: null, confidence: 0.9,
    },
    ...overrides,
  };
}

/** Leitura de uma linha só: `.select().eq().maybeSingle()`. */
function leituraSimples(row: Record<string, unknown>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
}

function makeDealsBuilder() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({ data: dealRow, error: null })),
    update: dealUpdateSpy,
  };
}

async function callPost(body: unknown, dealId = DEAL_ID): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/call-outcome/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('POST /api/deals/[dealId]/call-outcome/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `contact_id` presente porque este é um desfecho de CALL: alguém foi ligado, então existe
    // contato. O lembrete de reabordagem depende disso (ver `deveCriarLembrete`).
    dealRow = { id: DEAL_ID, organization_id: ORG_ID, owner_id: USER_ID, board_id: 'efbaa84e-cf4b-4465-8b50-41afd612088e', stage_id: 's1', value: 0, contact_id: 'contato-1', custom_fields: { tier: { valor: 'prata' }, qualificacao: { vidas: 2 } } };
    dealUpdateSpy = vi.fn(() => cadeiaEq());
    activityInsertSpy = vi.fn(async () => ({ error: null }));
    activityUpdateSpy = vi.fn(() => cadeiaEq());
    voiceInsertSpy = vi.fn(async () => ({ error: null }));
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => {
        if (t === 'deals') return makeDealsBuilder();
        // Lidos só no desfecho "fechou", para montar o carimbo da venda (quem vendeu, de qual
        // funil/etapa saiu). Sem o carimbo a venda não entra na meta do mês.
        if (t === 'profiles') return leituraSimples({ name: 'Pedro Sellan', nickname: null });
        if (t === 'boards') return leituraSimples({ name: 'Comercial — Consultor' });
        if (t === 'board_stages') return leituraSimples({ label: 'Negociação', name: 'negociacao' });
        throw new Error('unexpected ' + t);
      }),
    };
    adminMock = {
      from: vi.fn((t: string) => {
        if (t === 'activities') return { insert: activityInsertSpy, update: activityUpdateSpy };
        if (t === 'voice_calls') return { insert: voiceInsertSpy };
        throw new Error('unexpected admin ' + t);
      }),
    };
  });

  it('401 sem usuário', async () => {
    supabaseClientMock = { ...auth(null), from: vi.fn() };
    expect((await callPost(baseBody())).status).toBe(401);
  });

  it('400 quando o desfecho é inválido', async () => {
    expect((await callPost({ ...baseBody(), desfecho: { desfecho: 'talvez' } })).status).toBe(400);
  });

  it('grava nota + tarefa + voice_calls e responde 200', async () => {
    const res = await callPost(baseBody());
    expect(res.status).toBe(200);
    expect(activityInsertSpy).toHaveBeenCalledTimes(2); // 1 NOTE + 1 TASK
    const types = activityInsertSpy.mock.calls.map((c) => (c[0] as { type: string }).type).sort();
    expect(types).toEqual(['NOTE', 'TASK']);
    expect(voiceInsertSpy).toHaveBeenCalledOnce();
    // Shape do voice_calls: colunas com CHECK constraint no banco — um typo
    // aqui passa no unit e explode em prod (23514), silencioso (best-effort).
    const vc = voiceInsertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(vc).toMatchObject({
      organization_id: ORG_ID,
      deal_id: DEAL_ID,
      mode: 'human_call',
      status: 'completed',
      channel: 'phone',
      direction: 'outbound',
    });
    expect((vc.analysis as { desfecho: string }).desfecho).toBe('fechou');
    expect((vc.metadata as { audio_path: string }).audio_path).toContain('/voice/');
  });

  it('N tarefas → 1 NOTE + N TASKs, com data da tarefa ou enviado_em', async () => {
    const res = await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        tarefas: [
          { descricao: 'Enviar contrato', data: '2026-07-15T13:00:00.000Z' },
          { descricao: 'Cobrar documentos', data: null },
          { descricao: 'Ligar sexta', data: '2026-07-17T14:00:00.000Z' },
        ],
      },
    }));
    expect(res.status).toBe(200);
    expect(activityInsertSpy).toHaveBeenCalledTimes(4);
    const rows = activityInsertSpy.mock.calls.map((c) => c[0] as { type: string; date: string; title: string });
    expect(rows.filter((r) => r.type === 'TASK')).toHaveLength(3);
    expect(rows.find((r) => r.title === 'Enviar contrato')?.date).toBe('2026-07-15T13:00:00.000Z');
    expect(rows.find((r) => r.title === 'Ligar sexta')?.date).toBe('2026-07-17T14:00:00.000Z');
    // tarefa sem data cai no enviado_em (timestamp do request, não null)
    expect(rows.find((r) => r.title === 'Cobrar documentos')?.date).toBeTruthy();
  });

  it('perdeu → grava motivo_perda estruturado + loss_reason (detalhe)', async () => {
    const res = await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'concorrente', motivo_perda_detalhe: 'foi pro concorrente',
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    expect(res.status).toBe(200);
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect((arg.custom_fields as Record<string, unknown>).motivo_perda).toEqual({ categoria: 'concorrente', detalhe: 'foi pro concorrente' });
    expect(arg.loss_reason).toBe('foi pro concorrente');
    expect(arg.value).toBeUndefined(); // value só no fechou
  });

  it('perdeu sem detalhe → loss_reason cai no rótulo da categoria', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'carencia', motivo_perda_detalhe: null,
      },
    }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.loss_reason).toBe('Carência');
  });

  it('converte objecoes legadas string[] e acrescenta as do consultor', async () => {
    dealRow = { ...dealRow, custom_fields: { ...(dealRow.custom_fields as object), objecoes: ['achou caro'] } };
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        objecoes: ['carencia'],
      },
    }));
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    expect(cf.objecoes).toEqual([
      { categoria: 'outro', detalhe: 'achou caro', origem: 'ana' },
      { categoria: 'carencia', detalhe: null, origem: 'consultor' },
    ]);
  });

  it('NÃO apaga custom_fields existentes (spread) e faz merge de qualificacao', async () => {
    await callPost(baseBody());
    const updateArg = dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown>; value?: number };
    expect(updateArg.custom_fields).toHaveProperty('tier');
    const qual = updateArg.custom_fields.qualificacao as Record<string, unknown>;
    expect(qual.operadora).toBe('Amil');
    expect(qual.vidas).toBe(3);
    // `deals.value` NÃO recebe o valor da venda (era `toBe(2100)` até 10/09/2026).
    //
    // Aqui `value` é a mensalidade do plano ANTIGO do lead — o gatilho da conversa. O valor dito
    // num desfecho "fechou" é o do plano COMPRADO, e ele agora tem lugar próprio:
    // `venda.premio_mensal`. Escrever os dois no mesmo campo apagava a qualificação e inflava o
    // "valor em jogo" do funil com receita já ganha. Ver lib/deals/premioFechado.ts.
    expect(updateArg.value).toBeUndefined();
    expect(qual.valor_pago_exato).toBeUndefined();
  });

  it('fechou → carimba a venda COM o prêmio (senão a venda é invisível na meta)', async () => {
    await callPost(baseBody());
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    const venda = cf.venda as Record<string, unknown>;
    expect(venda).toBeTruthy();
    expect(venda.premio_mensal).toBe(2100);
    expect(venda.operadora).toBe('Amil');
    expect(venda.vendedor_id).toBe(USER_ID);
    expect(venda.vendido_em).toBeTruthy();
    // O funil de ORIGEM, não o destino: é de onde a venda saiu.
    expect(venda.funil_da_venda).toBe('Comercial — Consultor');
  });

  it('fechou sem dizer o valor → carimbo existe, prêmio fica pendente (não vira 0)', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        dados_negocio: { operadora: 'Amil', vidas: 3, valor: null },
      },
    }));
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    const venda = cf.venda as Record<string, unknown>;
    expect(venda).toBeTruthy();
    expect(venda.premio_mensal).toBeUndefined();
  });

  it('desfecho que NÃO é fechou não carimba venda nenhuma', async () => {
    await callPost(baseBody({
      desfecho: { ...(baseBody().desfecho as Record<string, unknown>), desfecho: 'vai_pensar' },
    }));
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    expect(cf.venda).toBeUndefined();
    // ...e aí o valor dito É a mensalidade atual do lead.
    expect((cf.qualificacao as Record<string, unknown>).valor_pago_exato).toBe(2100);
  });

  // REGRA (Thalita, 05/10/2026): "cada funil tem o seu ganho. Enquanto o cliente não pagar o
  // primeiro boleto, a implantação não é dada como ganha."
  //
  // Este teste afirmava o CONTRÁRIO (is_won = true ao chegar na Implantação), e foi esse
  // comportamento que escondeu a venda da Flavia Almeida em 05/10: o kanban nasce filtrando
  // "Em Aberto", então o card fechado some do funil de destino — e já tinha saído do de
  // origem. Vender é o ganho do Comercial; implantar é o ganho da Implantação.
  //
  // A venda NÃO se perde: vive em `custom_fields.venda`, que é de onde a receita é medida
  // (ver reference_crm_venda_mora_no_carimbo).
  it('fechou → move pra Implantação/aguardando-doc EM ABERTO (ganho do Comercial ≠ ganho da Implantação)', async () => {
    await callPost(baseBody());
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.board_id).toBe('851c641a-ac99-404e-83d7-9712425b5fdf');
    expect(arg.stage_id).toBe('53589d9d-d0a5-4f62-8cda-20c89828a2b3');
    expect(arg.is_won).toBe(false);
    expect(arg.is_lost).toBe(false);
    expect(arg.closed_at).toBeNull();
    expect(arg.last_stage_change_date).toBeTruthy();
    // o ganho do Comercial não sumiu — mudou de lugar
    expect((arg.custom_fields as Record<string, unknown>).venda).toBeTruthy();
  });

  // O BURACO DA PRIMEIRA VERSÃO (07/10): a regra perguntava se o card MUDA de funil. Quando ele
  // JÁ ESTAVA no destino não havia mudança, e o ganho era marcado do mesmo jeito — o card do
  // ROBSON CARLOS ALVES sumiu assim em 06/10, um dia depois do conserto da Flavia subir: ele já
  // estava na Implantação, o Pedro mandou plano novo e gravou o desfecho ali mesmo.
  // A pergunta certa é ONDE O CARD TERMINA, não se ele se move.
  it('fechou com o card JÁ na Implantação → continua em aberto (não marca ganho de novo)', async () => {
    dealRow = { ...dealRow, board_id: '851c641a-ac99-404e-83d7-9712425b5fdf' };
    await callPost(baseBody());
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.is_won).toBe(false);
    expect(arg.closed_at).toBeNull();
  });

  // A reunião realizada tem de ser carimbada ANTES do update que move/fecha o deal:
  // `zz_cancela_compromisso_vencido_trg` dispara em `after update of is_won, is_lost` e
  // cancela compromisso vencido e não concluído — que é exatamente a reunião que acabou de
  // acontecer. Na ordem inversa ela sumiria da timeline e da taxa de comparecimento.
  it('conclui a CALL agendada ANTES de atualizar o deal (fora do alcance do trigger de limpeza)', async () => {
    dealRow = {
      ...dealRow,
      custom_fields: {
        ...(dealRow.custom_fields as object),
        reuniao_agendada: { activity_id: 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8' },
      },
    };
    await callPost(baseBody());
    expect(activityUpdateSpy).toHaveBeenCalled();
    expect(activityUpdateSpy.mock.invocationCallOrder[0])
      .toBeLessThan(dealUpdateSpy.mock.invocationCallOrder[0]);
  });

  it('perdeu → move pra Nutrição/recontato com is_lost + TASK de reabordagem', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'concorrente', motivo_perda_detalhe: 'foi pra Amil',
        reabordar_em: '2027-07-12T12:00:00.000Z',
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.board_id).toBe('4fb31290-2ab4-46ac-83b1-555fbd4908cc');
    expect(arg.stage_id).toBe('2ee5e57e-e616-45e0-8e46-34741f64ef14');
    expect(arg.is_lost).toBe(true);
    expect(arg.is_won).toBe(false);
    // lembrete de reabordagem = TASK com a data sugerida pela IA
    const dates = activityInsertSpy.mock.calls.map((c) => (c[0] as { date: string }).date);
    expect(dates).toContain('2027-07-12T12:00:00.000Z');
  });

  it('perdeu SEM reabordar_em → TASK de reabordagem cai no fallback por motivo', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'decisor', motivo_perda_detalhe: null, reabordar_em: null,
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const tasks = activityInsertSpy.mock.calls
      .map((c) => c[0] as { type: string; title: string; date: string })
      .filter((a) => a.type === 'TASK' && /reabordar/i.test(a.title));
    expect(tasks).toHaveLength(1);
    // decisor = +2 semanas do enviado_em (não nula, no futuro)
    expect(new Date(tasks[0].date).getTime()).toBeGreaterThan(Date.now());
  });

  // Este caminho criava lembrete para QUALQUER desfecho "perdeu", sem olhar o motivo — então um
  // lead marcado como `engano` por áudio ganhava a tarefa que o mesmo lead, descartado pelo
  // kanban, não ganhava. E ninguém checava se havia a quem ligar.
  it('engano NÃO gera lembrete, mesmo pelo áudio (alinha com o kanban)', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'engano', motivo_perda_detalhe: null, reabordar_em: null,
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const tasks = activityInsertSpy.mock.calls
      .map((c) => c[0] as { type: string; title: string })
      .filter((a) => a.type === 'TASK' && /reabordar/i.test(a.title));
    expect(tasks).toHaveLength(0);
  });

  it('deal SEM contato não gera lembrete (não há a quem ligar)', async () => {
    dealRow = { ...dealRow, contact_id: null };
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'perdeu', motivo_perda: 'concorrente', motivo_perda_detalhe: null, reabordar_em: null,
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const tasks = activityInsertSpy.mock.calls
      .map((c) => c[0] as { type: string; title: string })
      .filter((a) => a.type === 'TASK' && /reabordar/i.test(a.title));
    expect(tasks).toHaveLength(0);
  });

  // O board passou a ser ESCRITO (antes ficava undefined = "mesmo board"). A etapa Negociação é
  // do Comercial: se o card estiver em outro funil, board antigo + etapa do Comercial é card
  // órfão, e o trigger `zz_stage_pertence_ao_board` derruba o desfecho inteiro. Escrever os dois
  // juntos é o que o próprio trigger pede ("Ao mover de funil, atualize board_id e stage_id
  // juntos"). Como aqui o card já está no Comercial, não há mudança de funil e as flags de
  // ganho/perda continuam intocadas.
  it('vai_pensar → Negociação com board explícito, sem mexer nas flags', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'vai_pensar',
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.stage_id).toBe('86179ae9-1d6f-40ca-aaab-9ed7f320a3cc');
    expect(arg.board_id).toBe('efbaa84e-cf4b-4465-8b50-41afd612088e');
    expect(arg.is_won).toBeUndefined();
    expect(arg.is_lost).toBeUndefined();
  });

  it('remarcar → não move de board nem etapa', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'remarcar',
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const arg = dealUpdateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.board_id).toBeUndefined();
    expect(arg.stage_id).toBeUndefined();
    expect(arg.is_won).toBeUndefined();
    expect(arg.is_lost).toBeUndefined();
  });

  it('fechou → auto-marca reuniao_realizada + completa a CALL agendada', async () => {
    dealRow = { ...dealRow, custom_fields: { ...(dealRow.custom_fields as object), reuniao_agendada: { activity_id: 'e5f6a7b8-c9d0-4e1f-8a2b-c3d4e5f6a7b8' } } };
    await callPost(baseBody());
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    expect((cf.reuniao_realizada as { realizada: boolean }).realizada).toBe(true);
    expect(activityUpdateSpy).toHaveBeenCalledWith({ completed: true });
  });

  it('remarcar/nao_atendeu → NÃO marca reuniao_realizada', async () => {
    await callPost(baseBody({
      desfecho: {
        ...(baseBody().desfecho as Record<string, unknown>),
        desfecho: 'remarcar',
        dados_negocio: { operadora: null, vidas: null, valor: null },
      },
    }));
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    expect(cf.reuniao_realizada).toBeUndefined();
    expect(activityUpdateSpy).not.toHaveBeenCalled();
  });

  // A idempotência é por GRAVAÇÃO, não por card. Este teste afirmava o contrário — bastava
  // existir um desfecho anterior para a rota recusar — e foi essa regra que engoliu, em
  // silêncio, as duas gravações do Pedro na reunião com a Marilin Oliveira em 09/10 (o card
  // tinha desfecho do dia anterior). Eram 23 cards nesse estado, 20 deles abertos.
  it('duplo clique: MESMA gravação já aplicada → 200 sem regravar', async () => {
    dealRow = {
      ...dealRow,
      custom_fields: {
        ...(dealRow.custom_fields as object),
        call_outcome_applied_at: '2026-07-12T00:00:00Z',
        call_outcome_last_audio: `${DEAL_ID}/voice/a.webm`,
      },
    };
    const res = await callPost(baseBody());
    expect(res.status).toBe(200);
    expect(activityInsertSpy).not.toHaveBeenCalled();
    expect(dealUpdateSpy).not.toHaveBeenCalled();
    // ...mas a linha do arquivo é re-marcada: se a 1ª aplicação gravou o card e não a linha, a
    // gravação ficaria pendurada no card como "sem desfecho" de algo que já foi aplicado.
    expect(files.resolverGravacao).toHaveBeenCalledWith(DEAL_ID, `${DEAL_ID}/voice/a.webm`, 'aplicado');
  });

  // Par do `pendente` que o upload carimba (caso Alan Ferreira, 08/10): sem isto, toda gravação
  // aplicada continuaria aparecendo no card como trabalho perdido.
  it('aplicou com áudio → a gravação sai das pendentes, e as tentativas anteriores também', async () => {
    const res = await callPost(baseBody());
    expect(res.status).toBe(200);
    const path = `${DEAL_ID}/voice/a.webm`;
    expect(files.resolverGravacao).toHaveBeenCalledWith(DEAL_ID, path, 'aplicado', expect.any(String));
    expect(files.substituirTentativasAnteriores).toHaveBeenCalledWith(DEAL_ID, path, expect.any(String));
  });

  it('o update do deal falhou → a gravação CONTINUA pendente (dá para retomar)', async () => {
    dealUpdateSpy.mockReturnValue({ eq: vi.fn(async () => ({ error: { code: 'XX000', message: 'boom' } })) });
    expect((await callPost(baseBody())).status).toBe(500);
    expect(files.resolverGravacao).not.toHaveBeenCalled();
  });

  it('desfecho manual (sem áudio) não mexe em gravação nenhuma', async () => {
    const { audioFilePath: _semAudio, transcricao: _semTexto, ...manual } = baseBody();
    expect((await callPost(manual)).status).toBe(200);
    expect(files.resolverGravacao).not.toHaveBeenCalled();
    expect(files.substituirTentativasAnteriores).not.toHaveBeenCalled();
  });

  it('path de OUTRO card no body não marca gravação nenhuma', async () => {
    const outro = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';
    expect((await callPost(baseBody({ audioFilePath: `${outro}/voice/z.mp3` }))).status).toBe(200);
    expect(files.resolverGravacao).not.toHaveBeenCalled();
  });

  it('SEGUNDA REUNIÃO: card com desfecho antigo aceita gravação nova', async () => {
    dealRow = {
      ...dealRow,
      custom_fields: {
        ...(dealRow.custom_fields as object),
        call_outcome_applied_at: '2026-10-08T19:46:07Z',
        call_outcome_last_audio: `${DEAL_ID}/voice/ONTEM.webm`,
      },
    };
    const res = await callPost(baseBody({ audioFilePath: `${DEAL_ID}/voice/HOJE.webm` }));
    expect(res.status).toBe(200);
    expect(dealUpdateSpy).toHaveBeenCalled();
    // e o carimbo passa a apontar para a gravação de hoje
    const cf = (dealUpdateSpy.mock.calls[0][0] as { custom_fields: Record<string, unknown> }).custom_fields;
    expect(cf.call_outcome_last_audio).toBe(`${DEAL_ID}/voice/HOJE.webm`);
  });

  it('desfecho MANUAL (sem áudio): recusa só dentro da janela de 2 min', async () => {
    const agoraMenos30s = new Date(Date.now() - 30 * 1000).toISOString();
    dealRow = {
      ...dealRow,
      custom_fields: { ...(dealRow.custom_fields as object), call_outcome_applied_at: agoraMenos30s },
    };
    const res = await callPost(baseBody({ audioFilePath: undefined }));
    expect(res.status).toBe(200);
    expect(dealUpdateSpy).not.toHaveBeenCalled();
  });

  it('desfecho MANUAL antigo: passado o prazo, aceita de novo', async () => {
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    dealRow = {
      ...dealRow,
      custom_fields: { ...(dealRow.custom_fields as object), call_outcome_applied_at: ontem },
    };
    await callPost(baseBody({ audioFilePath: undefined }));
    expect(dealUpdateSpy).toHaveBeenCalled();
  });

  it('23505 no update → 409', async () => {
    dealUpdateSpy.mockReturnValue({ eq: vi.fn(async () => ({ error: { code: '23505' } })) });
    expect((await callPost(baseBody())).status).toBe(409);
  });
});
