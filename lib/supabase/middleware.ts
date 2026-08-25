import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessRoute, homeRouteFor, isRole, ROLE_VALUES } from '@/lib/rbac'

/**
 * Função pública `updateSession` do projeto.
 *
 * @param {NextRequest} request - Objeto da requisição.
 * @returns {Promise<NextResponse<unknown>>} Retorna um valor do tipo `Promise<NextResponse<unknown>>`.
 */
export async function updateSession(request: NextRequest) {
    // NOTE: Apesar do nome do arquivo, esta função é consumida pelo `proxy.ts` (Next 16+).
    // O Next renomeou a convenção de `middleware.ts` -> `proxy.ts`.
    // Doc: https://nextjs.org/docs/app/api-reference/file-conventions/proxy
    //
    // Importante: o Proxy NÃO deve interferir em `/api/*`.
    // Route Handlers devem responder com 401/403 quando necessário.
    // Se redirecionarmos `/api/*` para `/login`, quebramos `fetch`/SDKs.
    if (request.nextUrl.pathname.startsWith('/api')) {
        return NextResponse.next({ request })
    }

    // Check if Supabase is properly configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    // Prefer new publishable key format, fallback to legacy anon key
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // Skip auth if not configured or using placeholder values
    const isConfigured = supabaseUrl &&
        supabaseAnonKey &&
        !supabaseUrl.includes('your_') &&
        supabaseUrl.startsWith('http')

    if (!isConfigured) {
        console.warn('[proxy] Supabase not configured - skipping auth check')
        return NextResponse.next({ request })
    }

    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Refreshing the auth token
    const {
        data: { user },
    } = await supabase.auth.getUser()

    // ---------------------------------------------------------------------
    // Setup guard: se a instância não foi inicializada, forçar /setup
    // ---------------------------------------------------------------------
    // Observação: is_instance_initialized() está com GRANT para anon/authenticated.
    // Se der erro, falhamos "aberto" (não bloqueia navegação) para evitar lockout.
    const pathname = request.nextUrl.pathname
    const isSetupRoute = pathname === '/setup' || pathname.startsWith('/setup/')
    const isInstallRoute = pathname === '/install' || pathname.startsWith('/install/')

    try {
        const { data: initData, error: initError } = await supabase.rpc('is_instance_initialized')
        if (!initError && initData === false && !isSetupRoute && !isInstallRoute) {
            const url = request.nextUrl.clone()
            url.pathname = '/setup'
            return NextResponse.redirect(url)
        }
    } catch {
        // ignore
    }

    // Protected routes - redirect to login if not authenticated
    const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/auth')
    const isPublicRoute = pathname === '/' || pathname.startsWith('/join') || isSetupRoute || isInstallRoute

    if (!user && !isAuthRoute && !isPublicRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // Redirect authenticated users away from login
    if (user && isAuthRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
    }

    // ---------------------------------------------------------------------
    // RBAC guard — default-DENY para papéis limitados (ex.: 'trafego').
    // ---------------------------------------------------------------------
    // Este é o PONTO CENTRAL de proteção de rota no servidor. O fast-path evita a
    // consulta de papel quando a rota é livre para TODO MUNDO; só aí ninguém pode
    // ser barrado. Antes ele perguntava só pelo 'trafego', assumindo que era o
    // papel mais restrito em qualquer rota — deixou de valer em 24/08/2026, quando
    // o vendedor perdeu /settings (rota que o trafego ACESSA). Com a pergunta
    // antiga, o vendedor entraria em Configurações sem nunca ser checado.
    const rotaLivreParaTodosOsPapeis = ROLE_VALUES.every((papel) =>
        canAccessRoute(papel, pathname),
    )

    if (user && !rotaLivreParaTodosOsPapeis) {
        const { data: me } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        const role = me?.role
        if (isRole(role) && !canAccessRoute(role, pathname)) {
            const url = request.nextUrl.clone()
            // Destino por papel: mandar todo mundo para /settings viraria laço de
            // redirecionamento agora que o vendedor não entra lá.
            url.pathname = homeRouteFor(role)
            url.search = ''
            url.hash = ''
            return NextResponse.redirect(url)
        }
    }

    return supabaseResponse
}
