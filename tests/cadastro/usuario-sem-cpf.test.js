// GET /api/usuario não devolve o CPF completo — 004, T045 (C-01; FR-010, SC-005).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = 'f'.repeat(64);
  return { db: null, session: null };
});
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/mongodb', () => ({ getDb: vi.fn(async () => estado.db) }));

const { default: handler } = await import('../../pages/api/usuario.js');
const { encryptCPF } = await import('../../lib/encryption.js');

const CPF = '52998224725';
const chamar = async () => {
  const res = criarRes();
  await handler({ method: 'GET' }, res);
  return res;
};

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.session = { user: { email: 'u@teste' } };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GET /api/usuario', () => {
  it('CPF cifrado válido: devolve só mascarado e travado', async () => {
    estado.db.collection('users').docs.push({ _id: new ObjectId(), email: 'u@teste', nome: 'U', cpf: encryptCPF(CPF) });
    const res = await chamar();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ nome: 'U', cpfMascarado: '***.982.247-**', cpfTravado: true });
    expect(res.body.cpf).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(CPF);
  });

  it('CPF legado em texto puro também não vaza', async () => {
    estado.db.collection('users').docs.push({ _id: new ObjectId(), email: 'u@teste', cpf: CPF });
    const res = await chamar();
    expect(JSON.stringify(res.body)).not.toContain(CPF);
    expect(res.body.cpfMascarado).toBe('***.982.247-**');
  });

  it('sem CPF: cpfMascarado vazio e não travado', async () => {
    estado.db.collection('users').docs.push({ _id: new ObjectId(), email: 'u@teste' });
    expect((await chamar()).body).toMatchObject({ cpfMascarado: '', cpfTravado: false });
  });
});
