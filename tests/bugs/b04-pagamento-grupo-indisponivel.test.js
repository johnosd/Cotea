// Regressao B-04: pagamento de grupo indisponivel. `pay` nao cobra quando a entrada e
// impossivel; `join` valida status e compensa no servidor (estorno via ledger) quando a
// fatura ja paga nao consegue virar vaga. Sessao, Mongo e ledger mockados.
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
const { default: handlerJoin } = await import('../../pages/api/grupos/[id]/join.js');

const membroId = new ObjectId();
const donoId = new ObjectId();
const precoOk = { valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true };

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.operacoes = [];
  estado.session = { user: { id: String(membroId), email: 'membro@teste', contaValidada: true } };
});

const semearGrupo = (campos = {}, { membros = 1 } = {}) => {
  const _id = new ObjectId();
  estado.db.collection('grupos').docs.push({
    _id, nome: 'Grupo', capacidadeTotal: 4, status: 'ativo', adminId: donoId, ...precoOk, ...campos,
  });
  const col = estado.db.collection('membrosGrupo').docs;
  if (membros >= 1) col.push({ _id: new ObjectId(), grupoId: _id, userId: donoId, papel: 'admin', status: 'ativo' });
  for (let i = 1; i < membros; i += 1) {
    col.push({ _id: new ObjectId(), grupoId: _id, userId: new ObjectId(), papel: 'membro', status: 'ativo' });
  }
  return _id;
};

const pagar = async (body) => {
  const res = criarRes();
  await handlerPay({ method: 'POST', body, headers: {}, socket: {} }, res);
  return res;
};

const entrar = async (grupoId, invoiceId) => {
  const res = criarRes();
  await handlerJoin({ method: 'POST', query: { id: String(grupoId) }, body: { invoiceId }, headers: {}, socket: {} }, res);
  return res;
};

const semearFaturaPaga = (grupoId, extra = {}) => {
  const fatura = {
    _id: 'fatura-paga', userId: String(membroId), grupoId: String(grupoId), amount: 10.5, status: 'paga',
    paidAt: new Date(), ...extra,
  };
  estado.db.collection('invoices').docs.push(fatura);
  return fatura;
};

const semNadaCobrado = () => {
  expect(estado.db.collection('invoices').docs).toHaveLength(0);
  expect(estado.operacoes).toHaveLength(0);
};

describe('POST /api/assinaturas/pay — nao cobra quando a entrada e impossivel (B-04)', () => {
  it.each(['inativo', 'cancelado'])('grupo %s: 409 grupo_indisponivel, sem fatura nem debito', async (status) => {
    const grupoId = semearGrupo({ status });
    const res = await pagar({ grupoId: String(grupoId) });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('grupo_indisponivel');
    semNadaCobrado();
  });

  it('grupo cheio: 409 grupo_cheio, sem fatura nem debito', async () => {
    const grupoId = semearGrupo({ capacidadeTotal: 3 }, { membros: 3 });
    const res = await pagar({ grupoId: String(grupoId) });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('grupo_cheio');
    semNadaCobrado();
  });

  it('banidos nao ocupam vaga: grupo com banido ainda cobra', async () => {
    const grupoId = semearGrupo({ capacidadeTotal: 2 }, { membros: 1 });
    estado.db.collection('membrosGrupo').docs.push({ grupoId, userId: new ObjectId(), papel: 'membro', status: 'banido' });
    const res = await pagar({ grupoId: String(grupoId) });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('paga');
  });

  it('dono do grupo (adminId): 409 dono_do_grupo', async () => {
    estado.session = { user: { id: String(donoId), email: 'dono@teste', contaValidada: true } };
    const grupoId = semearGrupo();
    const res = await pagar({ grupoId: String(grupoId) });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('dono_do_grupo');
    semNadaCobrado();
  });

  it('membro com papel admin (sem adminId no grupo): 409 dono_do_grupo', async () => {
    const grupoId = semearGrupo({ adminId: undefined });
    estado.db.collection('membrosGrupo').docs.push({ grupoId, userId: membroId, papel: 'admin', status: 'ativo' });
    const res = await pagar({ grupoId: String(grupoId) });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('dono_do_grupo');
    semNadaCobrado();
  });

  it('ja membro: 409 ja_membro', async () => {
    const grupoId = semearGrupo();
    estado.db.collection('membrosGrupo').docs.push({ grupoId, userId: membroId, papel: 'membro', status: 'ativo' });
    const res = await pagar({ grupoId: String(grupoId) });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('ja_membro');
    semNadaCobrado();
  });

  it('membro banido: 403 membro_banido', async () => {
    const grupoId = semearGrupo();
    estado.db.collection('membrosGrupo').docs.push({ grupoId, userId: membroId, papel: 'membro', status: 'banido' });
    const res = await pagar({ grupoId: String(grupoId) });
    expect(res.statusCode).toBe(403);
    expect(res.body.codigo).toBe('membro_banido');
    semNadaCobrado();
  });

  it('fatura existente nao paga tambem e barrada (grupo cancelado depois da emissao)', async () => {
    const grupoId = semearGrupo({ status: 'cancelado' });
    estado.db.collection('invoices').docs.push({
      _id: 'fatura-aberta', userId: String(membroId), grupoId: String(grupoId), amount: 10.5, status: 'aguardando_recarga',
    });
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-aberta' });
    expect(res.statusCode).toBe(409);
    expect(estado.operacoes).toHaveLength(0);
  });

  it('fatura ja paga continua 200 mesmo com grupo cheio/cancelado (reconciliacao preservada)', async () => {
    const grupoId = semearGrupo({ status: 'cancelado', capacidadeTotal: 2 }, { membros: 2 });
    semearFaturaPaga(grupoId);
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-paga' });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('paga');
    expect(estado.operacoes).toHaveLength(0);
  });

  it('grupo ativo com vaga e status ausente (legado) cobram normalmente', async () => {
    const ativo = semearGrupo();
    expect((await pagar({ grupoId: String(ativo) })).statusCode).toBe(200);
    const legado = semearGrupo({ status: undefined });
    expect((await pagar({ grupoId: String(legado) })).statusCode).toBe(200);
    expect(estado.operacoes).toHaveLength(2);
  });
});

