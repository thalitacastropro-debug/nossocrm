import { describe, it, expect, vi, beforeEach } from 'vitest';

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
}));

const { GET } = await import('@/app/auth/callback/route');

const req = (url: string) => new Request(url);

beforeEach(() => {
  vi.clearAllMocks();
  exchangeCodeForSession.mockResolvedValue({ error: null });
  verifyOtp.mockResolvedValue({ error: null });
});

describe('GET /auth/callback', () => {
  it('troca o code do fluxo PKCE e segue para o next pedido', async () => {
    const res = await GET(req('https://crm.nivaconsultoria.com.br/auth/callback?code=abc&next=/reset-password'));

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(res.headers.get('location')).toBe('https://crm.nivaconsultoria.com.br/reset-password');
  });

  // O formato dos templates de e-mail com {{ .TokenHash }} — antes caía no erro,
  // porque a rota só sabia trocar `code`.
  it('aceita token_hash + type=recovery e leva para a tela de nova senha', async () => {
    const res = await GET(req('https://crm.nivaconsultoria.com.br/auth/callback?token_hash=xyz&type=recovery'));

    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'xyz' });
    expect(res.headers.get('location')).toBe('https://crm.nivaconsultoria.com.br/reset-password');
  });

  it('respeita o next explícito mesmo em recovery', async () => {
    const res = await GET(req('https://crm.nivaconsultoria.com.br/auth/callback?token_hash=xyz&type=recovery&next=/perfil'));

    expect(res.headers.get('location')).toBe('https://crm.nivaconsultoria.com.br/perfil');
  });

  it('link sem code nem token_hash vai para a página de erro, não para um 404', async () => {
    const res = await GET(req('https://crm.nivaconsultoria.com.br/auth/callback'));

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('https://crm.nivaconsultoria.com.br/auth/auth-code-error');
  });

  it('token já usado (erro do Supabase) também cai na página de erro', async () => {
    verifyOtp.mockResolvedValue({ error: new Error('Token has expired or is invalid') });

    const res = await GET(req('https://crm.nivaconsultoria.com.br/auth/callback?token_hash=gasto&type=recovery'));

    expect(res.headers.get('location')).toBe('https://crm.nivaconsultoria.com.br/auth/auth-code-error');
  });

  it('em produção atrás de proxy, redireciona pelo host encaminhado', async () => {
    const request = new Request('http://localhost/auth/callback?code=abc&next=/dashboard', {
      headers: { 'x-forwarded-host': 'crm.nivaconsultoria.com.br' },
    });

    const res = await GET(request);

    expect(res.headers.get('location')).toBe('https://crm.nivaconsultoria.com.br/dashboard');
  });
});
