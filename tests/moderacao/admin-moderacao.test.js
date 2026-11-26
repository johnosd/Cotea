// 005-aprovacao-grupos — POST /api/admin/grupos/[id]/moderacao e GET /api/admin/moderacao
// (T025, T026; FR-008 a FR-014, FR-027). Fake de Mongo em memória.
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

const { default: decidir } = await import('../../pages/api/admin/grupos/[id]/moderacao.js');
const { default: fila } = await import('../../pages/api/admin/moderacao/index.js');

const donoId = new ObjectId();
const sessao = (systemRole) => ({ user: { id: String(new ObjectId()), email: 'x@t', systemRole } });

const semear = (status, moderacao = {}, campos = {}) => {
  const _id = new ObjectId();
  estado.db.collection('grupos').docs.push({
    _id, nome: `G-${String(_id).slice(-4)}`, status, adminId: donoId, valorTotal: 40, capacidadeTotal: 4,
    moderacao: { envio: 1, enviadoEm: new Date('2026-11-27T13:00:00Z'), revisaoPendente: false, historico: [], ...moderacao },
    ...campos,
  });
  return _id;
};

const post = async (id, body, s = sessao('admin')) => {
  estado.session = s;
  const res = criarRes();
  await decidir({ method: 'POST', query: { id: String(id) }, body, headers: {}, socket: {} }, res);
  return res;
};

const get = async (visao, s) => {
  estado.session = s;
  const res = criarRes();
  await fila({ method: 'GET', query: { visao }, headers: {} }, res);
  return res;
};

const doc = (id) => estado.db.collection('grupos').docs.find((g) => String(g._id) === String(id));

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.db.collection('users').docs.push({ _id: donoId, nome: 'Dona', email: 'dona@t' });
});

describe('POST /api/admin/grupos/[id]/moderacao', () => {
  it('rejeitar com motivo é final: aprovar depois → 409', async () => {
    const id = semear('em_aprovacao');
    expect((await post(id, { acao: 'rejeitar', texto: 'Serviço proibido' })).statusCode).toBe(200);
    expect(doc(id).status).toBe('rejeitado');
    expect(doc(id).moderacao.ultimaDecisao.texto).toBe('Serviço proibido');
    expect((await post(id, { acao: 'aprovar' })).body.codigo).toBe('moderacao_conflito');
  });

  it('texto > 1000 → 400 texto_longo; ação fora de ACOES_ADMIN → 400 acao_invalida', async () => {
    const id = semear('em_aprovacao');
    expect((await post(id, { acao: 'pedir_ajuste', texto: 'a'.repeat(1001) })).body.codigo).toBe('texto_longo');
    for (const acao of ['reenviar', 'aprovar_automatico', 'suspender', undefined]) {
      expect((await post(id, { acao })).body.codigo).toBe('acao_invalida');
    }
    expect(doc(id).status).toBe('em_aprovacao');
  });

  it('usuário comum → 403; sem sessão → 401; id inválido → 400; inexistente → 404', async () => {
    const id = semear('em_aprovacao');
    expect((await post(id, { acao: 'aprovar' }, sessao('user'))).statusCode).toBe(403);
    expect((await post(id, { acao: 'aprovar' }, sessao('finance'))).statusCode).toBe(403);
    expect((await post(id, { acao: 'aprovar' }, null)).statusCode).toBe(401);
    expect((await post('xyz', { acao: 'aprovar' })).statusCode).toBe(400);
    expect((await post(new ObjectId(), { acao: 'aprovar' })).statusCode).toBe(404);
    expect(doc(id).status).toBe('em_aprovacao');
  });

  it('admin bloqueado → 403', async () => {
    const id = semear('em_aprovacao');
    const s = sessao('admin');
    s.user.isBlocked = true;
    expect((await post(id, { acao: 'aprovar' }, s)).statusCode).toBe(403);
  });
});

describe('GET /api/admin/moderacao', () => {
  it('pendentes em ordem de envio, com venceEm, dono e contagens; suporte sem podeDecidir', async () => {
    const novo = semear('em_aprovacao', { enviadoEm: new Date('2026-11-30T13:00:00Z') });
    const antigo = semear('em_aprovacao', { enviadoEm: new Date('2026-11-27T13:00:00Z') });
    semear('ativo', { revisaoPendente: true, aprovacao: { tipo: 'automatica', em: new Date() } });
    semear('ativo');
    semear('ajustes');

    const r = await get('pendentes', sessao('support'));
    expect(r.statusCode).toBe(200);
    expect(r.body.podeDecidir).toBe(false);
    expect(r.body.contagens).toEqual({ pendentes: 2, revisao: 1 });
    expect(r.body.itens.map((i) => i._id)).toEqual([String(antigo), String(novo)]);
    expect(new Date(r.body.itens[0].venceEm).toISOString()).toBe('2026-12-02T02:59:59.999Z');
    expect(r.body.itens[0].dono).toMatchObject({ id: String(donoId), nome: 'Dona', email: 'dona@t' });
  });

  it('revisão: só aprovados automaticamente com revisão pendente; admin pode decidir', async () => {
    const auto = semear('ativo', { revisaoPendente: true, aprovacao: { tipo: 'automatica', em: new Date() } });
    semear('ativo');
    const r = await get('revisao', sessao('admin'));
    expect(r.body.podeDecidir).toBe(true);
    expect(r.body.itens.map((i) => i._id)).toEqual([String(auto)]);
    expect(r.body.itens[0].venceEm).toBeNull();
  });

  it('usuário comum e finance → 403; sem sessão → 401', async () => {
    expect((await get('pendentes', sessao('user'))).statusCode).toBe(403);
    expect((await get('pendentes', sessao('finance'))).statusCode).toBe(403);
    expect((await get('pendentes', null)).statusCode).toBe(401);
  });

  it('fila vazia → itens [] e contagens zeradas', async () => {
    const r = await get('pendentes', sessao('admin'));
    expect(r.body).toMatchObject({ itens: [], contagens: { pendentes: 0, revisao: 0 } });
  });
});
