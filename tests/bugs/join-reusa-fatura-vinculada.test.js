// Regressao: uma fatura paga da direito a uma entrada. Fatura ja vinculada a uma
// participacao (mesmo encerrada via DELETE) nao pode criar outra via POST join.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null, operacoes: [] }));

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
vi.mock('../../lib/wallet', async (importOriginal) => ({
  ...(await importOriginal()),
  ensureWallet: vi.fn(async () => ({ _id: 'wallet-membro' })),
}));
vi.mock('../../lib/ledger/servidor', () => ({
  obterLedger: vi.fn(async () => ({
    registrarOperacao: async (op) => {
      estado.operacoes.push(op);
      return { criada: true, lancamentos: op.pernas.map((p, i) => ({ _id: `l-${i}`, ...p })) };
    },
  })),
}));

const { default: handlerJoin } = await import('../../pages/api/grupos/[id]/join.js');

const membroId = new ObjectId();
const donoId = new ObjectId();
let grupoId;

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.operacoes = [];
  estado.session = { user: { id: String(membroId), email: 'm@teste', contaValidada: true } };
  grupoId = new ObjectId();
  estado.db.collection('grupos').docs.push({ _id: grupoId, nome: 'G', capacidadeTotal: 4, status: 'ativo', adminId: donoId });
  estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId, userId: donoId, papel: 'admin', status: 'ativo' });
});

const semearFatura = (id, extra = {}) => {
  const f = { _id: id, userId: String(membroId), grupoId: String(grupoId), amount: 10.5, status: 'paga', paidAt: new Date(), ...extra };
  estado.db.collection('invoices').docs.push(f);
  return f;
};
const fatura = (id) => estado.db.collection('invoices').docs.find((f) => f._id === id);
const meusMembros = () => estado.db.collection('membrosGrupo').docs.filter((m) => String(m.userId) === String(membroId));

const chamar = async (req) => {
  const res = criarRes();
  await handlerJoin({ headers: {}, socket: {}, query: { id: String(grupoId) }, ...req }, res);
  return res;
};
const entrar = (invoiceId) => chamar({ method: 'POST', body: { invoiceId } });
const sair = () => chamar({ method: 'DELETE', body: { userId: String(membroId) } });

describe('POST /api/grupos/[id]/join — fatura vinculada nao gera nova entrada', () => {
  it('entrar, sair e reentrar com a mesma fatura: 409 fatura_ja_utilizada, sem membro e sem estorno', async () => {
    semearFatura('f1');
    expect((await entrar('f1')).statusCode).toBe(200);
    expect(meusMembros()).toHaveLength(1);

    expect((await sair()).statusCode).toBe(200);
    expect(meusMembros()).toHaveLength(0);

    const res = await entrar('f1');
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'fatura_ja_utilizada', estornada: false });
    expect(meusMembros()).toHaveLength(0);
    expect(estado.operacoes).toHaveLength(0);
    expect(fatura('f1').status).toBe('paga');
  });

  it('o vinculo (membroId/vinculadoEm) permanece gravado apos sair e apos tentativa negada (regra do refund B-02)', async () => {
    semearFatura('f1');
    await entrar('f1');
    const { membroId: vinculo, vinculadoEm } = fatura('f1');
    expect(vinculo).toBeTruthy();
    await sair();
    await entrar('f1');
    expect(fatura('f1').membroId).toEqual(vinculo);
    expect(fatura('f1').vinculadoEm).toEqual(vinculadoEm);
  });

  it('fatura vinculada a membro que nao existe mais: 409', async () => {
    semearFatura('f1', { membroId: new ObjectId(), vinculadoEm: new Date() });
    const res = await entrar('f1');
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('fatura_ja_utilizada');
    expect(meusMembros()).toHaveLength(0);
  });

  it('so um dos campos de vinculo ja basta para negar', async () => {
    semearFatura('f1', { vinculadoEm: new Date() });
    semearFatura('f2', { membroId: new ObjectId() });
    expect((await entrar('f1')).statusCode).toBe(409);
    expect((await entrar('f2')).statusCode).toBe(409);
    expect(meusMembros()).toHaveLength(0);
  });

  it('caso idempotente: ja e membro com a mesma fatura vinculada -> 200 e vinculo intacto', async () => {
    semearFatura('f1');
    await entrar('f1');
    const antes = { ...fatura('f1') };
    const res = await entrar('f1');
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Usuario ja e membro');
    expect(meusMembros()).toHaveLength(1);
    expect(fatura('f1').membroId).toEqual(antes.membroId);
    expect(fatura('f1').vinculadoEm).toEqual(antes.vinculadoEm);
  });

  it('ja e membro e chama com outra fatura ja vinculada: 200 e nao reescreve o vinculo dela', async () => {
    semearFatura('f1');
    await entrar('f1');
    const antiga = new ObjectId();
    const data = new Date('2026-01-01');
    semearFatura('f2', { membroId: antiga, vinculadoEm: data });
    const res = await entrar('f2');
    expect(res.statusCode).toBe(200);
    expect(fatura('f2').membroId).toEqual(antiga);
    expect(fatura('f2').vinculadoEm).toEqual(data);
  });

  it('ja e membro com fatura ainda livre: reconciliacao continua vinculando', async () => {
    estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId, userId: membroId, papel: 'membro', status: 'ativo' });
    semearFatura('f1');
    const res = await entrar('f1');
    expect(res.statusCode).toBe(200);
    expect(fatura('f1').membroId).toBeTruthy();
    expect(fatura('f1').vinculadoEm).toBeInstanceOf(Date);
  });

  it('pagando uma fatura nova depois de sair, a reentrada e permitida', async () => {
    semearFatura('f1');
    await entrar('f1');
    await sair();
    semearFatura('f2');
    const res = await entrar('f2');
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Membro adicionado');
    expect(meusMembros()).toHaveLength(1);
    expect(fatura('f2').membroId).toBeTruthy();
  });

  it('primeira entrada com fatura livre continua funcionando', async () => {
    semearFatura('f1');
    const res = await entrar('f1');
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Membro adicionado');
  });
});
