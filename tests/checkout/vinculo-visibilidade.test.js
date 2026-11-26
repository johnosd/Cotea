// Quem enxerga o vínculo declarado (006-checkout-caucao, T035 — US5/AC3, FR-011).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null, pipelines: [] }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('next/router', () => ({ useRouter: () => ({ query: {}, push: vi.fn(), asPath: '/' }) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  getWalletByUser: vi.fn(),
  createWallet: vi.fn(),
}));

const { getServerSideProps } = await import('../../pages/grupos/[id].js');
const { default: handlerGrupo } = await import('../../pages/api/grupos/[id].js');
const { default: handlerMeusGrupos } = await import('../../pages/api/meus-grupos.js');

const donoId = new ObjectId();
const grupoId = new ObjectId();
const membroId = new ObjectId();
const outroId = new ObjectId();
const suporteId = new ObjectId();

/** `aggregate` do SSR: $match por grupo + só os campos pedidos no $project. */
function comAggregate(base) {
  return {
    collection(nome) {
      const colecao = base.collection(nome);
      if (nome !== 'membrosGrupo') return colecao;
      return {
        ...colecao,
        aggregate: (pipeline) => {
          estado.pipelines.push(pipeline);
          return {
            async toArray() {
              const projecao = pipeline.find((p) => p.$project)?.$project || {};
              return colecao.docs
                .filter((m) => String(m.grupoId) === String(pipeline[0].$match.grupoId || grupoId))
                .map((m) => Object.fromEntries(Object.keys(projecao)
                  .filter((campo) => m[campo] !== undefined)
                  .map((campo) => [campo, m[campo]])
                  .concat([['_id', m._id]])));
            },
          };
        },
      };
    },
  };
}

beforeEach(() => {
  const base = criarDbMemoria();
  estado.db = comAggregate(base);
  estado.pipelines = [];
  estado.session = null;
  base.collection('grupos').docs.push({ _id: grupoId, nome: 'G', status: 'ativo', capacidadeTotal: 4, adminId: donoId });
  base.collection('membrosGrupo').docs.push(
    { _id: new ObjectId(), grupoId, userId: donoId, papel: 'admin', status: 'ativo' },
    { _id: new ObjectId(), grupoId, userId: membroId, papel: 'membro', status: 'ativo', vinculo: 'familia' },
    { _id: new ObjectId(), grupoId, userId: outroId, papel: 'membro', status: 'ativo', vinculo: 'amigo' }
  );
});

const sessao = (id, systemRole = 'user') => ({ user: { id: String(id), systemRole, contaValidada: true } });
const abrir = () => getServerSideProps({ params: { id: String(grupoId) }, req: {}, res: {} });

describe('SSR do detalhe do grupo', () => {
  it.each([
    ['dono', sessao(donoId)],
    ['suporte', sessao(suporteId, 'support')],
    ['admin do sistema', sessao(new ObjectId(), 'admin')],
  ])('%s vê o vínculo de cada membro', async (_rotulo, s) => {
    estado.session = s;
    const { props } = await abrir();
    expect(props.grupo.participantes.map((p) => p.vinculo).filter(Boolean).sort()).toEqual(['amigo', 'familia']);
  });

  it.each([
    ['anônimo', null],
    ['outro membro', sessao(outroId)],
    ['estranho', sessao(new ObjectId())],
  ])('%s não recebe vínculo nenhum', async (_rotulo, s) => {
    estado.session = s;
    const { props } = await abrir();
    const texto = JSON.stringify(props);
    expect(texto).not.toContain('vinculo');
    expect(texto).not.toContain('familia');
  });
});

describe('APIs', () => {
  it('GET /api/grupos/[id] não devolve vínculo nem para o dono', async () => {
    estado.session = sessao(donoId);
    const res = criarRes();
    await handlerGrupo({ method: 'GET', query: { id: String(grupoId) }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('familia');
  });

  it('GET /api/meus-grupos não projeta o vínculo', async () => {
    estado.session = sessao(membroId);
    const res = criarRes();
    await handlerMeusGrupos({ method: 'GET', query: { userId: String(membroId) }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    const pipeline = estado.pipelines.at(-1);
    const projecao = pipeline.filter((p) => p.$project).at(-1).$project;
    expect(Object.keys(projecao)).not.toContain('vinculo');
    expect(JSON.stringify(projecao)).not.toContain('vinculo');
  });
});
