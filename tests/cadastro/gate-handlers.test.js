// Gate real (lib/cadastro-financeiro-servidor) ligado aos handlers — 004, T019 (FR-011, FR-017).
// "Passou do gate" = o handler seguiu para a validação seguinte (400 de corpo) em vez do 409.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = 'd'.repeat(64);
  return { db: null, session: null };
});
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  insertPayment: vi.fn(),
  insertWithdrawal: vi.fn(),
}));
vi.mock('../../lib/wallet', async (importOriginal) => ({ ...(await importOriginal()), ensureWallet: vi.fn(async () => ({ _id: 'w' })) }));
vi.mock('../../lib/ledger/servidor', () => ({ obterLedger: vi.fn() }));
vi.mock('../../lib/ratelimit', async (importOriginal) => ({ ...(await importOriginal()), checkRateLimit: vi.fn(async () => ({ allowed: true })) }));

const { encryptCPF, decryptCPF } = await import('../../lib/encryption.js');
const mongo = await import('../../lib/mongodb');
const handlers = {
  pay: (await import('../../pages/api/assinaturas/pay.js')).default,
  pix: (await import('../../pages/api/pix/simulated/create.js')).default,
  saque: (await import('../../pages/api/withdraw/create.js')).default,
  usoSaldo: (await import('../../pages/api/wallet/pay.js')).default,
  grupos: (await import('../../pages/api/grupos/index.js')).default,
};

const id = new ObjectId();
const COMPLETO = {
  cpf: encryptCPF('52998224725'),
  endereco: { cep: '01001000', uf: 'SP', cidade: 'Sao Paulo', bairro: 'Se', rua: 'Praca', numero: '1', complemento: '', cepConfirmado: true },
};
const corpos = { pay: {}, pix: { amount: 0 }, saque: { amount: 0 }, usoSaldo: { amount: 0 }, grupos: {} };
const chamar = async (nome) => {
  const res = criarRes();
  await handlers[nome]({ method: 'POST', body: corpos[nome], headers: {}, socket: {} }, res);
  return res;
};
const semear = (extra) => {
  estado.db = criarDbMemoria();
  estado.db.collection('users').docs.push({ _id: id, email: 'u@teste', ...extra });
  estado.session = { user: { id: String(id), email: 'u@teste', contaValidada: true, systemRole: 'user', isBlocked: extra.isBlocked } };
};

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

describe('gate real nos handlers financeiros', () => {
  it('cadastro incompleto: as cinco ações devolvem 409 com as pendências', async () => {
    for (const nome of Object.keys(handlers)) {
      semear({ cpf: encryptCPF('52998224725') });
      const res = await chamar(nome);
      expect(res.statusCode, nome).toBe(409);
      expect(res.body, nome).toMatchObject({ codigo: 'cadastro_financeiro_incompleto', pendencias: ['endereco'] });
    }
  });

  it('bloqueado com cadastro completo passa do gate em pagar, depositar, sacar e usar saldo (FR-017)', async () => {
    for (const nome of ['pay', 'pix', 'saque', 'usoSaldo']) {
      semear({ ...COMPLETO, isBlocked: true });
      const res = await chamar(nome);
      expect(res.statusCode, nome).toBe(400);
    }
  });

  it('bloqueado com cadastro completo recebe 403 de conta bloqueada ao criar grupo (não 409)', async () => {
    semear({ ...COMPLETO, isBlocked: true });
    const res = await chamar('grupos');
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/bloqueada/i);
  });

  it('bloqueado com cadastro incompleto também é barrado pelo gate ao pagar', async () => {
    semear({ isBlocked: true });
    expect((await chamar('pay')).statusCode).toBe(409);
  });

  it('PIX sem cpf no corpo e cadastro completo cria o pagamento com o CPF do perfil (antes: 400) — FR-015', async () => {
    semear(COMPLETO);
    vi.mocked(mongo.insertPayment).mockResolvedValueOnce({ _id: 'p1', status: 'pending', amount: 10 });
    const res = criarRes();
    await handlers.pix({ method: 'POST', body: { amount: 10 }, headers: {}, socket: {} }, res);
    expect(res.statusCode).toBe(201);
    expect(decryptCPF(vi.mocked(mongo.insertPayment).mock.calls.at(-1)[0].pixCpf)).toBe('52998224725');
  });
});
