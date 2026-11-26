// 005-aprovacao-grupos — POST /api/grupos/[id]/moderacao pelo dono (T038; FR-020, FR-021, R-008).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null, cadastro: { ok: true } }));

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
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({
  verificarCadastroFinanceiro: vi.fn(async () => estado.cadastro),
}));

const { default: handler } = await import('../../pages/api/grupos/[id]/moderacao.js');

const donoId = new ObjectId();
const outroId = new ObjectId();

const sessao = (id, extra = {}) => ({ user: { id: String(id), email: 'd@t', systemRole: 'user', contaValidada: true, isBlocked: false, ...extra } });

const semear = (status) => {
  const _id = new ObjectId();
  estado.db.collection('grupos').docs.push({
    _id, nome: 'G', status, adminId: donoId,
    moderacao: { envio: 1, enviadoEm: new Date('2026-11-27T13:00:00Z'), revisaoPendente: false, historico: [] },
  });
  estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId: _id, userId: donoId, papel: 'admin', status: 'ativo' });
  return _id;
};

const post = async (id, body, s = sessao(donoId)) => {
  estado.session = s;
  const res = criarRes();
  await handler({ method: 'POST', query: { id: String(id) }, body, headers: {}, socket: {} }, res);
  return res;
};

const doc = (id) => estado.db.collection('grupos').docs.find((g) => String(g._id) === String(id));

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.cadastro = { ok: true };
  estado.db.collection('users').docs.push({ _id: donoId, isBlocked: false });
});

describe('desistir', () => {
  it.each(['em_aprovacao', 'ajustes'])('em %s → cancelado pelo dono, sem notificação', async (s) => {
    const id = semear(s);
    expect((await post(id, { acao: 'desistir' })).statusCode).toBe(200);
    expect(doc(id)).toMatchObject({ status: 'cancelado', moderacao: { cancelamento: { origem: 'dono' } } });
    expect(estado.db.collection('notificacoesUsuario').docs).toHaveLength(0);
  });

  it('em ativo → 409 (grupo aprovado usa encerrar)', async () => {
    expect((await post(semear('ativo'), { acao: 'desistir' })).body.codigo).toBe('moderacao_conflito');
  });
});

describe('reenviar', () => {
  it('bloqueado no banco → 403; conta não validada → 403', async () => {
    const id = semear('ajustes');
    estado.db.collection('users').docs[0].isBlocked = true;
    expect((await post(id, { acao: 'reenviar' })).statusCode).toBe(403);
    estado.db.collection('users').docs[0].isBlocked = false;
    expect((await post(id, { acao: 'reenviar' }, sessao(donoId, { contaValidada: false }))).statusCode).toBe(403);
    expect(doc(id).status).toBe('ajustes');
  });

  it('cadastro financeiro incompleto → 409 com o corpo do gate', async () => {
    const id = semear('ajustes');
    estado.cadastro = { ok: false, http: 409, body: { error: 'Complete seu cadastro', codigo: 'cadastro_financeiro_incompleto', pendencias: ['cpf'] } };
    const r = await post(id, { acao: 'reenviar' });
    expect(r.statusCode).toBe(409);
    expect(r.body.codigo).toBe('cadastro_financeiro_incompleto');
    expect(doc(id).status).toBe('ajustes');
  });

  it('rejeitado não reenvia', async () => {
    expect((await post(semear('rejeitado'), { acao: 'reenviar' })).body.codigo).toBe('moderacao_conflito');
  });
});

describe('encerrar (R-008)', () => {
  it('ativo → cancelado com motivo opcional; membros avisados, dono não', async () => {
    const id = semear('ativo');
    const membro = new ObjectId();
    estado.db.collection('membrosGrupo').docs.push({ grupoId: id, userId: membro, papel: 'membro', status: 'ativo' });
    expect((await post(id, { acao: 'encerrar', texto: 'O serviço acabou' })).statusCode).toBe(200);
    expect(doc(id)).toMatchObject({ status: 'cancelado', moderacao: { cancelamento: { origem: 'dono', motivo: 'O serviço acabou' } } });
    expect(estado.db.collection('notificacoesUsuario').docs.map((n) => String(n.userId))).toEqual([String(membro)]);
    expect(estado.db.collection('membrosGrupo').docs.filter((m) => String(m.grupoId) === String(id))).toHaveLength(2);
  });
});

describe('autorização e validação', () => {
  it('não dono → 403; sem sessão → 401; ação de admin → 400; inexistente → 404', async () => {
    const id = semear('em_aprovacao');
    expect((await post(id, { acao: 'desistir' }, sessao(outroId))).statusCode).toBe(403);
    expect((await post(id, { acao: 'desistir' }, null)).statusCode).toBe(401);
    expect((await post(id, { acao: 'aprovar' })).body.codigo).toBe('acao_invalida');
    expect((await post(new ObjectId(), { acao: 'desistir' })).statusCode).toBe(404);
    expect(doc(id).status).toBe('em_aprovacao');
  });
});
