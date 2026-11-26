// consultarCep (lib/cep.js) com fetch falso — 004, T007. Nunca rede real.
import { describe, it, expect, vi } from 'vitest';
import { consultarCep } from '../../lib/cep.js';

const resposta = (status, corpo) => ({ status, json: async () => corpo });

describe('consultarCep', () => {
  it('mapeia o ViaCEP para o formato interno e chama a URL com só os dígitos', async () => {
    const fetchImpl = vi.fn(async () => resposta(200, { uf: 'SP', localidade: 'São Paulo', bairro: 'Sé', logradouro: 'Praça da Sé' }));
    const r = await consultarCep('01001-000', { fetchImpl });
    expect(r).toEqual({ status: 'encontrado', uf: 'SP', cidade: 'São Paulo', bairro: 'Sé', rua: 'Praça da Sé' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://viacep.com.br/ws/01001000/json/');
  });

  it('CEP geral (sem bairro/logradouro) volta com strings vazias', async () => {
    const fetchImpl = async () => resposta(200, { uf: 'MG', localidade: 'Serra do Salitre' });
    expect(await consultarCep('38760000', { fetchImpl })).toMatchObject({ status: 'encontrado', bairro: '', rua: '' });
  });

  it('erro: true (booleano ou string) é nao_encontrado', async () => {
    expect(await consultarCep('99999999', { fetchImpl: async () => resposta(200, { erro: true }) })).toEqual({ status: 'nao_encontrado' });
    expect(await consultarCep('99999999', { fetchImpl: async () => resposta(200, { erro: 'true' }) })).toEqual({ status: 'nao_encontrado' });
  });

  it('status != 200, JSON inválido, rede e CEP mal formado viram indisponivel sem lançar', async () => {
    const ind = { status: 'indisponivel' };
    expect(await consultarCep('01001000', { fetchImpl: async () => resposta(500, {}) })).toEqual(ind);
    expect(await consultarCep('01001000', { fetchImpl: async () => ({ status: 200, json: async () => { throw new SyntaxError('x'); } }) })).toEqual(ind);
    expect(await consultarCep('01001000', { fetchImpl: async () => { throw new TypeError('fetch failed'); } })).toEqual(ind);
    const nuncaChamado = vi.fn();
    expect(await consultarCep('0100', { fetchImpl: nuncaChamado })).toEqual(ind);
    expect(nuncaChamado).not.toHaveBeenCalled();
  });

  it('timeout aborta e devolve indisponivel', async () => {
    const fetchImpl = (url, { signal }) => new Promise((_, rejeitar) => {
      signal.addEventListener('abort', () => rejeitar(new Error('aborted')));
    });
    expect(await consultarCep('01001000', { fetchImpl, timeoutMs: 20 })).toEqual({ status: 'indisponivel' });
  });
});
