import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ORG_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6';
const DEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-a1b2c3d4e5f6';

let profileQB: Record<string, unknown>;
let dealQB: Record<string, unknown>;
let supabaseClientMock: Record<string, unknown>;
let aiConfig: unknown;

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabaseClientMock) }));
vi.mock('@/lib/ai/agent/agent.service', () => ({ getOrgAIConfig: vi.fn(async () => aiConfig) }));
vi.mock('@/lib/ai/call-outcome/transcribe', () => ({ transcribeAudio: vi.fn(async () => 'texto transcrito') }));
vi.mock('@/lib/ai/call-outcome/call-outcome.service', () => ({
  extractCallOutcome: vi.fn(async () => ({
    desfecho: {
      desfecho: 'fechou', nota_resumo: 'ok', tarefas: [],
      dados_negocio: { operadora: null, vidas: null, valor: null },
      objecoes: [], motivo_perda: null, motivo_perda_detalhe: null, reabordar_em: null, confidence: 0.8,
    },
    tokens: 10,
  })),
}));
vi.mock('@/lib/supabase/dealFilesServer', async () => {
  // pathDeGravacaoDoDeal é a trava de segurança do retomar — usa a implementação REAL.
  const real = await vi.importActual<typeof import('@/lib/supabase/dealFilesServer')>('@/lib/supabase/dealFilesServer');
  return {
    pathDeGravacaoDoDeal: real.pathDeGravacaoDoDeal,
    uploadDealAudioServer: vi.fn(async () => ({ filePath: `${DEAL_ID}/voice/x.webm`, error: null })),
    gravacoesPendentes: vi.fn(async () => []),
    lerGravacao: vi.fn(async () => null),
    baixarAudioDoDeal: vi.fn(async () => Buffer.from([1, 2, 3])),
    registrarTranscricao: vi.fn(async () => undefined),
    registrarFalhaDesfecho: vi.fn(async () => undefined),
    getDealAudioSignedUrl: vi.fn(async (p: string) => `https://signed/${p}`),
  };
});

import { POST, GET } from '@/app/api/deals/[dealId]/call-outcome/route';
import * as files from '@/lib/supabase/dealFilesServer';
import { transcribeAudio } from '@/lib/ai/call-outcome/transcribe';
import { extractCallOutcome } from '@/lib/ai/call-outcome/call-outcome.service';

function buildProfileQB(orgId: string | null = ORG_ID) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: orgId ? { organization_id: orgId } : null, error: null })),
  };
}
function buildDealQB(found = true) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({
      data: found ? { id: DEAL_ID, organization_id: ORG_ID } : null,
      error: found ? null : { message: 'not found' },
    })),
  };
}
function auth(userId: string | null = USER_ID) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) } };
}
async function callPost(dealId = DEAL_ID, hasFile = true): Promise<Response> {
  const form = new FormData();
  if (hasFile) form.set('audio', new File([new Uint8Array([1, 2, 3])], 'a.webm', { type: 'audio/webm' }));
  const req = new Request(`http://localhost/api/deals/${dealId}/call-outcome`, { method: 'POST', body: form });
  return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
}

describe('POST /api/deals/[dealId]/call-outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileQB = buildProfileQB();
    dealQB = buildDealQB();
    aiConfig = { structuredApiKey: 'gkey', structuredModel: 'gemini-2.5-flash-lite' };
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => {
        if (t === 'profiles') return profileQB;
        if (t === 'deals') return dealQB;
        throw new Error('unexpected ' + t);
      }),
    };
  });

  it('401 sem usuário', async () => {
    supabaseClientMock = { ...auth(null), from: vi.fn() };
    expect((await callPost()).status).toBe(401);
  });

  it('400 quando dealId inválido', async () => {
    expect((await callPost('nao-uuid')).status).toBe(400);
  });

  it('400 sem arquivo de áudio', async () => {
    expect((await callPost(DEAL_ID, false)).status).toBe(400);
  });

  it('404 quando o deal não é visível pela RLS (cross-org) — SEM upload', async () => {
    dealQB = buildDealQB(false);
    const { uploadDealAudioServer } = await import('@/lib/supabase/dealFilesServer');
    const res = await callPost();
    expect(res.status).toBe(404);
    expect(uploadDealAudioServer).not.toHaveBeenCalled();
  });

  it('422 quando a org não tem chave Google (structuredApiKey vazio)', async () => {
    aiConfig = { structuredApiKey: '', structuredModel: 'm' };
    expect((await callPost()).status).toBe(422);
  });

  it('200 devolve transcrição + desfecho + audioFilePath', async () => {
    const res = await callPost();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transcricao).toBe('texto transcrito');
    expect(body.desfecho.desfecho).toBe('fechou');
    expect(body.audioFilePath).toContain('/voice/');
  });
});

