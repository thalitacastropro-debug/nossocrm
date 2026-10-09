import { describe, it, expect } from 'vitest';
import { destinoPosLogin } from './destinoPosLogin';

/**
 * O link do Telegram ("Abrir o card") tem que sobreviver ao login — e o `next` não pode virar
 * uma porta para mandar a pessoa a outro site depois de ela digitar a senha.
 */
describe('destinoPosLogin', () => {
  it('devolve o card que o link pedia', () => {
    expect(destinoPosLogin('/boards?deal=5cc7084e-34af-43d6-a5a9-baae776af409'))
      .toBe('/boards?deal=5cc7084e-34af-43d6-a5a9-baae776af409');
  });

  it('sem destino, vai para o painel como sempre foi', () => {
    expect(destinoPosLogin(null)).toBe('/dashboard');
    expect(destinoPosLogin('')).toBe('/dashboard');
  });

  it('recusa outro site (redirecionamento aberto)', () => {
    expect(destinoPosLogin('https://golpe.com')).toBe('/dashboard');
    expect(destinoPosLogin('//golpe.com/boards')).toBe('/dashboard');
    expect(destinoPosLogin('/\\golpe.com')).toBe('/dashboard');
    expect(destinoPosLogin('javascript:alert(1)')).toBe('/dashboard');
  });

  it('recusa voltar para o próprio login (laço)', () => {
    expect(destinoPosLogin('/login?next=/boards')).toBe('/dashboard');
  });
});
