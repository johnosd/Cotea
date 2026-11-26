// 005-aprovacao-grupos — convergência C-01 (T052): a SSR de /grupos/[id]/cancelar envia ao
// membro só os campos que a página usa, sem `moderacao` (motivo, histórico) nem campos internos.
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
const donoId = new ObjectId();
const membroId = new ObjectId();
const adminCotea = new ObjectId();

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.db.collection('grupos').docs.push({
    _id: grupoId, nome: 'Streaming', descricao: 'Descricao', subtitulo: 'Plano',
    status: 'cancelado', adminId: donoId, adminEmail: 'dono@privado.com',
    observacoesInternas: 'segredo', necessitaAnalise: true, imageKey: 'k',
    moderacao: {
      cancelamento: { origem: 'cotea', motivo: 'Fraude confirmada', porId: String(adminCotea) },
      ultimaDecisao: { acao: 'cancelar', texto: 'Fraude confirmada', porId: String(adminCotea) },
      historico: [{ acao: 'cancelar', porId: String(adminCotea), texto: 'Fraude confirmada' }],
    },
  });
  estado.db.collection('membrosGrupo').docs.push({ grupoId, userId: membroId, papel: 'membro', status: 'ativo' });
});

const ctx = () => ({ params: { id: String(grupoId) }, req: {}, res: {} });

describe('SSR de /grupos/[id]/cancelar (C-01)', () => {
  it('membro recebe só _id, nome, descricao e subtitulo', async () => {
    estado.session = { user: { id: String(membroId) } };
    const r = await getServerSideProps(ctx());
    expect(r.props.grupo).toEqual({ _id: String(grupoId), nome: 'Streaming', descricao: 'Descricao', subtitulo: 'Plano' });
    const serializado = JSON.stringify(r.props);
    for (const proibido of ['Fraude confirmada', 'moderacao', 'segredo', 'dono@privado.com', String(adminCotea), 'imageKey']) {
      expect(serializado).not.toContain(proibido);
    }
  });

  it('quem não é membro (ou é o dono) continua sendo redirecionado, sem props', async () => {
    estado.session = { user: { id: String(new ObjectId()) } };
    expect(await getServerSideProps(ctx())).toEqual({ redirect: { destination: `/grupos/${grupoId}`, permanent: false } });
    estado.db.collection('membrosGrupo').docs.push({ grupoId, userId: donoId, papel: 'admin', status: 'ativo' });
    estado.session = { user: { id: String(donoId) } };
    expect((await getServerSideProps(ctx())).redirect).toBeTruthy();
  });

  it('sem sessão → login', async () => {
    estado.session = null;
    expect((await getServerSideProps(ctx())).redirect.destination).toContain('/auth/signin');
  });
});
