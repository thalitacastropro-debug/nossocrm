import { describe, it, expect } from 'vitest';
import { canAccessRoute, homeRouteFor, ROLE_VALUES } from '@/lib/rbac';

describe('canAccessRoute — vendedor fora de Configurações', () => {
  // Decisão da Thalita (24/08/2026): "nenhum vendedor deve ter acesso às
  // configurações". Configurações concentra a Central de I.A, o DELETAR TUDO da
  // aba Dados, a Equipe, as Integrações e as Unidades.
  it('vendedor não acessa /settings nem as subrotas', () => {
    expect(canAccessRoute('vendedor', '/settings')).toBe(false);
    expect(canAccessRoute('vendedor', '/settings/')).toBe(false);
    expect(canAccessRoute('vendedor', '/settings/ai')).toBe(false);
    expect(canAccessRoute('vendedor', '/settings/data')).toBe(false);
    expect(canAccessRoute('vendedor', '/settings/users')).toBe(false);
  });

  it('vendedor mantém o resto do CRM, inclusive o próprio perfil', () => {
    for (const rota of ['/boards', '/inbox', '/messaging', '/contacts', '/activities', '/dashboard', '/reports', '/profile']) {
      expect(canAccessRoute('vendedor', rota)).toBe(true);
    }
  });

  // Não pode bloquear por "começa com o texto": /settings-publicas não é Configurações.
  it('bloqueia por segmento de rota, não por prefixo de texto', () => {
    expect(canAccessRoute('vendedor', '/settings-publicas')).toBe(true);
    expect(canAccessRoute('vendedor', '/settingsx')).toBe(true);
  });

  it('admin entra em tudo e trafego segue com a lista dele', () => {
    expect(canAccessRoute('admin', '/settings/ai')).toBe(true);
    expect(canAccessRoute('trafego', '/settings')).toBe(true);
    expect(canAccessRoute('trafego', '/boards')).toBe(false);
  });

  // Trocar a própria senha é direito de qualquer papel. Se a rota não for livre
  // para TODOS, o guard do servidor consulta o papel de quem está trocando a
  // senha e barra o `trafego` no meio do caminho.
  it('recuperação de senha é livre para todos os papéis', () => {
    for (const papel of ROLE_VALUES) {
      expect(canAccessRoute(papel, '/forgot-password')).toBe(true);
      expect(canAccessRoute(papel, '/reset-password')).toBe(true);
    }
    expect(ROLE_VALUES.every((p) => canAccessRoute(p, '/forgot-password'))).toBe(true);
  });
});

describe('homeRouteFor — destino de quem cai em rota proibida', () => {
  // A armadilha: o guard mandava todo mundo para /settings. Como o vendedor
  // perdeu justamente essa rota, o destino fixo viraria laço de redirecionamento.
  it('nunca manda alguém para uma rota que ele não pode acessar', () => {
    for (const papel of ROLE_VALUES) {
      expect(canAccessRoute(papel, homeRouteFor(papel))).toBe(true);
    }
  });

  it('vendedor cai nos funis; trafego, em configurações', () => {
    expect(homeRouteFor('vendedor')).toBe('/boards');
    expect(homeRouteFor('trafego')).toBe('/settings');
  });
});

describe('fast-path do guard no servidor', () => {
  // O guard só consulta o papel quando a rota NÃO é livre para todos. A pergunta
  // antiga era "o trafego pode?" — com /settings fechado ao vendedor, essa
  // pergunta responderia "pode" e o vendedor entraria sem ser checado.
  it('/settings não é livre para todos os papéis', () => {
    expect(ROLE_VALUES.every((papel) => canAccessRoute(papel, '/settings'))).toBe(false);
  });

  it('perguntar só pelo trafego deixaria /settings passar batido', () => {
    expect(canAccessRoute('trafego', '/settings')).toBe(true);
    expect(canAccessRoute('vendedor', '/settings')).toBe(false);
  });

  it('rota comum é livre para todos? não — o trafego já restringe', () => {
    expect(ROLE_VALUES.every((papel) => canAccessRoute(papel, '/boards'))).toBe(false);
  });
});
