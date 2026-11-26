// Casos adicionais das regras puras de lib/cadastro-financeiro.js (004, T006).
import { describe, it, expect } from 'vitest';
import {
  validarCpf, somenteDigitosCpf, enderecoValido, avaliarCadastroFinanceiro,
  planejarCadastroFinanceiro, STATUS_CEP,
} from '../../lib/cadastro-financeiro.js';

const OK = { cep: '01001000', uf: 'sp', cidade: 'Sao Paulo', bairro: 'Se', rua: 'Praca da Se', numero: '1', complemento: '' };
const INDISP = { status: STATUS_CEP.INDISPONIVEL };
const plano = (enviado, atual = { cpf: '', endereco: null }, cep = INDISP) => planejarCadastroFinanceiro({ atual, enviado, cep });

describe('cadastro financeiro — regras puras', () => {
  it('somenteDigitosCpf trata nulo, número e pontuação', () => {
    expect(somenteDigitosCpf(null)).toBe('');
    expect(somenteDigitosCpf(52998224725)).toBe('52998224725');
    expect(somenteDigitosCpf(' 529.982.247-25 ')).toBe('52998224725');
  });

  it('validarCpf aceita números válidos conhecidos e recusa sequências', () => {
    for (const valido of ['11144477735', '12345678909', '000.000.001-91']) expect(validarCpf(valido), valido).toBe(true);
    for (const seq of ['00000000000', '99999999999']) expect(validarCpf(seq)).toBe(false);
    expect(validarCpf('529982247250')).toBe(false);
  });

  it('número aceita variantes de S/N e UF minúscula', () => {
    for (const numero of ['s/n', 'S/N', 'sn', 's.n.', ' S / N ']) {
      expect(plano({ endereco: { ...OK, numero } }).enderecoParaGravar?.numero, numero).toBe('S/N');
    }
    expect(plano({ endereco: OK }).enderecoParaGravar.uf).toBe('SP');
  });

  it('endereço parcial com o atual incompleto é validado e recusado; tudo vazio não mexe', () => {
    const parcial = plano({ endereco: { ...OK, bairro: '' } });
    expect(parcial).toMatchObject({ ok: false, enderecoParaGravar: null });
    expect(parcial.erros.endereco).toBe('Informe o bairro.');
    const vazio = plano({ endereco: { cep: '', uf: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' } }, { cpf: '', endereco: null }, null);
    expect(vazio).toMatchObject({ ok: true, enderecoParaGravar: null, cpfParaGravar: null });
  });

  it('mensagens por campo e CEP com menos dígitos', () => {
    expect(plano({ endereco: { ...OK, cep: '0100' } }, undefined, null).erros.endereco).toBe('CEP deve ter 8 digitos.');
    expect(plano({ endereco: { ...OK, uf: '' } }).erros.endereco).toBe('UF invalida.');
    expect(plano({ endereco: { ...OK, cidade: ' ' } }).erros.endereco).toBe('Informe a cidade.');
    expect(plano({ endereco: { ...OK, rua: '' } }).erros.endereco).toBe('Informe a rua.');
    expect(plano({ endereco: { ...OK, numero: '' } }).erros.endereco).toBe('Informe o numero (ou S/N).');
  });

  it('com erro em um campo, nada é gravado (nem o campo certo)', () => {
    const r = plano({ cpf: '52998224725', endereco: { ...OK, rua: '' } });
    expect(r).toMatchObject({ ok: false, cpfParaGravar: null, enderecoParaGravar: null });
    expect(r.erros.cpf).toBeUndefined();
  });

  it('CPF legado inválido não trava: aceita um CPF válido novo', () => {
    expect(plano({ cpf: '52998224725' }, { cpf: '12345678900', endereco: null }, null).cpfParaGravar).toBe('52998224725');
  });

  it('enderecoValido e avaliar ignoram cepConfirmado', () => {
    expect(enderecoValido({ ...OK, cepConfirmado: false })).toBe(true);
    expect(enderecoValido(null)).toBe(false);
    expect(avaliarCadastroFinanceiro({ cpf: '52998224725', endereco: OK })).toEqual({ completo: true, pendencias: [] });
  });
});
