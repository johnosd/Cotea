// 005-aprovacao-grupos (T018, FR-005): GET /api/grupos e SSR da home começam com o
// $match de grupos públicos. O fake de Mongo não tem aggregate: capturamos o pipeline.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FILTRO_GRUPOS_PUBLICOS } from '../../lib/moderacao.js';

const estado = vi.hoisted(() => ({ pipelines: [], db: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  getWalletByUser: vi.fn(),
  createWallet: vi.fn(),
}));

const { default: handlerGrupos } = await import('../../pages/api/grupos/index.js');
const { getServerSideProps: ssrHome } = await import('../../pages/index.js');

beforeEach(() => {
  estado.pipelines = [];
  estado.db = {
    collection: () => ({
      aggregate: (pipeline) => {
        estado.pipelines.push(pipeline);
        return { toArray: async () => [{ _id: 'g1', nome: 'Publico', status: 'ativo' }] };
      },
    }),
  };
});

const criarRes = () => {
  const res = { statusCode: 200, body: undefined, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; }, setHeader() {}, end() { return res; } };
  return res;
};

describe('listagem pública', () => {
  it('GET /api/grupos: 1º estágio é o $match de públicos', async () => {
    const res = criarRes();
    await handlerGrupos({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(estado.pipelines[0][0]).toEqual({ $match: FILTRO_GRUPOS_PUBLICOS });
  });

  it('SSR da home: 1º estágio é o $match de públicos', async () => {
    const r = await ssrHome({});
    expect(r.props.gruposIniciais).toHaveLength(1);
    expect(estado.pipelines[0][0]).toEqual({ $match: FILTRO_GRUPOS_PUBLICOS });
  });
});
