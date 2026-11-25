// Regressao pay-aceita-fatura-estornada: `pay` nao reaproveita nem reabre fatura
// estornada (ou de status desconhecido). O ledger mockado repete o comportamento real:
// operacaoId repetido devolve `criada:false` e NAO executa `extra`.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null, operacoes: [], audits: [] }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async (a) => { estado.audits.push(a); }) }));
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
      const existente = estado.operacoes.find((o) => o.operacaoId === op.operacaoId);
      if (existente) return { criada: false, lancamentos: existente.lancamentos };
      const lancamentos = op.pernas.map((p, i) => ({ _id: `lanc-${op.operacaoId}-${i}`, ...p }));
      estado.operacoes.push({ ...op, lancamentos });
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
const donoId = new ObjectId();

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.operacoes = [];
  estado.audits = [];
  estado.session = { user: { id: String(membroId), email: 'membro@teste', contaValidada: true } };
});

const semearGrupo = () => {
  const _id = new ObjectId();
  estado.db.collection('grupos').docs.push({
    _id, nome: 'Grupo', capacidadeTotal: 4, status: 'ativo', adminId: donoId,
    valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true,
  });
  estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId: _id, userId: donoId, papel: 'admin', status: 'ativo' });
  return _id;
};

const semearFatura = (grupoId, status, extra = {}) => {
  const fatura = { _id: 'fatura-1', userId: String(membroId), grupoId: String(grupoId), amount: 10.5, status, ...extra };
  estado.db.collection('invoices').docs.push(fatura);
  return fatura;
};

const pagar = async (body) => {
  const res = criarRes();
  await handlerPay({ method: 'POST', body, headers: {}, socket: {} }, res);
  return res;
};

const faturaNoBanco = () => estado.db.collection('invoices').docs[0];

describe('POST /api/assinaturas/pay — fatura existente so segue em status valido', () => {
  it('estornada com debito original no ledger: 409 fatura_estornada, sem lancamento, audit nem mudanca de status', async () => {
    const grupoId = semearGrupo();
    semearFatura(grupoId, 'estornada');
    // debito original da assinatura (a repeticao do operacaoId seria criada:false)
    estado.operacoes.push({ operacaoId: 'assinatura_grupo:fatura-1', lancamentos: [{ _id: 'debito-antigo' }] });
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-1' });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('fatura_estornada');
    expect(estado.operacoes).toHaveLength(1);
    expect(estado.audits).toHaveLength(0);
    expect(faturaNoBanco().status).toBe('estornada');
  });

  it('estornada sem debito previo (legado): nao cobra de novo nem reabre a fatura', async () => {
    const grupoId = semearGrupo();
    semearFatura(grupoId, 'estornada');
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-1' });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('fatura_estornada');
    expect(estado.operacoes).toHaveLength(0);
    expect(faturaNoBanco().status).toBe('estornada');
  });

  it.each(['cancelada', 'pending', undefined])('status desconhecido (%s): 409 fatura_indisponivel, sem lancamento', async (status) => {
    const grupoId = semearGrupo();
    semearFatura(grupoId, status);
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-1' });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('fatura_indisponivel');
    expect(estado.operacoes).toHaveLength(0);
    expect(faturaNoBanco().status).toBe(status);
  });

  it('fatura estornada de outro usuario continua 404 (nao vaza status)', async () => {
    const grupoId = semearGrupo();
    semearFatura(grupoId, 'estornada', { userId: String(new ObjectId()) });
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-1' });
    expect(res.statusCode).toBe(404);
  });

  it('paga continua reconciliando 200 sem novo lancamento', async () => {
    const grupoId = semearGrupo();
    semearFatura(grupoId, 'paga', { paidAt: new Date() });
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('paga');
    expect(estado.operacoes).toHaveLength(0);
  });

  it.each(['aguardando_pagamento', 'aguardando_recarga'])('%s: cobra normalmente e marca paga', async (status) => {
    const grupoId = semearGrupo();
    semearFatura(grupoId, status);
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('paga');
    expect(estado.operacoes).toHaveLength(1);
    expect(estado.operacoes[0]).toMatchObject({ operacaoId: 'assinatura_grupo:fatura-1', source: 'assinatura_grupo' });
    expect(estado.operacoes[0].pernas[0]).toMatchObject({ type: 'debit', categoria: 'pessoal', valor: 10.5 });
    expect(faturaNoBanco().status).toBe('paga');
    expect(estado.audits).toHaveLength(1);
  });

  it('fatura aberta cujo debito ja existe (clique duplo) e ainda nao marcada paga: 409, nunca "paga" falso', async () => {
    const grupoId = semearGrupo();
    semearFatura(grupoId, 'aguardando_pagamento');
    estado.operacoes.push({ operacaoId: 'assinatura_grupo:fatura-1', lancamentos: [{ _id: 'debito' }] });
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-1' });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('fatura_inconsistente');
    expect(estado.audits).toHaveLength(0);
  });

  it('fatura aberta cujo debito ja existe e fatura ja paga (corrida resolvida): 200 reconciliando', async () => {
    const grupoId = semearGrupo();
    semearFatura(grupoId, 'aguardando_pagamento');
    // a fatura vira paga entre a leitura inicial e a releitura pos-ledger
    estado.operacoes.push({
      operacaoId: 'assinatura_grupo:fatura-1',
      get lancamentos() { faturaNoBanco().status = 'paga'; return [{ _id: 'debito' }]; },
    });
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('paga');
    expect(estado.audits).toHaveLength(0);
  });
});
