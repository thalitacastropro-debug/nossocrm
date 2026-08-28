/**
 * Credenciais de IA da org NÃO podem depender da RLS de quem chamou.
 *
 * Regressão de 25/08/2026: a migração `20260824230000_fecha_credenciais_e_organizacao.sql`
 * dropou a policy "Members can view org settings" e deixou `organization_settings` admin-only
 * (certo — as chaves ficam em texto puro ali). Só que `getOrgAIConfig` lê a tabela com o
 * client do CALLER. Para `role='vendedor'` o SELECT devolve zero linhas, a função retorna null
 * e a rota responde "Google AI key not configured" — mentira: a chave existe, ela é que está
 * invisível. Quebrou o "Gravar o desfecho da call" do Pedro e o briefing pré-reunião.
 * Provado por impersonação: vendedor => 0 linhas; admin => 1 linha.
 *
 * A porta NÃO se reabre na RLS (ver [[reference_crm_credenciais_org_settings]]): a leitura é
 * de servidor, com service role, DEPOIS da autorização que cada rota já faz.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG = 'org-1';

const LINHA_SETTINGS = {
  ai_enabled: true,
  ai_provider: 'anthropic',
  ai_model: 'claude-haiku-4-5-20251001',
  ai_google_key: 'AIzaSyFAKE-google',
  ai_anthropic_key: 'sk-ant-FAKE',
  ai_hitl_threshold: 0.85,
  ai_hitl_min_confidence: 0.7,
  ai_hitl_expiration_hours: 24,
  ai_config_mode: 'zero_config',
  ai_learned_patterns: null,
  ai_template_id: null,
  ai_takeover_enabled: false,
  ai_takeover_minutes: 15,
  ai_base_system_prompt: null,
  timezone: 'America/Sao_Paulo',
};

/** Client que devolve `rows` para o select de organization_settings. */
function clientQueDevolve(row: unknown) {
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
    }),
  }));
  return { from } as never;
}

const adminMock = vi.hoisted(() => ({ criar: vi.fn() }));
vi.mock('@/lib/supabase/staticAdminClient', () => ({
  createStaticAdminClient: () => adminMock.criar(),
}));

import { getOrgAIConfig } from '@/lib/ai/agent/agent.service';

describe('getOrgAIConfig sob RLS de vendedor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vendedor (RLS devolve 0 linhas) AINDA assim recebe a config — leitura é service role', async () => {
    const clienteDoVendedor = clientQueDevolve(null); // é o que a RLS faz hoje
    adminMock.criar.mockReturnValue(clientQueDevolve(LINHA_SETTINGS));

    const cfg = await getOrgAIConfig(clienteDoVendedor, ORG);

    expect(cfg).not.toBeNull();
    expect(cfg!.structuredApiKey).toBe('AIzaSyFAKE-google');
  });

  it('não usa o client do caller para ler as credenciais', async () => {
    const clienteDoVendedor = clientQueDevolve(null);
    adminMock.criar.mockReturnValue(clientQueDevolve(LINHA_SETTINGS));

    await getOrgAIConfig(clienteDoVendedor, ORG);

    expect((clienteDoVendedor as unknown as { from: ReturnType<typeof vi.fn> }).from)
      .not.toHaveBeenCalledWith('organization_settings');
    expect(adminMock.criar).toHaveBeenCalled();
  });

  it('org que realmente não tem settings continua devolvendo null', async () => {
    adminMock.criar.mockReturnValue(clientQueDevolve(null));
    expect(await getOrgAIConfig(clientQueDevolve(null), ORG)).toBeNull();
  });

  it('sem service role disponível, cai no client do caller em vez de quebrar', async () => {
    adminMock.criar.mockImplementation(() => { throw new Error('sem SUPABASE_SERVICE_ROLE_KEY'); });
    const cfg = await getOrgAIConfig(clientQueDevolve(LINHA_SETTINGS), ORG);
    expect(cfg).not.toBeNull();
  });
});
