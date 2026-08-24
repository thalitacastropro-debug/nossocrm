import React from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, KeyRound } from 'lucide-react'

/**
 * Página de erro do callback de autenticação.
 *
 * `app/auth/callback/route.ts` redireciona para cá quando o link do e-mail não
 * traz um `code` válido (link já usado, expirado, ou aberto de um jeito que o
 * app não sabe tratar — por exemplo o botão "Send password recovery" do painel
 * do Supabase, que manda o token no fragmento da URL para o Site URL do projeto,
 * não para esta rota).
 *
 * Existe porque essa rota ERA um 404 mudo: o usuário clicava no link do e-mail e
 * "não abria" nada, sem uma linha dizendo o que fazer (aconteceu de verdade em
 * 24/08/2026). A saída é sempre a mesma — pedir um link novo pelo próprio CRM,
 * que usa o fluxo que este app trata.
 */
export default function AuthCodeErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-dark-bg relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-primary-500/20 rounded-full blur-[120px]" />
        <div className="absolute top-[40%] -left-[10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-[100px]" />
      </div>

      <div className="max-w-md w-full relative z-10 px-4">
        <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-3xl p-8 shadow-xl">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 mx-auto mb-5">
            <AlertTriangle className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>

          <h1 className="text-2xl font-bold text-slate-900 dark:text-white text-center font-display mb-3">
            Esse link não vale mais
          </h1>

          <p className="text-slate-500 dark:text-slate-400 text-center mb-6">
            Links de acesso valem uma vez só e expiram. Peça um novo aqui pelo CRM — leva
            alguns segundos e chega no seu e-mail.
          </p>

          <Link
            href="/forgot-password"
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 transition-all shadow-lg shadow-primary-600/25"
          >
            <KeyRound className="h-4 w-4" />
            Gerar um link novo
          </Link>

          <Link
            href="/login"
            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para o login
          </Link>
        </div>
      </div>
    </div>
  )
}
