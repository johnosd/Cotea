// 005-aprovacao-grupos — cancelamento pelo Cotea (T042; US5 · FR-023 a FR-026).
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
  ensureWallet: vi.fn(async () => ({ _id: 'w' })),
  calculateBalances: vi.fn(async () => ({ available: 100 })),
}));
vi.mock('../../lib/ledger/servidor', () => ({
  obterLedger: vi.fn(async () => ({
    registrarOperacao: async (op) => { estado.operacoes.push(op); return { criada: true, lancamentos: [] }; },
  })),
}));
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({
  verificarCadastroFinanceiro: vi.fn(async () => ({ ok: true })),
}));

const { default: decidir } = await import('../../pages/api/admin/grupos/[id]/moderacao.js');
const { default: fila } = await import('../../pages/api/admin/moderacao/index.js');
const { default: pagar } = await import('../../pages/api/assinaturas/pay.js');

const donoId = new ObjectId();
const membroAtivo = new ObjectId();
const membroBanido = new ObjectId();
const novato = new ObjectId();
const ADMIN = { user: { id: String(new ObjectId()), email: 'a@t', systemRole: 'admin' } };

let grupoId;
beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.operacoes = [];
  grupoId = new ObjectId();
  estado.db.collection('grupos').docs.push({
    _id: grupoId, nome: 'Streaming', status: 'ativo', adminId: donoId, capacidadeTotal: 5,
    valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true,
    moderacao: { envio: 0, enviadoEm: null, revisaoPendente: false, aprovacao: { tipo: 'legado' }, historico: [] },
  });
  estado.db.collection('membrosGrupo').docs.push(
    { _id: new ObjectId(), grupoId, userId: donoId, papel: 'admin', status: 'ativo' },
    { _id: new ObjectId(), grupoId, userId: membroAtivo, papel: 'membro', status: 'ativo' },
    { _id: new ObjectId(), grupoId, userId: membroBanido, papel: 'membro', status: 'banido' },
  );
});

const cancelar = async (texto) => {
  estado.session = ADMIN;
  const res = criarRes();
  await decidir({ method: 'POST', query: { id: String(grupoId) }, body: { acao: 'cancelar', texto }, headers: {}, socket: {} }, res);
  return res;
};

describe('cancelamento pelo Cotea', () => {
  it('sem motivo → 400 e nada muda', async () => {
    expect((await cancelar('  ')).body.codigo).toBe('texto_obrigatorio');
    expect(estado.db.collection('grupos').docs[0].status).toBe('ativo');
  });

  it('com motivo: cancelado lógico, notificações a dono e membro atual (não ao banido), nada apagado nem estornado', async () => {
    expect((await cancelar('Denúncia de fraude')).statusCode).toBe(200);
    const g = estado.db.collection('grupos').docs[0];
    expect(g).toMatchObject({ status: 'cancelado', moderacao: { cancelamento: { origem: 'cotea', motivo: 'Denúncia de fraude' } } });
    expect(estado.db.collection('membrosGrupo').docs).toHaveLength(3);
    const destinos = estado.db.collection('notificacoesUsuario').docs.map((n) => String(n.userId)).sort();
    expect(destinos).toEqual([String(donoId), String(membroAtivo)].sort());
    expect(estado.operacoes).toHaveLength(0);
    expect(estado.db.collection('walletTransactions').docs).toHaveLength(0);
    expect(estado.db.collection('invoices').docs).toHaveLength(0);
  });

  it('cancelar de novo → 409; depois do cancelamento, pay → 409 grupo_indisponivel', async () => {
    await cancelar('Fraude');
    expect((await cancelar('Fraude')).body.codigo).toBe('moderacao_conflito');
    estado.session = { user: { id: String(novato), email: 'n@t', contaValidada: true } };
    const res = criarRes();
    await pagar({ method: 'POST', body: { grupoId: String(grupoId) }, headers: {}, socket: {} }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('grupo_indisponivel');
  });

  it('visão "aprovados" da fila lista o grupo antes e não depois do cancelamento', async () => {
    const ver = async () => {
      estado.session = ADMIN;
      const res = criarRes();
      await fila({ method: 'GET', query: { visao: 'aprovados' }, headers: {} }, res);
      return res.body.itens.map((i) => i._id);
    };
    expect(await ver()).toEqual([String(grupoId)]);
    await cancelar('Fraude');
    expect(await ver()).toEqual([]);
  });
});
