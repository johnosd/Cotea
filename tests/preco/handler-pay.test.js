// Testes do handler de cobrança com a regra única (003-preco-por-vaga, US2).
// Sessão, Mongo e núcleo do ledger mockados; banco em memória.
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
  calculateBalances: vi.fn(async () => ({ available: 100 })),
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

// 004-cadastro-financeiro: o gate de cadastro financeiro é testado em tests/cadastro e no contrato 004;
// aqui o usuário tem cadastro completo para o handler seguir como antes.
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({
  verificarCadastroFinanceiro: vi.fn(async () => ({ ok: true, cpf: '52998224725', usuario: {} })),
}));

const { default: handlerPay } = await import('../../pages/api/assinaturas/pay.js');

const membroId = new ObjectId();

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.operacoes = [];
  estado.session = { user: { id: String(membroId), email: 'membro@teste', contaValidada: true } };
});

const pagar = async (body) => {
  const res = criarRes();
  await handlerPay({ method: 'POST', body, headers: {}, socket: {} }, res);
  return res;
};

const semearGrupo = (campos) => {
  const _id = new ObjectId();
  estado.db.collection('grupos').docs.push({ _id, nome: 'Grupo', ...campos });
  return _id;
};

describe('POST /api/assinaturas/pay — preço único (US2)', () => {
  it('cobra o valor por vaga gravado e grava a composição, ignorando amount do body (US2-AC1)', async () => {
    const grupoId = semearGrupo({ valorTotal: 40, capacidadeTotal: 4, valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true });
    const res = await pagar({ grupoId: String(grupoId), amount: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.body.amount).toBe(10.5);
    const [fatura] = estado.db.collection('invoices').docs;
    expect(fatura.amount).toBe(10.5);
    expect(fatura.composicao).toEqual({ repasseDono: 10, taxaCotea: 0.5 });
    expect(estado.operacoes).toHaveLength(1);
    expect(estado.operacoes[0].pernas).toHaveLength(1);
    expect(estado.operacoes[0].pernas[0]).toMatchObject({ type: 'debit', categoria: 'pessoal', valor: 10.5 });
  });

  it('recusa com 409 grupo legado sem preço válido, sem fallback e sem criar fatura (US2-AC2)', async () => {
    const grupoId = semearGrupo({ valorTotal: 40, capacidadeTotal: 4, valorPorVaga: 10 });
    const res = await pagar({ grupoId: String(grupoId), amount: 40 });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'preco_indisponivel' });
    expect(estado.db.collection('invoices').docs).toHaveLength(0);
    expect(estado.operacoes).toHaveLength(0);
  });

  it('fatura existente é cobrada pelo próprio valor congelado, não pelo preço atual (FR-016)', async () => {
    const grupoId = semearGrupo({ valorPorVaga: 21, repassePorVaga: 20, taxaPorVaga: 1, precoValido: true });
    estado.db.collection('invoices').docs.push({
      _id: 'fatura-antiga', userId: String(membroId), grupoId: String(grupoId), amount: 10, status: 'aguardando_recarga',
    });
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-antiga' });
    expect(res.statusCode).toBe(200);
    expect(estado.operacoes[0].pernas[0].valor).toBe(10);
    expect(estado.db.collection('invoices').docs[0]).not.toHaveProperty('composicao');
  });
});
