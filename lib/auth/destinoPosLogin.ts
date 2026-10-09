/**
 * Para onde mandar a pessoa depois do login (09/10/2026).
 *
 * Todo link que o CRM manda para fora — o "Abrir o card" do Telegram, o do perdido que voltou a
 * falar — leva a `/boards?deal=<id>`. Sem sessão, o guard jogava para `/login` e o login mandava
 * SEMPRE para `/dashboard`: o card se perdia no caminho, e o aviso que deveria levar ao lead
 * levava ao painel inicial. Agora o guard carrega o destino em `?next=` e o login devolve a
 * pessoa para ele.
 *
 * Só aceita caminho RELATIVO do próprio CRM. `next` vem da URL — sem esta trava, o login viraria
 * um redirecionador aberto (`/login?next=https://golpe.com` depois de digitar a senha certa).
 */
export const DESTINO_PADRAO = '/dashboard';

export function destinoPosLogin(next: string | null | undefined): string {
  if (!next) return DESTINO_PADRAO;
  // Relativo de verdade: começa com UMA barra. `//host` e `/\host` o navegador lê como outro site.
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return DESTINO_PADRAO;
  if (/[\r\n]/.test(next)) return DESTINO_PADRAO;
  // Voltar para o próprio login (ou rotas de auth) seria um laço.
  if (next.startsWith('/login') || next.startsWith('/auth')) return DESTINO_PADRAO;
  return next;
}
