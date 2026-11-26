// 005-aprovacao-grupos — PUT/DELETE de /api/grupos/[id] por estado de moderação
// (T020, T039; FR-003, FR-019, D-07). Fake de Mongo em memória.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/r2', () => ({ deleteFromR2: vi.fn(), hasR2Config: () => false }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  getWalletByUser: vi.fn(),
  createWallet: vi.fn(),
}));

const { default: handlerGrupo } = await import('../../pages/api/grupos/[id].js');

const donoId = new ObjectId();
const CORPO = { nome: 'Grupo', valorTotal: 40, capacidadeTotal: 4, categoria: 'jogos' };

const sessao = (id, systemRole = 'user') => ({ user: { id: String(id), email: `${id}@t`, systemRole, contaValidada: true } });

const semear = (status) => {
  const _id = new ObjectId();
  estado.db.collection('grupos').docs.push({
    _id, ...CORPO, status, adminId: donoId, statusDetalhado: 'em_formacao',
    moderacao: { envio: 1, enviadoEm: new Date(), revisaoPendente: false, historico: [] },
  });
  estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId: _id, userId: donoId, papel: 'admin', status: 'ativo' });
  return _id;
};

const chamar = async (method, id, s, body = CORPO) => {
  estado.session = s;
  const res = criarRes();
  await handlerGrupo({ method, query: { id: String(id) }, body, headers: {}, socket: {} }, res);
  return res;
};

const grupo = (id) => estado.db.collection('grupos').docs.find((g) => String(g._id) === String(id));

beforeEach(() => {
  estado.db = criarDbMemoria();
});

// O PUT exige ser dono/admin do grupo (regra existente); aqui o dono também é admin do sistema.
describe('PUT por estado (D-07)', () => {
  it('admin do sistema enviando status: cancelado num grupo ativo → status permanece ativo', async () => {
    const id = semear('ativo');
    const r = await chamar('PUT', id, sessao(donoId, 'admin'), { ...CORPO, status: 'cancelado', statusDetalhado: 'ativo' });
    expect(r.statusCode).toBe(200);
    expect(grupo(id).status).toBe('ativo');
    expect(grupo(id).statusDetalhado).toBe('em_formacao');
  });

  it('admin do sistema edita em aprovação sem mudar status; não edita rejeitado/cancelado', async () => {
    const pendente = semear('em_aprovacao');
    expect((await chamar('PUT', pendente, sessao(donoId, 'admin'), { ...CORPO, descricao: 'x' })).statusCode).toBe(200);
    expect(grupo(pendente).status).toBe('em_aprovacao');
    for (const s of ['rejeitado', 'cancelado']) {
      const r = await chamar('PUT', semear(s), sessao(donoId, 'admin'));
      expect(r.statusCode).toBe(409);
      expect(r.body.codigo).toBe('edicao_bloqueada_moderacao');
    }
  });

  it('dono: em_aprovacao, rejeitado e cancelado bloqueados; ativo e ajustes liberados', async () => {
    for (const s of ['em_aprovacao', 'rejeitado', 'cancelado']) {
      expect((await chamar('PUT', semear(s), sessao(donoId))).body.codigo).toBe('edicao_bloqueada_moderacao');
    }
    for (const s of ['ativo', 'ajustes']) {
      expect((await chamar('PUT', semear(s), sessao(donoId))).statusCode).toBe(200);
    }
  });
});

describe('DELETE por estado (T039)', () => {
  it.each(['em_aprovacao', 'ajustes', 'rejeitado', 'cancelado'])('%s → 409 e nada apagado', async (s) => {
    const id = semear(s);
    const r = await chamar('DELETE', id, sessao(donoId));
    expect(r.statusCode).toBe(409);
    expect(r.body.codigo).toBe('edicao_bloqueada_moderacao');
    expect(grupo(id)).toBeTruthy();
    expect(estado.db.collection('membrosGrupo').docs.some((m) => String(m.grupoId) === String(id))).toBe(true);
  });

  it('ativo → exclusão atual mantida (V2-14)', async () => {
    const id = semear('ativo');
    expect((await chamar('DELETE', id, sessao(donoId))).statusCode).toBe(200);
    expect(grupo(id)).toBeUndefined();
  });
});
