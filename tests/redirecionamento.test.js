// destinoSeguro: só caminhos internos após o login.
import { describe, it, expect } from 'vitest';
import { destinoSeguro } from '../lib/redirecionamento.js';

describe('destinoSeguro', () => {
  it('mantém caminhos internos com query', () => {
    expect(destinoSeguro('/admin?tab=rotinas')).toBe('/admin?tab=rotinas');
    expect(destinoSeguro('/meus-grupos')).toBe('/meus-grupos');
    expect(destinoSeguro(['/wallet', '/outro'])).toBe('/wallet');
  });

  it('recusa destinos externos ou malformados', () => {
    expect(destinoSeguro('https://evil.com')).toBe('/');
    expect(destinoSeguro('//evil.com/x')).toBe('/');
    expect(destinoSeguro('/\\evil.com')).toBe('/');
    expect(destinoSeguro('javascript:alert(1)')).toBe('/');
    expect(destinoSeguro(undefined)).toBe('/');
    expect(destinoSeguro('')).toBe('/');
  });

  it('evita laço de volta para o login', () => {
    expect(destinoSeguro('/auth/signin?callbackUrl=%2Fadmin')).toBe('/');
  });
});