describe('POST /api/grupos/[id]/join — status e compensacao no servidor (B-04)', () => {
  it('grupo cancelado com fatura paga: 409, sem membro, estorno server-side pelo ledger', async () => {
    const grupoId = semearGrupo({ status: 'cancelado' });
    semearFaturaPaga(grupoId);
    const antes = estado.db.collection('membrosGrupo').docs.length;
    const res = await entrar(grupoId, 'fatura-paga');
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'grupo_indisponivel', estornada: true });
    expect(estado.db.collection('membrosGrupo').docs).toHaveLength(antes);
    expect(estado.operacoes).toHaveLength(1);
    expect(estado.operacoes[0]).toMatchObject({ operacaoId: 'estorno_assinatura:fatura-paga', source: 'estorno_assinatura' });
    expect(estado.operacoes[0].pernas[0]).toMatchObject({ type: 'credit', categoria: 'pessoal', valor: 10.5 });
    expect(estado.db.collection('invoices').docs[0].status).toBe('estornada');
  });

  it('grupo cheio com fatura paga: 409 grupo_cheio e estorna; repetir nao estorna de novo', async () => {
    const grupoId = semearGrupo({ capacidadeTotal: 2 }, { membros: 2 });
    semearFaturaPaga(grupoId);
    const res = await entrar(grupoId, 'fatura-paga');
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'grupo_cheio', estornada: true });
    // segunda chamada: fatura ja estornada nao e "paga" -> 402, nenhum novo lancamento
    const res2 = await entrar(grupoId, 'fatura-paga');
    expect(res2.statusCode).toBe(402);
    expect(estado.operacoes).toHaveLength(1);
  });

  it('nao estorna fatura ja vinculada a uma entrada anterior', async () => {
    const grupoId = semearGrupo({ status: 'cancelado' });
    semearFaturaPaga(grupoId, { vinculadoEm: new Date(), membroId: new ObjectId() });
    const res = await entrar(grupoId, 'fatura-paga');
    expect(res.statusCode).toBe(409);
    expect(res.body.estornada).toBe(false);
    expect(estado.operacoes).toHaveLength(0);
  });

  it('quem ja e membro continua reconciliando (200) mesmo com grupo cancelado ou cheio', async () => {
    const grupoId = semearGrupo({ status: 'cancelado', capacidadeTotal: 2 }, { membros: 1 });
    estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId, userId: membroId, papel: 'membro', status: 'ativo' });
    semearFaturaPaga(grupoId);
    const res = await entrar(grupoId, 'fatura-paga');
    expect(res.statusCode).toBe(200);
    expect(estado.operacoes).toHaveLength(0);
  });

  it('grupo ativo com vaga: entra, vincula a fatura (membroId/vinculadoEm) e nao estorna', async () => {
    const grupoId = semearGrupo();
    semearFaturaPaga(grupoId);
    const res = await entrar(grupoId, 'fatura-paga');
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe('Membro adicionado');
    const fatura = estado.db.collection('invoices').docs[0];
    expect(fatura.status).toBe('paga');
    expect(fatura.membroId).toBeTruthy();
    expect(fatura.vinculadoEm).toBeInstanceOf(Date);
    expect(estado.operacoes).toHaveLength(0);
  });

  it('corrida join x refund: fatura estornada durante o insert desfaz a entrada', async () => {
    const grupoId = semearGrupo();
    semearFaturaPaga(grupoId);
    const membros = estado.db.collection('membrosGrupo');
    const insertOriginal = membros.insertOne.bind(membros);
    membros.insertOne = async (doc) => {
      const r = await insertOriginal(doc);
      estado.db.collection('invoices').docs[0].status = 'estornada'; // refund concorrente
      return r;
    };
    const res = await entrar(grupoId, 'fatura-paga');
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('fatura_estornada');
    expect(membros.docs.some((m) => String(m.userId) === String(membroId))).toBe(false);
  });
});
