// SSR de /grupos/[id]/cancelar mostra o que volta (006-checkout-caucao, T024 — FR-023).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated' }), getSession: vi.fn() }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
}));

const { getServerSideProps } = await import('../../pages/grupos/[id]/cancelar.js');

const grupoId = new ObjectId();
const membroId = new ObjectId();

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.session = { user: { id: String(membroId) } };
});

const devolucaoPara = async (membro, grupo = {}) => {
  estado.db.collection('grupos').docs.push({ _id: grupoId, nome: 'G', status: 'ativo', ...grupo });
  estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId, userId: membroId, papel: 'membro', status: 'ativo', ...membro });
  const r = await getServerSideProps({ params: { id: String(grupoId) }, req: {}, res: {} });
  return r.props.devolucao;
};

const caucao = { valor: 10.5, situacao: 'bloqueada' };
const retencao = { valor: 10.5, situacao: 'retida' };

describe('prop devolucao', () => {
  it('grupo comum: só a caução', async () => {
    expect(await devolucaoPara({ caucao })).toEqual({ caucao: 10.5, mensalidade: 0, total: 10.5, temEntrada: true });
  });

  it('grupo após completar não lotado: caução + mensalidade retida', async () => {
    expect(await devolucaoPara({ caucao, retencao, aguardandoEnvioAcesso: true }, { acesso: 'apos_completar' }))
      .toEqual({ caucao: 10.5, mensalidade: 10.5, total: 21, temEntrada: true });
  });

  it('grupo lotado ou acesso enviado: a mensalidade retida não volta', async () => {
    expect(await devolucaoPara({ caucao, retencao }, { acesso: 'apos_completar', lotadoEm: new Date() }))
      .toMatchObject({ mensalidade: 0, total: 10.5 });
  });

  it('membro anterior à feature: nada a devolver e sem aviso de entrada', async () => {
    expect(await devolucaoPara({})).toEqual({ caucao: 0, mensalidade: 0, total: 0, temEntrada: false });
  });

  it('caução já devolvida (grupo cancelado): total zero com entrada', async () => {
    expect(await devolucaoPara({ caucao: { ...caucao, situacao: 'devolvida' } }, { status: 'cancelado' }))
      .toEqual({ caucao: 0, mensalidade: 0, total: 0, temEntrada: true });
  });
});
