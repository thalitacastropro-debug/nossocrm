/**
 * @fileoverview Menu em dois grupos (OPERAÇÃO / CONTA) — decisão de 30/08/2026.
 *
 * O que estes testes seguram:
 * 1. Os grupos existem e o RBAC continua valendo DENTRO deles (o `trafego` não
 *    ganha acesso a nada só porque o menu passou a ser agrupado).
 * 2. Ninguém volta a ter uma lista de navegação duplicada: a barra do mobile e o
 *    "Mais" são DERIVADOS de `NAV_GROUPS`, então não podem apontar para rotas
 *    que o menu do desktop não tem.
 */

import { describe, it, expect } from 'vitest';
import {
  NAV_GROUPS,
  PRIMARY_NAV,
  visibleNavGroups,
  visibleNavItems,
  visibleMoreMenuGroups,
  visiblePrimaryNav,
} from './navConfig';

const hrefs = (grupos: ReturnType<typeof visibleNavGroups>) =>
  grupos.flatMap((g) => g.items.map((i) => i.href));

describe('NAV_GROUPS', () => {
  it('tem exatamente os grupos Operação e Conta, nessa ordem', () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(['operacao', 'conta']);
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Operação', 'Conta']);
  });

  it('não repete href entre grupos', () => {
    const todos = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(todos).size).toBe(todos.length);
  });

  // A ordem é pedido da Thalita (01/09): o que se abre todo dia vem primeiro, e
  // o Roadmap — visita ocasional — fica por último.
  it('põe Configurações, Perfil e Roadmap na Conta — o resto é Operação', () => {
    const conta = NAV_GROUPS.find((g) => g.id === 'conta')!;
    expect(conta.items.map((i) => i.href)).toEqual(['/settings', '/profile', '/roadmap']);
  });
});

describe('visibleNavGroups', () => {
  it('admin enxerga os dois grupos inteiros', () => {
    const grupos = visibleNavGroups('admin');
    expect(grupos.map((g) => g.id)).toEqual(['operacao', 'conta']);
    expect(hrefs(grupos)).toContain('/settings');
  });

  // O vendedor perdeu Configurações em 24/08 (VENDEDOR_BLOCKED_PREFIXES), mas
  // PRECISA do Roadmap: ele é justamente quem sente a dor e sugere melhoria.
  it('vendedor perde Configurações e mantém Roadmap + Perfil na Conta', () => {
    const grupos = visibleNavGroups('vendedor');
    expect(hrefs(grupos)).not.toContain('/settings');
    const conta = grupos.find((g) => g.id === 'conta');
    expect(conta?.items.map((i) => i.href)).toEqual(['/profile', '/roadmap']);
  });

  // O 'trafego' é parceiro externo (o Lobato), não colaborador: default-deny,
  // então nem Operação nem Roadmap. Só o que a rbac libera explicitamente.
  it('trafego (default-deny) fica só com Configurações e Perfil', () => {
    const grupos = visibleNavGroups('trafego');
    expect(grupos.map((g) => g.id)).toEqual(['conta']);
    expect(hrefs(grupos)).toEqual(['/settings', '/profile']);
  });

  it('sem papel (carregando) devolve tudo, para não piscar o menu', () => {
    expect(visibleNavGroups(undefined)).toEqual(NAV_GROUPS);
  });

  it('não devolve grupo vazio (cabeçalho órfão)', () => {
    for (const papel of ['admin', 'vendedor', 'trafego'] as const) {
      for (const grupo of visibleNavGroups(papel)) {
        expect(grupo.items.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('navegação do mobile deriva dos mesmos grupos', () => {
  it('a barra inferior só aponta para rotas que existem em NAV_GROUPS', () => {
    const todos = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)));
    for (const item of PRIMARY_NAV) {
      if (item.href) expect(todos).toContain(item.href);
    }
  });

  it('barra inferior + "Mais" cobrem exatamente o menu visível, sem sobrepor', () => {
    for (const papel of ['admin', 'vendedor', 'trafego'] as const) {
      const naBarra = visiblePrimaryNav(papel)
        .filter((i) => i.href)
        .map((i) => i.href!);
      const noMais = hrefs(visibleMoreMenuGroups(papel));

      // Sem sobreposição...
      expect(naBarra.filter((h) => noMais.includes(h))).toEqual([]);
      // ...e juntos dão o menu inteiro daquele papel.
      const menu = visibleNavItems(papel).map((i) => i.href);
      expect([...naBarra, ...noMais].sort()).toEqual([...menu].sort());
    }
  });

  it('o "Mais" mantém os cabeçalhos de grupo (mesmo vocabulário do desktop)', () => {
    const grupos = visibleMoreMenuGroups('admin');
    expect(grupos.map((g) => g.label)).toEqual(['Operação', 'Conta']);
  });
});
