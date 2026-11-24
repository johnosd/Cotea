// Regressão do bug get-grupo-expoe-dados-internos: GET /api/grupos/[id] é público e
// NÃO pode devolver campos internos nem o e-mail do dono; esses campos só saem para
// staff e para dono/admin do grupo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null, erroSessao: false }));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => {
    if (estado.erroSessao) throw new Error('falha de sessao');
    return estado.session;
  }),
}));
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
const { montarRespostaGrupo, CAMPOS_PUBLICOS_GRUPO } = await import('../../lib/grupo-publico.js');

const donoId = new ObjectId();
const grupoId = new ObjectId();
const outroId = new ObjectId();

const INTERNOS = ['observacoesInternas', 'necessitaAnalise', 'adminEmail', 'participantesIds', 'imageKey', 'adminId', 'adminIdString'];

const buscar = async (id = grupoId) => {
  const res = criarRes();
  await handlerGrupo({ method: 'GET', query: { id: String(id) }, headers: {}, socket: {} }, res);
  return res;
};

const sessao = (id, extra = {}) => ({ user: { id: String(id), email: `${id}@teste`, systemRole: 'user', ...extra } });

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.erroSessao = false;
  estado.session = null;
  estado.db.collection('users').docs.push({ _id: donoId, nome: 'Dono Real', email: 'dono@privado.com', image: 'http://img/dono.png' });
  estado.db.collection('grupos').docs.push({
    _id: grupoId, nome: 'Grupo Seguro', categoria: 'jogos', descricao: 'Descricao publica',
    valorTotal: 40, valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true,
    capacidadeTotal: 4, vagasDisponiveis: 2, vagasReservadasAdmin: 1,
    observacoesInternas: 'segredo da equipe', necessitaAnalise: true,
    imageKey: 'grupos/chave-interna.png', imageUrl: 'http://img/g.png',
    adminId: donoId, adminEmail: 'dono@privado.com', admin: { userId: donoId, email: 'dono@privado.com', nome: 'Dono Real' },
    participantesIds: [String(outroId)],
  });
});

describe('GET /api/grupos/[id] — visão pública (sem sessão)', () => {
  it('não expõe campos internos nem e-mail do dono', async () => {
    const res = await buscar();
    expect(res.statusCode).toBe(200);
    for (const campo of INTERNOS) expect(res.body, campo).not.toHaveProperty(campo);
    expect(res.body.admin).not.toHaveProperty('email');
    expect(JSON.stringify(res.body)).not.toContain('dono@privado.com');
    expect(JSON.stringify(res.body)).not.toContain('segredo da equipe');
  });

  it('mantém o que a tela de pagamento e a vitrine usam', async () => {
    const res = await buscar();
    expect(res.body).toMatchObject({
      nome: 'Grupo Seguro', valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true,
      capacidadeTotal: 4, vagasDisponiveis: 2, categoria: 'jogos', membrosAtivos: 0,
      adminNome: 'Dono Real', adminAvatar: 'http://img/dono.png',
    });
    expect(res.body.admin).toMatchObject({ id: String(donoId), nome: 'Dono Real' });
  });

  it('mantém 404 e 400', async () => {
    expect((await buscar(new ObjectId())).statusCode).toBe(404);
    const res = criarRes();
    await handlerGrupo({ method: 'GET', query: { id: 'x' }, headers: {}, socket: {} }, res);
    expect(res.statusCode).toBe(400);
  });

  it('erro ao obter a sessão cai na visão pública', async () => {
    estado.erroSessao = true;
    const res = await buscar();
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveProperty('observacoesInternas');
  });
});

describe('GET /api/grupos/[id] — quem pode ver campos internos', () => {
  const veInternos = (body) =>
    body.observacoesInternas === 'segredo da equipe' && body.necessitaAnalise === true && body.admin.email === 'dono@privado.com';

  it('usuário comum logado vê só a visão pública', async () => {
    estado.session = sessao(outroId);
    expect((await buscar()).body).not.toHaveProperty('observacoesInternas');
  });

  it('membro comum do grupo vê só a visão pública', async () => {
    estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId, userId: outroId, papel: 'membro', status: 'ativo' });
    estado.session = sessao(outroId);
    expect((await buscar()).body).not.toHaveProperty('observacoesInternas');
  });

  it('dono do grupo vê a visão completa', async () => {
    estado.session = sessao(donoId);
    expect(veInternos((await buscar()).body)).toBe(true);
  });

  it('admin do grupo via membrosGrupo vê a visão completa; banido não', async () => {
    const membro = { _id: new ObjectId(), grupoId, userId: outroId, papel: 'admin', status: 'ativo' };
    estado.db.collection('membrosGrupo').docs.push(membro);
    estado.session = sessao(outroId);
    expect((await buscar()).body.observacoesInternas).toBe('segredo da equipe');
    membro.status = 'banido';
    expect((await buscar()).body).not.toHaveProperty('observacoesInternas');
  });

  it('staff (admin e support) vê a visão completa; finance não', async () => {
    estado.session = sessao(outroId, { systemRole: 'admin' });
    expect(veInternos((await buscar()).body)).toBe(true);
    estado.session = sessao(outroId, { systemRole: 'support' });
    expect(veInternos((await buscar()).body)).toBe(true);
    estado.session = sessao(outroId, { systemRole: 'finance' });
    expect((await buscar()).body).not.toHaveProperty('observacoesInternas');
  });

  it('conta bloqueada nunca vê campos internos, mesmo sendo dono ou admin', async () => {
    estado.session = sessao(donoId, { isBlocked: true });
    expect((await buscar()).body).not.toHaveProperty('observacoesInternas');
    estado.session = sessao(outroId, { systemRole: 'admin', isBlocked: true });
    expect((await buscar()).body).not.toHaveProperty('observacoesInternas');
  });
});

describe('montarRespostaGrupo / allowlist', () => {
  it('campo novo no documento não vira público sem entrar na allowlist', () => {
    const resp = montarRespostaGrupo({ _id: 1, nome: 'X', campoNovoSensivel: 'y', observacoesInternas: 'z' }, {});
    expect(resp).not.toHaveProperty('campoNovoSensivel');
    expect(resp.nome).toBe('X');
  });

  it('a allowlist não contém campos internos', () => {
    for (const campo of INTERNOS) expect(CAMPOS_PUBLICOS_GRUPO).not.toContain(campo);
  });

  it('a visão completa preserva o contrato antigo (documento inteiro + dados do dono)', () => {
    const resp = montarRespostaGrupo({ _id: 1, nome: 'X', observacoesInternas: 'z' }, { adminEmail: 'a@b', completa: true });
    expect(resp).toMatchObject({ observacoesInternas: 'z', adminEmail: 'a@b' });
    expect(resp.admin.email).toBe('a@b');
  });
});
