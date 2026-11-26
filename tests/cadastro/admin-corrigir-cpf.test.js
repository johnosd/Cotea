// PUT /api/admin/users/[id]/cpf — correção de CPF pelo admin (004, T036; FR-018/FR-019).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = 'e'.repeat(64);
  return { db: null, session: null };
});
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/mongodb', () => ({ getDb: vi.fn(async () => estado.db) }));

const { default: handler } = await import('../../pages/api/admin/users/[id]/cpf.js');
const { logAudit } = await import('../../lib/audit');
const { encryptCPF, decryptCPF, hashCPF } = await import('../../lib/encryption.js');

const CPF_ERRADO = '11144477735';
const CPF_CERTO = '52998224725';
const adminId = new ObjectId();
const alvoId = new ObjectId();
const alvo = () => estado.db.collection('users').docs.find((u) => String(u._id) === String(alvoId));
const sessao = (systemRole = 'admin', id = adminId) => ({ user: { id: String(id), email: `${systemRole}@teste`, systemRole } });
const corrigir = async (body, id = alvoId) => {
  const res = criarRes();
  await handler({ method: 'PUT', query: { id: String(id) }, body, headers: {}, socket: {} }, res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  estado.db = criarDbMemoria();
  estado.db.collection('users').docs.push(
    { _id: adminId, email: 'admin@teste' },
    { _id: alvoId, email: 'alvo@teste', cpf: encryptCPF(CPF_ERRADO), cpfHash: hashCPF(CPF_ERRADO) },
  );
  estado.session = sessao();
});

describe('correção de CPF pelo admin', () => {
  it('corrige com motivo: grava cifrado + hash e audita só o motivo', async () => {
    const res = await corrigir({ cpf: '529.982.247-25', motivo: '  Digitacao errada  ' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ cpfMascarado: '***.982.247-**' });
    expect(decryptCPF(alvo().cpf)).toBe(CPF_CERTO);
    expect(alvo().cpfHash).toBe(hashCPF(CPF_CERTO));
    expect(logAudit).toHaveBeenCalledTimes(1);
    const auditoria = vi.mocked(logAudit).mock.calls[0][0];
    expect(auditoria).toMatchObject({ action: 'user.cpf_corrected', targetId: String(alvoId), details: { motivo: 'Digitacao errada' } });
    const texto = JSON.stringify(auditoria);
    for (const proibido of [CPF_CERTO, CPF_ERRADO, '982.247', '529.982']) expect(texto).not.toContain(proibido);
  });

  it('motivo vazio ou CPF inválido → 400 sem gravar nem auditar', async () => {
    expect((await corrigir({ cpf: CPF_CERTO, motivo: '   ' })).statusCode).toBe(400);
    expect((await corrigir({ cpf: '52998224726', motivo: 'x' })).statusCode).toBe(400);
    expect(decryptCPF(alvo().cpf)).toBe(CPF_ERRADO);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('CPF de outra conta → 409 cpf_indisponivel', async () => {
    estado.db.collection('users').docs.push({ _id: new ObjectId(), cpf: encryptCPF(CPF_CERTO), cpfHash: hashCPF(CPF_CERTO) });
    const res = await corrigir({ cpf: CPF_CERTO, motivo: 'x' });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('cpf_indisponivel');
    expect(decryptCPF(alvo().cpf)).toBe(CPF_ERRADO);
  });

  it('o admin não corrige o próprio CPF → 403', async () => {
    expect((await corrigir({ cpf: CPF_CERTO, motivo: 'x' }, adminId)).statusCode).toBe(403);
  });

  it('support e finance → 403; usuário inexistente → 404; id inválido → 400', async () => {
    for (const papel of ['support', 'finance', 'user']) {
      estado.session = sessao(papel, new ObjectId());
      expect((await corrigir({ cpf: CPF_CERTO, motivo: 'x' })).statusCode, papel).toBe(403);
    }
    estado.session = sessao();
    expect((await corrigir({ cpf: CPF_CERTO, motivo: 'x' }, new ObjectId())).statusCode).toBe(404);
    const res = criarRes();
    await handler({ method: 'PUT', query: { id: 'abc' }, body: { cpf: CPF_CERTO, motivo: 'x' }, headers: {}, socket: {} }, res);
    expect(res.statusCode).toBe(400);
  });
});
