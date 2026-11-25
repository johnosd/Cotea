// lib/cadastro-financeiro-servidor.js (gate) e lib/cadastro-financeiro-perfil.js com banco em memória — 004, T008.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = 'b'.repeat(64);
  return { db: null };
});
vi.mock('../../lib/mongodb', () => ({ getDb: vi.fn(async () => estado.db) }));

const { verificarCadastroFinanceiro } = await import('../../lib/cadastro-financeiro-servidor.js');
const {
  salvarCadastroFinanceiro, resumoCadastroFinanceiro, cpfClaroDoUsuario,
} = await import('../../lib/cadastro-financeiro-perfil.js');
const { encryptCPF, decryptCPF, hashCPF } = await import('../../lib/encryption.js');

const CPF = '52998224725';
const ENDERECO = { cep: '01001000', uf: 'SP', cidade: 'Sao Paulo', bairro: 'Se', rua: 'Praca', numero: '1', complemento: '', cepConfirmado: true };
const ENCONTRADO = async () => ({ status: 'encontrado', uf: 'SP', cidade: 'São Paulo', bairro: 'Sé', rua: 'Praça' });
const id = new ObjectId();
const usuarios = () => estado.db.collection('users');
const doc = () => usuarios().docs.find((u) => String(u._id) === String(id));
const semear = (extra = {}) => usuarios().docs.push({ _id: id, email: 'u@teste', ...extra });

beforeEach(() => {
  estado.db = criarDbMemoria();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('verificarCadastroFinanceiro', () => {
  it('sem CPF e sem endereço → 409 com as duas pendências', async () => {
    semear();
    expect(await verificarCadastroFinanceiro(String(id))).toMatchObject({
      ok: false, http: 409, body: { codigo: 'cadastro_financeiro_incompleto', pendencias: ['cpf', 'endereco'] },
    });
  });

  it('CPF cifrado válido + endereço válido → ok com CPF em claro', async () => {
    semear({ cpf: encryptCPF(CPF), cpfHash: hashCPF(CPF), endereco: ENDERECO });
    const r = await verificarCadastroFinanceiro(id);
    expect(r).toMatchObject({ ok: true, cpf: CPF });
    expect(String(r.usuario._id)).toBe(String(id));
  });

  it('CPF legado em texto puro válido conta como completo (antes da migração)', async () => {
    semear({ cpf: CPF, endereco: ENDERECO });
    expect(await verificarCadastroFinanceiro(String(id))).toMatchObject({ ok: true, cpf: CPF });
  });

  it('CPF cifrado inválido e endereço incompleto → pendências corretas', async () => {
    semear({ cpf: encryptCPF('12345678900'), endereco: { ...ENDERECO, numero: '' } });
    expect((await verificarCadastroFinanceiro(String(id))).body.pendencias).toEqual(['cpf', 'endereco']);
  });

  it('usuário inexistente → recusa', async () => {
    expect((await verificarCadastroFinanceiro(String(new ObjectId()))).ok).toBe(false);
  });
});

describe('salvarCadastroFinanceiro', () => {
  it('grava CPF cifrado + hash e endereço com o CEP confirmado', async () => {
    semear();
    const r = await salvarCadastroFinanceiro({ userId: String(id), enviado: { cpf: '529.982.247-25', endereco: ENDERECO }, consultar: ENCONTRADO });
    expect(r).toMatchObject({ ok: true, resumo: { completo: true, cpfTravado: true, cpfMascarado: '***.982.247-**', cepConfirmado: true } });
    expect(decryptCPF(doc().cpf)).toBe(CPF);
    expect(doc().cpfHash).toBe(hashCPF(CPF));
    expect(doc().endereco).toMatchObject({ cidade: 'São Paulo', cepConfirmado: true });
  });

  it('duplicidade pela pré-checagem → 409 cpf_indisponivel e nada gravado', async () => {
    semear();
    usuarios().docs.push({ _id: new ObjectId(), cpf: encryptCPF(CPF), cpfHash: hashCPF(CPF) });
    const r = await salvarCadastroFinanceiro({ userId: id, enviado: { cpf: CPF, endereco: ENDERECO }, consultar: ENCONTRADO });
    expect(r).toMatchObject({ ok: false, http: 409, codigo: 'cpf_indisponivel' });
    expect(doc().cpf).toBeUndefined();
    expect(doc().endereco).toBeUndefined();
  });

  it('E11000 do índice único (corrida) → 409 cpf_indisponivel', async () => {
    semear();
    usuarios().updateOne = vi.fn(async () => { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; });
    const r = await salvarCadastroFinanceiro({ userId: id, enviado: { cpf: CPF }, consultar: ENCONTRADO });
    expect(r).toMatchObject({ ok: false, http: 409, codigo: 'cpf_indisponivel' });
  });

  it('erro de validação → 400 com campos e nada gravado (nem o CPF válido)', async () => {
    semear();
    const r = await salvarCadastroFinanceiro({ userId: id, enviado: { cpf: CPF, endereco: { ...ENDERECO, rua: '' } }, consultar: ENCONTRADO });
    expect(r).toMatchObject({ ok: false, http: 400, codigo: 'cadastro_invalido', campos: { endereco: 'Informe a rua.' } });
    expect(doc().cpf).toBeUndefined();
  });

  it('CEP inexistente → 400; consulta só é chamada com CEP de 8 dígitos', async () => {
    semear();
    const consultar = vi.fn(async () => ({ status: 'nao_encontrado' }));
    expect((await salvarCadastroFinanceiro({ userId: id, enviado: { endereco: ENDERECO }, consultar })).campos.endereco).toBe('CEP nao encontrado.');
    expect(consultar).toHaveBeenCalledWith('01001000');
    consultar.mockClear();
    await salvarCadastroFinanceiro({ userId: id, enviado: { endereco: { ...ENDERECO, cep: '123' } }, consultar });
    expect(consultar).not.toHaveBeenCalled();
  });

  it('CPF travado: enviar outro mantém o salvo', async () => {
    semear({ cpf: encryptCPF(CPF), cpfHash: hashCPF(CPF) });
    expect((await salvarCadastroFinanceiro({ userId: id, enviado: { cpf: '11144477735' }, consultar: ENCONTRADO })).ok).toBe(true);
    expect(decryptCPF(doc().cpf)).toBe(CPF);
  });
});

describe('resumo e hash', () => {
  it('resumo nunca traz o CPF completo', () => {
    const r = resumoCadastroFinanceiro({ cpf: encryptCPF(CPF), endereco: ENDERECO });
    expect(JSON.stringify(r)).not.toContain(CPF);
    expect(resumoCadastroFinanceiro({}).cpfMascarado).toBe('');
  });

  it('hashCPF é estável, normaliza pontuação e difere entre CPFs; vazio → ""', () => {
    expect(hashCPF(CPF)).toBe(hashCPF('529.982.247-25'));
    expect(hashCPF(CPF)).not.toBe(hashCPF('11144477735'));
    expect(hashCPF(CPF)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCPF('')).toBe('');
  });

  it('cpfClaroDoUsuario tolera cifra corrompida', () => {
    expect(cpfClaroDoUsuario({ cpf: 'aa:bb:cc' })).toBe('');
    expect(cpfClaroDoUsuario(null)).toBe('');
  });
});
