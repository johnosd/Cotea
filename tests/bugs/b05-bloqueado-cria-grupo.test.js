// Regressão B-05: usuário bloqueado (isBlocked) não pode criar grupo via POST /api/grupos.
// O banco é a fonte de verdade (o JWT pode estar defasado); a sessão também é respeitada.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  getWalletByUser: vi.fn(),
  createWallet: vi.fn(),
}));

const { default: handlerGrupos } = await import('../../pages/api/grupos/index.js');
const { logAudit } = await import('../../lib/audit');

const userId = new ObjectId();
const corpo = { nome: 'Grupo B05', categoria: 'jogos', valorTotal: 40, capacidadeTotal: 4 };

const semear = (extraUser = {}, extraSessao = {}) => {
  estado.db = criarDbMemoria();
  estado.db.collection('users').docs.push({ _id: userId, nome: 'U', email: 'u@teste', ...extraUser });
  estado.session = { user: { id: String(userId), email: 'u@teste', contaValidada: true, systemRole: 'user', ...extraSessao } };
  vi.mocked(logAudit).mockClear();
};

const criar = async () => {
  const res = criarRes();
  await handlerGrupos({ method: 'POST', body: corpo, headers: {}, socket: {} }, res);
  return res;
};

describe('POST /api/grupos — usuário bloqueado (B-05)', () => {
  beforeEach(() => semear());

  it('nega 403 quando o banco marca isBlocked, mesmo com JWT defasado (sem a flag)', async () => {
    semear({ isBlocked: true }, {});
    const res = await criar();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/bloqueada/i);
    expect(estado.db.collection('grupos').docs).toHaveLength(0);
    expect(estado.db.collection('membrosGrupo').docs).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('nega 403 quando a sessão traz isBlocked', async () => {
    semear({}, { isBlocked: true });
    const res = await criar();
    expect(res.statusCode).toBe(403);
    expect(estado.db.collection('grupos').docs).toHaveLength(0);
  });

  it('mantém 201 para usuário não bloqueado (isBlocked false)', async () => {
    semear({ isBlocked: false }, { isBlocked: false });
    const res = await criar();
    expect(res.statusCode).toBe(201);
    expect(estado.db.collection('grupos').docs).toHaveLength(1);
    expect(estado.db.collection('membrosGrupo').docs).toHaveLength(1);
  });

  it('mantém 201 para usuário sem o campo isBlocked (legado)', async () => {
    const res = await criar();
    expect(res.statusCode).toBe(201);
  });
});
