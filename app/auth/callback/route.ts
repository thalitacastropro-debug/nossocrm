import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

/**
 * Callback de autenticação por link de e-mail.
 *
 * Trata os DOIS formatos que o Supabase manda:
 * - `?code=...`        — fluxo PKCE, usado quando o próprio app pede o link
 *                        (`/forgot-password` → `resetPasswordForEmail`).
 * - `?token_hash=...&type=recovery` — formato dos templates de e-mail que usam
 *                        `{{ .TokenHash }}`. Antes caía direto no erro, porque a
 *                        rota só sabia trocar `code`.
 *
 * O que NÃO chega aqui: o link do botão "Send password recovery" do painel do
 * Supabase. Ele leva para o **Site URL** do projeto com o token no FRAGMENTO
 * (`#access_token=...`), que o navegador não envia ao servidor — quem trata isso
 * é o supabase-js no cliente. Se o Site URL estiver errado, esse link "não abre".
 *
 * @param {Request} request - Objeto da requisição.
 * @returns {Promise<NextResponse<unknown>>} Retorna um valor do tipo `Promise<NextResponse<unknown>>`.
 */
export async function GET(request: Request) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type') as EmailOtpType | null
    const next = searchParams.get('next') ?? '/dashboard'

    // Recuperação de senha sempre termina na tela de definir a senha nova, mesmo
    // que o link não traga `next` (é o caso dos templates padrão do Supabase).
    const destino = type === 'recovery' && next === '/dashboard' ? '/reset-password' : next

    if (code || (tokenHash && type)) {
        const supabase = await createClient()

        const { error } = code
            ? await supabase.auth.exchangeCodeForSession(code)
            : await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash! })

        if (!error) {
            const forwardedHost = request.headers.get('x-forwarded-host')
            const isLocalEnv = process.env.NODE_ENV === 'development'

            if (isLocalEnv) {
                return NextResponse.redirect(`${origin}${destino}`)
            } else if (forwardedHost) {
                return NextResponse.redirect(`https://${forwardedHost}${destino}`)
            } else {
                return NextResponse.redirect(`${origin}${destino}`)
            }
        }
    }

    // Link inválido, já usado ou expirado. A página explica e oferece pedir outro
    // — ela existe desde 24/08/2026; antes isto era um redirect para um 404 mudo.
    return NextResponse.redirect(`${origin}/auth/auth-code-error`)
}
