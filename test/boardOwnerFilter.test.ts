import { describe, it, expect } from 'vitest';
import {
  matchesOwnerFilter,
  podeFiltrarPorConsultor,
} from '@/features/boards/hooks/useBoardsController';

const THALITA = 'user-thalita';
const DENILSON = 'user-denilson';
const PEDRO = 'user-pedro';

describe('matchesOwnerFilter', () => {
  it('"all" deixa passar qualquer card, inclusive o sem dono', () => {
    expect(matchesOwnerFilter(DENILSON, 'all', THALITA)).toBe(true);
    expect(matchesOwnerFilter(undefined, 'all', THALITA)).toBe(true);
  });

  it('"mine" pega só os cards de quem está olhando', () => {
    expect(matchesOwnerFilter(THALITA, 'mine', THALITA)).toBe(true);
    expect(matchesOwnerFilter(PEDRO, 'mine', THALITA)).toBe(false);
  });

  // Card sem dono NÃO pode cair em "meus negócios" só porque os dois são vazios —
  // seria o admin adotando 145 cards órfãos sem perceber.
  it('"mine" não engole card sem dono quando o usuário ainda não carregou', () => {
    expect(matchesOwnerFilter(undefined, 'mine', undefined)).toBe(false);
    expect(matchesOwnerFilter(undefined, 'mine', THALITA)).toBe(false);
  });

  it('filtrar por uma pessoa traz só os cards dela', () => {
    expect(matchesOwnerFilter(PEDRO, PEDRO, THALITA)).toBe(true);
    expect(matchesOwnerFilter(DENILSON, PEDRO, THALITA)).toBe(false);
    expect(matchesOwnerFilter(undefined, PEDRO, THALITA)).toBe(false);
  });

  it('"sem-dono" isola os órfãos', () => {
    expect(matchesOwnerFilter(undefined, 'sem-dono', THALITA)).toBe(true);
    expect(matchesOwnerFilter(DENILSON, 'sem-dono', THALITA)).toBe(false);
  });
});

describe('podeFiltrarPorConsultor', () => {
  it('admin filtra por qualquer consultor', () => {
    expect(podeFiltrarPorConsultor({ role: 'admin' })).toBe(true);
  });

  it('quem enxerga a carteira do time filtra (sócio/gestor)', () => {
    expect(podeFiltrarPorConsultor({ role: 'vendedor', ve_todos_os_leads: true })).toBe(true);
  });

  // O pedido da Thalita: o Pedro não pode nem OFERECER o funil de outro consultor
  // no filtro, em nenhum funil que ele tenha acesso.
  it('vendedor comum NÃO filtra por consultor', () => {
    expect(podeFiltrarPorConsultor({ role: 'vendedor', ve_todos_os_leads: false })).toBe(false);
    expect(podeFiltrarPorConsultor({ role: 'vendedor' })).toBe(false);
  });

  it('papel tráfego e perfil ausente também não', () => {
    expect(podeFiltrarPorConsultor({ role: 'trafego' })).toBe(false);
    expect(podeFiltrarPorConsultor(null)).toBe(false);
    expect(podeFiltrarPorConsultor(undefined)).toBe(false);
  });
});
