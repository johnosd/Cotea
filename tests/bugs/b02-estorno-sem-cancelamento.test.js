// Regressão B-02: POST /api/assinaturas/refund só pode estornar como compensação
// de falha de entrada (usuário não é membro e a fatura não foi vinculada a uma
// entrada). Sessão, Mongo e ledger mockados; banco em memória.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';
import { avaliarEstorno, MOTIVO_ESTORNO } from '../../lib/estorno.js';

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
  ensureWallet: vi.fn(async () => ({ _id: 'wallet-usuario' })),
  calculateBalances: vi.fn(async () => ({ balance: 10, available: 10 })),
}));
vi.mock('../../lib/ledger/servidor', () => ({
  obterLedger: vi.fn(async () => ({
    registrarOperacao: async (op) => {
      estado.operacoes.push(op);
      const lancamentos = op.pernas.map((p, i) => ({ _id: `lanc-${i}`, ...p }));
      const resultadoExtra = op.extra ? await op.extra({ sessao: null, lancamentos }) : undefined;
      return { criada: true, lancamentos, resultadoExtra };
    },
  })),
}));

const { default: handler } = await import('../../pages/api/assinaturas/refund.js');

const usuarioId = new ObjectId();
const outroId = new ObjectId();
const grupoId = new ObjectId();

const semearFatura = (campos = {}) => {
  const fatura = {
    _id: 'inv-1',
    userId: String(usuarioId),
    grupoId: String(grupoId),
    amount: 10,
    status: 'paga',
    ...campos,
  };
  estado.db.collection('invoices').docs.push(fatura);
  return fatura;
};

const semearMembro = (campos = {}) =>
  estado.db.collection('membrosGrupo').docs.push({
    _id: new ObjectId(), grupoId, userId: usuarioId, papel: 'membro', status: 'ativo', ...campos,
  });

const estornar = async (body = { invoiceId: 'inv-1' }) => {
  const res = criarRes();
  await handler({ method: 'POST', body, headers: {}, socket: {} }, res);
  return res;
};

const fatura = () => estado.db.collection('invoices').docs[0];

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.operacoes = [];
  estado.session = { user: { id: String(usuarioId), email: 'u@teste' } };
});

describe('avaliarEstorno — regra pura', () => {
  it('nega para qualquer registro de membro, inclusive banido', () => {
    expect(avaliarEstorno({ invoice: {}, membro: { status: 'ativo' } })).toEqual({ permitido: false, motivo: MOTIVO_ESTORNO.MEMBRO_DO_GRUPO });
    expect(avaliarEstorno({ invoice: {}, membro: { status: 'banido' } }).permitido).toBe(false);
  });

  it('nega fatura já vinculada a uma entrada (entrou e saiu)', () => {
    expect(avaliarEstorno({ invoice: { membroId: new ObjectId() }, membro: null })).toEqual({ permitido: false, motivo: MOTIVO_ESTORNO.FATURA_VINCULADA });
    expect(avaliarEstorno({ invoice: { vinculadoEm: new Date() }, membro: null }).permitido).toBe(false);
  });

  it('permite quando não é membro e a fatura não foi vinculada', () => {
    expect(avaliarEstorno({ invoice: {}, membro: null })).toEqual({ permitido: true });
  });
});

describe('POST /api/assinaturas/refund', () => {
  it('membro ativo não consegue estornar (o bug reportado): 409, sem crédito e fatura segue paga', async () => {
    semearFatura({ membroId: new ObjectId(), vinculadoEm: new Date() });
    semearMembro();
    const res = await estornar();
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('estorno_indisponivel');
    expect(estado.operacoes).toHaveLength(0);
    expect(fatura().status).toBe('paga');
  });

  it('membro ativo sem vínculo na fatura também é negado', async () => {
    semearFatura();
    semearMembro();
    expect((await estornar()).statusCode).toBe(409);
    expect(estado.operacoes).toHaveLength(0);
  });

  it('quem entrou e saiu (fatura vinculada, sem registro de membro) é negado', async () => {
    semearFatura({ membroId: new ObjectId(), vinculadoEm: new Date() });
    const res = await estornar();
    expect(res.statusCode).toBe(409);
    expect(res.body.motivo).toBe(MOTIVO_ESTORNO.FATURA_VINCULADA);
    expect(estado.operacoes).toHaveLength(0);
    expect(fatura().status).toBe('paga');
  });

  it('caminho legítimo: pagou, join falhou (não é membro, fatura não vinculada) → estorna', async () => {
    semearFatura();
    semearMembro({ userId: outroId }); // outro membro no mesmo grupo não interfere
    const res = await estornar();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ invoiceId: 'inv-1', status: 'estornada', walletId: 'wallet-usuario' });
    expect(estado.operacoes).toHaveLength(1);
    expect(estado.operacoes[0]).toMatchObject({ operacaoId: 'estorno_assinatura:inv-1', source: 'estorno_assinatura' });
    expect(estado.operacoes[0].pernas[0]).toMatchObject({ type: 'credit', categoria: 'pessoal', valor: 10 });
    expect(fatura().status).toBe('estornada');
  });

  it('fatura de outro usuário continua 404', async () => {
    semearFatura({ userId: String(outroId) });
    expect((await estornar()).statusCode).toBe(404);
    expect(estado.operacoes).toHaveLength(0);
  });

  it('fatura já estornada é idempotente (200) mesmo com o usuário sendo membro', async () => {
    semearFatura({ status: 'estornada' });
    semearMembro();
    const res = await estornar();
    expect(res.statusCode).toBe(200);
    expect(estado.operacoes).toHaveLength(0);
  });

  it('fatura não paga continua 400', async () => {
    semearFatura({ status: 'aguardando_pagamento' });
    expect((await estornar()).statusCode).toBe(400);
  });

  it('sem sessão continua 401', async () => {
    estado.session = null;
    semearFatura();
    expect((await estornar()).statusCode).toBe(401);
  });
});