/**
 * GRAVAÇÃO QUE NÃO VIRA DESFECHO (09/10/2026, caso Alan Ferreira).
 *
 * O áudio sobe ANTES da transcrição. Antes deste conserto, qualquer falha depois do upload deixava
 * o arquivo no storage e nada registrava que aquela reunião ficou sem desfecho — e o log da Vercel
 * some em 1 hora. Estes testes cobrem os caminhos em que a gravação NÃO pode sumir calada.
 */
describe('call-outcome — a gravação não some quando algo falha depois do upload', () => {
  const PATH = `${DEAL_ID}/voice/x.webm`;

  beforeEach(() => {
    vi.clearAllMocks();
    aiConfig = { structuredApiKey: 'gkey', structuredModel: 'gemini-2.5-flash-lite' };
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => {
        if (t === 'profiles') return buildProfileQB();
        if (t === 'deals') return buildDealQB();
        throw new Error('unexpected ' + t);
      }),
    };
  });

  async function retomar(audioFilePath: unknown, dealId = DEAL_ID): Promise<Response> {
    const req = new Request(`http://localhost/api/deals/${dealId}/call-outcome`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioFilePath }),
    });
    return POST(req as never, { params: Promise.resolve({ dealId }) } as never);
  }

  it('transcrição falha → 502 COM o path, e o motivo fica gravado na gravação', async () => {
    vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('503 model overloaded'));
    const res = await callPost();
    expect(res.status).toBe(502);
    expect((await res.json()).audioFilePath).toBe(PATH);
    expect(files.registrarFalhaDesfecho).toHaveBeenCalledWith(DEAL_ID, PATH, 'Transcrição falhou: 503 model overloaded');
  });

  it('leitura do desfecho falha → a transcrição que deu certo FICA guardada', async () => {
    vi.mocked(extractCallOutcome).mockRejectedValueOnce(new Error('schema invalido'));
    const res = await callPost();
    expect(res.status).toBe(502);
    expect(files.registrarTranscricao).toHaveBeenCalledWith(DEAL_ID, PATH, 'texto transcrito');
    expect(files.registrarFalhaDesfecho).toHaveBeenCalledWith(DEAL_ID, PATH, 'Leitura do desfecho falhou: schema invalido');
  });

  it('upload falha → 500 dizendo que o áudio NÃO foi salvo (é o caso de reenviar)', async () => {
    vi.mocked(files.uploadDealAudioServer).mockResolvedValueOnce({ filePath: null, error: new Error('bucket') });
    const res = await callPost();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/não foi salvo/);
    expect(body.audioFilePath).toBeUndefined();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it('retomar: path de OUTRO card → 400, sem baixar nada', async () => {
    const outro = 'd4e5f6a7-b8c9-4d0e-8f1a-b2c3d4e5f6a7';
    expect((await retomar(`${outro}/voice/y.mp3`)).status).toBe(400);
    expect((await retomar(`${DEAL_ID}/voice/../../${outro}/voice/y.mp3`)).status).toBe(400);
    expect(files.baixarAudioDoDeal).not.toHaveBeenCalled();
  });

  it('retomar: deal que a RLS não mostra → 404 antes de olhar a gravação', async () => {
    supabaseClientMock = {
      ...auth(),
      from: vi.fn((t: string) => (t === 'deals' ? buildDealQB(false) : buildProfileQB())),
    };
    expect((await retomar(PATH)).status).toBe(404);
    expect(files.lerGravacao).not.toHaveBeenCalled();
  });

  it('retomar: path com prefixo certo mas que não existe em deal_files → 404', async () => {
    vi.mocked(files.lerGravacao).mockResolvedValueOnce(null);
    expect((await retomar(PATH)).status).toBe(404);
  });

  it('retomar: gravação já aplicada → 409 (não gera um segundo desfecho)', async () => {
    vi.mocked(files.lerGravacao).mockResolvedValueOnce({
      audioFilePath: PATH, mimeType: 'audio/mpeg', criadoEm: '2026-10-08T20:59:46Z',
      transcricao: 'x', erro: null, erroEm: null, status: 'aplicado',
    });
    expect((await retomar(PATH)).status).toBe(409);
  });

  it('retomar SEM transcrição guardada: baixa o áudio salvo e transcreve — sem novo upload', async () => {
    vi.mocked(files.lerGravacao).mockResolvedValueOnce({
      audioFilePath: PATH, mimeType: 'audio/mpeg', criadoEm: '2026-10-08T20:59:46Z',
      transcricao: null, erro: 'Transcrição falhou: timeout', erroEm: '2026-10-08T21:00:40Z', status: 'pendente',
    });
    const res = await retomar(PATH);
    expect(res.status).toBe(200);
    expect(files.baixarAudioDoDeal).toHaveBeenCalledWith(PATH);
    expect(transcribeAudio).toHaveBeenCalledOnce();
    expect(vi.mocked(transcribeAudio).mock.calls[0][0].mimeType).toBe('audio/mpeg');
    expect(files.uploadDealAudioServer).not.toHaveBeenCalled();
    expect((await res.json()).audioFilePath).toBe(PATH);
  });

  it('retomar COM transcrição guardada: nem baixa nem transcreve, só refaz a leitura', async () => {
    vi.mocked(files.lerGravacao).mockResolvedValueOnce({
      audioFilePath: PATH, mimeType: 'audio/mpeg', criadoEm: '2026-10-08T20:59:46Z',
      transcricao: 'já transcrito antes', erro: 'Leitura do desfecho falhou: x', erroEm: null, status: 'pendente',
    });
    const res = await retomar(PATH);
    expect(res.status).toBe(200);
    expect(files.baixarAudioDoDeal).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(vi.mocked(extractCallOutcome).mock.calls[0][0].transcricao).toBe('já transcrito antes');
    expect((await res.json()).transcricao).toBe('já transcrito antes');
  });

  it('GET lista as pendentes com o motivo da falha e link para ouvir', async () => {
    vi.mocked(files.gravacoesPendentes).mockResolvedValueOnce([
      { audioFilePath: PATH, mimeType: 'audio/mpeg', criadoEm: '2026-10-08T20:59:46Z', transcricao: null, erro: 'Transcrição falhou: x', erroEm: null },
    ]);
    const req = new Request(`http://localhost/api/deals/${DEAL_ID}/call-outcome`);
    const res = await GET(req as never, { params: Promise.resolve({ dealId: DEAL_ID }) } as never);
    expect(res.status).toBe(200);
    const { pendentes } = await res.json();
    expect(pendentes).toEqual([{
      audioFilePath: PATH, criadoEm: '2026-10-08T20:59:46Z', erro: 'Transcrição falhou: x', erroEm: null,
      temTranscricao: false, audioUrl: `https://signed/${PATH}`,
    }]);
  });

  it('GET de deal que a RLS não mostra → 404, sem listar nada', async () => {
    supabaseClientMock = { ...auth(), from: vi.fn(() => buildDealQB(false)) };
    const req = new Request(`http://localhost/api/deals/${DEAL_ID}/call-outcome`);
    expect((await GET(req as never, { params: Promise.resolve({ dealId: DEAL_ID }) } as never)).status).toBe(404);
    expect(files.gravacoesPendentes).not.toHaveBeenCalled();
  });
});
