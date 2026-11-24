// Testes de integração leves dos handlers de grupo (003-preco-por-vaga, US1).
// Mocka sessão e Mongo com um banco em memória: exercita o código real dos
// handlers sem tocar em banco nem em variáveis de ambiente.
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

const { default: handlerGrupos } = await import('../../pages/api/grupos/index.js');
const { default: handlerGrupo } = await import('../../pages/api/grupos/[id].js');
const { logAudit } = await import('../../lib/audit');

const donoId = new ObjectId();
const corpoBase = { nome: 'Grupo Teste', categoria: 'jogos', valorTotal: 40, capacidadeTotal: 4 };

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.db.collection('users').docs.push({ _id: donoId, nome: 'Dono', email: 'dono@teste' });
  estado.session = { user: { id: String(donoId), email: 'dono@teste', contaValidada: true, systemRole: 'user' } };
  vi.mocked(logAudit).mockClear();
});

const criar = async (body) => {
  const res = criarRes();
  await handlerGrupos({ method: 'POST', body, headers: {}, socket: {} }, res);
  return res;
};

const editar = async (id, body) => {
  const res = criarRes();
  await handlerGrupo({ method: 'PUT', query: { id: String(id) }, body, headers: {}, socket: {} }, res);
  return res;
};

describe('POST /api/grupos — regra única (US1)', () => {
  it('grava o trio calculado e ignora valorPorVaga, reservadas e vagas do body (US1-AC1/AC2/AC6)', async () => {
    const res = await criar({ ...corpoBase, valorTotal: 10, capacidadeTotal: 3, valorPorVaga: 1, vagasReservadasAdmin: 3, vagasDisponiveis: 99 });
    expect(res.statusCode).toBe(201);
    const grupo = estado.db.collection('grupos').docs[0];
    expect(Number(grupo.valorPorVaga)).toBe(3.5);
    expect(Number(grupo.repassePorVaga)).toBe(3.33);
    expect(Number(grupo.taxaPorVaga)).toBe(0.17);
    expect(grupo.precoValido).toBe(true);
    expect(Number(grupo.vagasReservadasAdmin)).toBe(1);
    expect(Number(grupo.vagasDisponiveis)).toBe(2);
    const auditoria = vi.mocked(logAudit).mock.calls[0][0];
    expect(auditoria.details).toMatchObject({ valorTotal: 10, capacidade: 3, valorPorVaga: 3.5, repassePorVaga: 3.33, taxaPorVaga: 0.17 });
  });

  it('recusa capacidade 1 e valor total inválido com o motivo no campo (US1-AC3)', async () => {
    const r1 = await criar({ ...corpoBase, capacidadeTotal: 1 });
    expect(r1.statusCode).toBe(400);
    expect(r1.body).toMatchObject({ campo: 'capacidade_minima' });
    const r2 = await criar({ ...corpoBase, valorTotal: 10.555 });
    expect(r2.statusCode).toBe(400);
    expect(r2.body).toMatchObject({ campo: 'valor_total_invalido' });
    expect(estado.db.collection('grupos').docs).toHaveLength(0);
  });
});

describe('PUT /api/grupos/[id] — recálculo e capacidade (US1)', () => {
  const semear = (extra = {}) => {
    const grupoId = new ObjectId();
    estado.db.collection('grupos').docs.push({
      _id: grupoId, nome: 'Legado', valorTotal: 40, capacidadeTotal: 6, valorPorVaga: 10,
      vagasReservadasAdmin: 2, adminId: donoId, categoria: 'jogos', ...extra,
    });
    return grupoId;
  };
  const membros = (grupoId, n, status = 'ativo') => {
    for (let i = 0; i < n; i += 1) {
      estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId, userId: new ObjectId(), papel: 'membro', status });
    }
  };

  it('recalcula o preço, regulariza legado e audita antes/depois (US1-AC5)', async () => {
    const grupoId = semear();
    estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId, userId: donoId, papel: 'admin', status: 'ativo' });
    membros(grupoId, 1);
    const res = await editar(grupoId, { ...corpoBase, valorTotal: 90, capacidadeTotal: 2, valorPorVaga: 999 });
    expect(res.statusCode).toBe(200);
    expect(res.body.preco).toEqual({ valorPorVaga: 47.25, repasse: 45, taxa: 2.25 });
    const grupo = estado.db.collection('grupos').docs[0];
    expect(Number(grupo.valorPorVaga)).toBe(47.25);
    expect(grupo.precoValido).toBe(true);
    expect(Number(grupo.vagasReservadasAdmin)).toBe(1);
    expect(Number(grupo.vagasDisponiveis)).toBe(0);
    const auditoria = vi.mocked(logAudit).mock.calls[0][0];
    expect(auditoria.details.preco.antes).toMatchObject({ valorTotal: 40, capacidade: 6, valorPorVaga: 10 });
    expect(auditoria.details.preco.depois).toMatchObject({ valorTotal: 90, capacidade: 2, valorPorVaga: 47.25 });
  });

  it('recusa capacidade abaixo de dono + membros ativos, ignorando banidos (US1-AC4)', async () => {
    const grupoId = semear();
    membros(grupoId, 3);
    membros(grupoId, 2, 'banido');
    const recusa = await editar(grupoId, { ...corpoBase, capacidadeTotal: 3 });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.body).toMatchObject({ campo: 'capacidade_participantes' });
    expect(recusa.body.error).toContain('4');
    expect(Number(estado.db.collection('grupos').docs[0].valorPorVaga)).toBe(10);
    const ok = await editar(grupoId, { ...corpoBase, capacidadeTotal: 4 });
    expect(ok.statusCode).toBe(200);
  });

  it('recusa capacidade 1 também na edição (US1-AC3)', async () => {
    const grupoId = semear();
    const res = await editar(grupoId, { ...corpoBase, capacidadeTotal: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ campo: 'capacidade_minima' });
  });
});
