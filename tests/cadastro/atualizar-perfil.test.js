// POST/GET /api/atualizarPerfil com as regras do cadastro financeiro — 004, T012.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = 'c'.repeat(64);
  return { db: null, session: null };
});
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('./../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
}));
vi.mock('../../lib/cep', () => ({ consultarCep: vi.fn(async () => ({ status: 'indisponivel' })) }));

const { default: handler } = await import('../../pages/api/atualizarPerfil.js');
const { encryptCPF, decryptCPF, hashCPF } = await import('../../lib/encryption.js');

const CPF = '52998224725';
const id = new ObjectId();
const ENDERECO = { cep: '01001000', uf: 'SP', cidade: 'Sao Paulo', bairro: 'Se', rua: 'Praca', numero: '1', complemento: '' };
const base = { email: 'u@teste', nome: 'U', sobrenome: 'T', username: 'u_t' };
const doc = () => estado.db.collection('users').docs.find((u) => String(u._id) === String(id));
const chamar = async (method, extra = {}) => {
  const res = criarRes();
  await handler({ method, body: method === 'POST' ? { ...base, ...extra } : undefined, query: { email: extra.email || 'u@teste' } }, res);
  return res;
};

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.db.collection('users').docs.push({ _id: id, ...base, cpf: encryptCPF(CPF), cpfHash: hashCPF(CPF), endereco: ENDERECO });
  estado.session = { user: { email: 'u@teste', systemRole: 'user' } };
});

describe('/api/atualizarPerfil com cadastro financeiro', () => {
  it('POST sem CPF não apaga o CPF salvo (bug antigo)', async () => {
    const res = await chamar('POST', { endereco: ENDERECO });
    expect(res.statusCode).toBe(200);
    expect(decryptCPF(doc().cpf)).toBe(CPF);
  });

  it('POST com outro CPF mantém o salvo', async () => {
    expect((await chamar('POST', { cpf: '11144477735', endereco: ENDERECO })).statusCode).toBe(200);
    expect(decryptCPF(doc().cpf)).toBe(CPF);
  });

  it('POST sem o campo endereco não mexe no endereço completo', async () => {
    expect((await chamar('POST', { nome: 'Novo' })).statusCode).toBe(200);
    expect(doc()).toMatchObject({ nome: 'Novo', endereco: ENDERECO });
  });

  it('GET do próprio usuário e do admin nunca traz o CPF completo', async () => {
    const proprio = await chamar('GET');
    expect(proprio.body).toMatchObject({ cpfTravado: true, cpfMascarado: '***.982.247-**' });
    expect(proprio.body.cpf).toBeUndefined();
    expect(proprio.body.cpfHash).toBeUndefined();
    estado.session = { user: { email: 'admin@teste', systemRole: 'admin' } };
    const admin = await chamar('GET');
    expect(JSON.stringify(admin.body)).not.toContain(CPF);
  });

  it('CPF duplicado em conta sem CPF → 409 com message e nada gravado', async () => {
    const outro = new ObjectId();
    estado.db.collection('users').docs.push({ _id: outro, email: 'v@teste', nome: 'V', sobrenome: 'W', username: 'v_w' });
    estado.session = { user: { email: 'v@teste', systemRole: 'user' } };
    const res = criarRes();
    await handler({ method: 'POST', body: { email: 'v@teste', nome: 'V', sobrenome: 'W', username: 'v_w', cpf: CPF } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'cpf_indisponivel' });
    expect(res.body.message).toEqual(expect.any(String));
    expect(estado.db.collection('users').docs.find((u) => String(u._id) === String(outro)).cpf).toBeUndefined();
  });

  it('CPF inválido → 400 com campos e demais dados não gravados', async () => {
    estado.db.collection('users').docs[0].cpf = undefined;
    const res = await chamar('POST', { nome: 'Nao grava', cpf: '52998224726' });
    expect(res.statusCode).toBe(400);
    expect(res.body.campos.cpf).toEqual(expect.any(String));
    expect(doc().nome).toBe('U');
  });
});
