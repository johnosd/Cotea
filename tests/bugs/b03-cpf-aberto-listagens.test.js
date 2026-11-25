// Regressão B-03: CPF nunca aberto em listagens administrativas; completo só
// para o financeiro, em saque aberto, pelo endpoint dedicado (RN CPF mascarado).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';

process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');

const estado = vi.hoisted(() => ({ db: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/ratelimit', () => ({ getClientIp: () => '127.0.0.1' }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  getWalletByUser: vi.fn(),
  createWallet: vi.fn(),
}));

const { encryptCPF } = await import('../../lib/encryption.js');
const { mascararCPF } = await import('../../lib/cpf-mascara.js');
const { logAudit } = await import('../../lib/audit');
const { default: handlerUsuarios } = await import('../../pages/api/admin/users/index.js');
const { default: handlerLista } = await import('../../pages/api/withdraw/list.js');
const { default: handlerChavePix } = await import('../../pages/api/withdraw/chave-pix.js');

const CPF = '12345678901';
const CPF_FORMATADO = '123.456.789-01';

const colecao = (docs) => ({
  find: () => {
    const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => docs.map((d) => ({ ...d })) };
    return cursor;
  },
  findOne: async (filtro) => {
    const d = docs.find((x) => x._id === filtro._id);
    return d ? { ...d } : null;
  },
});

const criarRes = () => {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const sessao = (systemRole) => ({ user: { id: 'u-admin', email: `${systemRole}@teste`, systemRole } });

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
  estado.session = sessao('support');
  estado.db = {
    collection: (nome) => {
      if (nome === 'users') {
        return colecao([
          { _id: 'u1', nome: 'Ana', email: 'ana@teste', cpf: encryptCPF(CPF), systemRole: 'user' },
          { _id: 'u2', nome: 'Legado', email: 'leg@teste', cpf: CPF, systemRole: 'user' },
          { _id: 'u3', nome: 'Sem', email: 'sem@teste', systemRole: 'user' },
        ]);
      }
      if (nome === 'withdrawals') {
        return colecao([
          { _id: 'w1', userId: 'u1', walletId: 'wal1', pixKeyCpf: encryptCPF(CPF), amount: 50, status: 'requested' },
          { _id: 'w2', userId: 'u1', walletId: 'wal1', pixKeyCpf: encryptCPF(CPF), amount: 20, status: 'paid' },
        ]);
      }
      throw new Error(`colecao inesperada ${nome}`);
    },
  };
  vi.mocked(logAudit).mockClear();
});

const chamar = async (handler, req) => {
  const res = criarRes();
  await handler({ method: 'GET', query: {}, headers: {}, socket: {}, ...req }, res);
  return res;
};

describe('mascararCPF', () => {
  it('mascara no formato ***.456.789-** com ou sem pontuação', () => {
    expect(mascararCPF(CPF)).toBe('***.456.789-**');
    expect(mascararCPF(CPF_FORMATADO)).toBe('***.456.789-**');
  });

  it('vazio vira vazio; ciphertext, nulo e tamanho errado nunca vazam', () => {
    expect(mascararCPF('')).toBe('');
    expect(mascararCPF(undefined)).toBe('');
    expect(mascararCPF(null)).toBe('');
    expect(mascararCPF('123')).toBe('***.***.***-**');
    const cifrado = encryptCPF(CPF);
    expect(mascararCPF(cifrado)).toBe('***.***.***-**');
  });
});

describe('GET /api/admin/users', () => {
  it('support recebe o CPF só mascarado, nunca em claro (o bug)', async () => {
    const res = await chamar(handlerUsuarios, {});
    expect(res.statusCode).toBe(200);
    expect(res.body.map((u) => u.cpf)).toEqual(['***.456.789-**', '***.456.789-**', '']);
    expect(JSON.stringify(res.body)).not.toContain(CPF);
    expect(JSON.stringify(res.body)).not.toContain(CPF.slice(0, 3));
  });

  it('usuário comum continua sem acesso', async () => {
    estado.session = sessao('user');
    expect((await chamar(handlerUsuarios, {})).statusCode).toBe(403);
  });
});

describe('GET /api/withdraw/list', () => {
  it('support é negado (listagem restrita a finance/admin, como a aba)', async () => {
    estado.session = sessao('support');
    const res = await chamar(handlerLista, {});
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(CPF);
  });

  it.each(['finance', 'admin'])('%s não recebe pixKeyCpf cifrado nem CPF; recebe o mascarado', async (papel) => {
    estado.session = sessao(papel);
    const res = await chamar(handlerLista, {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const w of res.body) {
      expect(w).not.toHaveProperty('pixKeyCpf');
      expect(w.pixKeyCpfMascarado).toBe('***.456.789-**');
    }
    expect(res.body[0]).toMatchObject({ _id: 'w1', amount: 50, status: 'requested' });
    expect(JSON.stringify(res.body)).not.toContain(CPF);
  });
});

describe('GET /api/withdraw/chave-pix', () => {
  it('support é negado e não recebe CPF', async () => {
    const res = await chamar(handlerChavePix, { query: { withdrawalId: 'w1' } });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(CPF);
  });

  it('finance recebe o CPF completo de saque em aberto e fica auditado sem o CPF', async () => {
    estado.session = sessao('finance');
    const res = await chamar(handlerChavePix, { query: { withdrawalId: 'w1' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.cpf).toBe(CPF);
    expect(vi.mocked(logAudit)).toHaveBeenCalledTimes(1);
    const auditoria = vi.mocked(logAudit).mock.calls[0][0];
    expect(auditoria).toMatchObject({ action: 'withdrawal.cpf_viewed', targetId: 'w1' });
    expect(JSON.stringify(auditoria)).not.toContain(CPF);
  });

  it('saque já finalizado não devolve CPF; inexistente é 404; sem id é 400', async () => {
    estado.session = sessao('finance');
    const finalizado = await chamar(handlerChavePix, { query: { withdrawalId: 'w2' } });
    expect(finalizado.statusCode).toBe(400);
    expect(JSON.stringify(finalizado.body)).not.toContain(CPF);
    expect((await chamar(handlerChavePix, { query: { withdrawalId: 'nao-existe' } })).statusCode).toBe(404);
    expect((await chamar(handlerChavePix, { query: {} })).statusCode).toBe(400);
  });

  it('sem sessão é 401 e bloqueado é 403', async () => {
    estado.session = null;
    expect((await chamar(handlerChavePix, { query: { withdrawalId: 'w1' } })).statusCode).toBe(401);
    estado.session = { user: { id: 'x', systemRole: 'finance', isBlocked: true } };
    expect((await chamar(handlerChavePix, { query: { withdrawalId: 'w1' } })).statusCode).toBe(403);
  });
});
