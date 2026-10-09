import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type MockUser = { id: string }
const mocks = vi.hoisted(() => {
  const state = {
    currentUser: null as MockUser | null,
  }

  const nextResponseMock = {
    next: vi.fn((init?: unknown) => ({
      kind: 'next',
      init,
      cookies: {
        set: vi.fn(),
      },
    })),
    redirect: vi.fn((url: unknown) => ({
      kind: 'redirect',
      url,
    })),
  }

  const supabaseSsrMock = {
    createServerClient: vi.fn(() => ({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: state.currentUser } })),
      },
    })),
  }

  return { state, nextResponseMock, supabaseSsrMock }
})

vi.mock('next/server', () => ({
  NextResponse: mocks.nextResponseMock,
}))

vi.mock('@supabase/ssr', () => mocks.supabaseSsrMock)

import { updateSession } from '../lib/supabase/middleware'

type MockRequest = {
  nextUrl: URL & { clone(): URL }
  cookies: {
    getAll(): unknown[]
    set: ReturnType<typeof vi.fn>
  }
}

// URL de verdade (com search/searchParams): o guard agora carrega o destino em `?next=`.
function makeRequest(pathAndQuery: string) {
  const base = new URL(pathAndQuery, 'http://localhost')
  const nextUrl = Object.assign(new URL(base), { clone: () => new URL(base) })
  const req: MockRequest = {
    nextUrl,
    cookies: {
      getAll() {
        return []
      },
      set: vi.fn(),
    },
  }

  return req as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.currentUser = null

  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://example.supabase.local')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('updateSession (Proxy/Supabase)', () => {
  it('bypassa /api/* sem chamar Supabase', async () => {
    const req = makeRequest('/api/health')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.next).toHaveBeenCalledTimes(1)
    expect(mocks.supabaseSsrMock.createServerClient).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  it('permite /setup sem autenticação (sem redirect)', async () => {
    const req = makeRequest('/setup')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  it('permite /join/* sem autenticação (sem redirect)', async () => {
    const req = makeRequest('/join')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  // O bug de 25/08/2026: `/forgot-password` não estava em nenhuma lista de rota
  // liberada. Quem esqueceu a senha está DESLOGADO por definição — clicava em
  // "Esqueci minha senha" e o guard devolvia para /login. O Denilson travou aí.
  it('permite /forgot-password sem autenticação — é onde se pede o link', async () => {
    const req = makeRequest('/forgot-password')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  it('permite /reset-password sem autenticação', async () => {
    const req = makeRequest('/reset-password')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  // A outra ponta: quem chega em /reset-password vem COM sessão (a de
  // recuperação, criada pelo link do e-mail). Se a rota fosse tratada como rota
  // de auth, o guard mandaria a pessoa para /dashboard e ela nunca trocaria a
  // senha — trocando um beco sem saída por outro.
  it('deixa quem TEM sessão de recuperação abrir /reset-password', async () => {
    mocks.state.currentUser = { id: 'denilson' }
    const req = makeRequest('/reset-password')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  it('permite /auth/callback sem autenticação (sem redirect)', async () => {
    const req = makeRequest('/auth/callback')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'next' })
  })

  it('redireciona rota protegida para /login quando não autenticado', async () => {
    const req = makeRequest('/dashboard')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).toHaveBeenCalledTimes(1)
    const [urlArg] = mocks.nextResponseMock.redirect.mock.calls[0]
    expect((urlArg as URL).pathname).toBe('/login')
    expect(res).toMatchObject({ kind: 'redirect' })
  })

  it('redireciona usuário autenticado para /dashboard quando acessa /login', async () => {
    mocks.state.currentUser = { id: 'user-1' }
    const req = makeRequest('/login')

    const res = await updateSession(req)

    expect(mocks.nextResponseMock.redirect).toHaveBeenCalledTimes(1)
    const [urlArg] = mocks.nextResponseMock.redirect.mock.calls[0]
    expect((urlArg as URL).pathname).toBe('/dashboard')
    expect(res).toMatchObject({ kind: 'redirect' })
  })

  // O link "Abrir o card" do Telegram (/boards?deal=...) tem que sobreviver ao login.
  it('sem sessão, leva o destino junto para o login em ?next=', async () => {
    const req = makeRequest('/boards?deal=5cc7084e-34af-43d6-a5a9-baae776af409')

    await updateSession(req)

    const [urlArg] = mocks.nextResponseMock.redirect.mock.calls[0]
    expect((urlArg as URL).pathname).toBe('/login')
    expect((urlArg as URL).searchParams.get('next')).toBe('/boards?deal=5cc7084e-34af-43d6-a5a9-baae776af409')
    expect((urlArg as URL).searchParams.get('deal')).toBeNull()
  })

  it('com sessão, /login?next= devolve para o card', async () => {
    mocks.state.currentUser = { id: 'user-1' }
    const req = makeRequest('/login?next=' + encodeURIComponent('/boards?deal=abc'))

    await updateSession(req)

    const [urlArg] = mocks.nextResponseMock.redirect.mock.calls[0]
    expect((urlArg as URL).pathname).toBe('/boards')
    expect((urlArg as URL).search).toBe('?deal=abc')
  })

  it('com sessão, next para OUTRO site cai no /dashboard', async () => {
    mocks.state.currentUser = { id: 'user-1' }
    const req = makeRequest('/login?next=' + encodeURIComponent('//golpe.com/x'))

    await updateSession(req)

    const [urlArg] = mocks.nextResponseMock.redirect.mock.calls[0]
    expect((urlArg as URL).host).toBe('localhost')
    expect((urlArg as URL).pathname).toBe('/dashboard')
  })
})
