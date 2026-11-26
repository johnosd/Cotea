// Regressão do bug ssr-grupo-detalhe-expoe-dados-internos: o getServerSideProps de
// pages/grupos/[id].js é público e NÃO pode mandar ao HTML/__NEXT_DATA__ campos internos,
// e-mails nem IDs; esses dados só saem para staff e dono/admin do grupo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null, erroSessao: false }));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => {
    if (estado.erroSessao) throw new Error('falha de sessao');
    return estado.session;
  }),
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  getWalletByUser: vi.fn(),
  createWallet: vi.fn(),
}));

const { getServerSideProps } = await import('../../pages/grupos/[id].js');

const donoId = new ObjectId();
const grupoId = new ObjectId();
const membroId = new ObjectId();
const estranhoId = new ObjectId();
const banidoId = new ObjectId();

const EMAILS = ['dono@privado.com', 'membro@privado.com', 'banido@privado.com'];
const INTERNOS = ['observacoesInternas', 'necessitaAnalise', 'imageKey', 'adminEmail', 'participantesIds', 'adminId', 'adminIdString'];

// O fake travado (tests/helpers/db-grupos-memoria.js) não tem aggregate. Este só simula o
// pipeline do SSR ($match + $lookup users + $project) a partir das coleções em memória.
function comAggregate(base) {
  return {
    collection(nome) {
      const colecao = base.collection(nome);
      if (nome !== 'membrosGrupo') return colecao;
      return {
        ...colecao,
        aggregate: (pipeline) => ({
          async toArray() {
            const alvo = pipeline[0].$match.grupoId;
            return colecao.docs
              .filter((m) => String(m.grupoId) === String(alvo))
              .map((m) => {
                const user = base.collection('users').docs.find((u) => String(u._id) === String(m.userId));
                return {
                  _id: m._id, papel: m.papel, status: m.status, userId: m.userId,
                  aguardandoEnvioAcesso: m.aguardandoEnvioAcesso, dataEnvioAcesso: m.dataEnvioAcesso,
                  nome: user?.name ?? user?.nome, email: user?.email, avatar: user?.image ?? user?.avatar,
                };
              });
          },
        }),
      };
    },
  };
}

const sessao = (id, extra = {}) => ({ user: { id: String(id), email: `${id}@teste`, systemRole: 'user', ...extra } });

const abrir = async (id = grupoId) => getServerSideProps({ params: { id: String(id) }, req: {}, res: {} });
const grupoDe = async (id) => (await abrir(id)).props.grupo;

beforeEach(() => {
  const base = criarDbMemoria();
  estado.db = comAggregate(base);
  estado.erroSessao = false;
  estado.session = null;
  base.collection('users').docs.push(
    { _id: donoId, nome: 'Dono Real', email: 'dono@privado.com', image: 'http://img/dono.png' },
    { _id: membroId, nome: 'Maria', email: 'membro@privado.com' },
    { _id: banidoId, nome: 'Banido', email: 'banido@privado.com' }
  );
  base.collection('grupos').docs.push({
    _id: grupoId, nome: 'Grupo Seguro', categoria: 'jogos', descricao: 'Descricao publica', subtitulo: 'Plano anual',
    valorTotal: 40, valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true,
    capacidadeTotal: 4, vagasDisponiveis: 2, vagasReservadasAdmin: 1,
    observacoesInternas: 'segredo da equipe', necessitaAnalise: true,
    imageKey: 'grupos/chave-interna.png', imageUrl: 'http://img/g.png',
    adminId: donoId, adminEmail: 'dono@privado.com', admin: { userId: donoId, email: 'dono@privado.com', nome: 'Dono Real' },
    participantesIds: [String(membroId)],
  });
  base.collection('membrosGrupo').docs.push(
    { _id: new ObjectId(), grupoId, userId: donoId, papel: 'admin', status: 'ativo' },
    { _id: new ObjectId(), grupoId, userId: membroId, papel: 'membro', status: 'ativo', aguardandoEnvioAcesso: true },
    { _id: new ObjectId(), grupoId, userId: banidoId, papel: 'membro', status: 'banido' }
  );
});

const semVazamento = (props) => {
  const texto = JSON.stringify(props);
  for (const campo of INTERNOS) expect(props.grupo, campo).not.toHaveProperty(campo);
  expect(props.grupo.admin).not.toHaveProperty('email');
  expect(texto).not.toContain('segredo da equipe');
  expect(texto).not.toContain('chave-interna');
  for (const email of EMAILS) expect(texto, email).not.toContain(email);
  // admin.id (id do dono) é público também na API; o id de participante nunca.
  expect(texto).not.toContain(String(membroId));
  for (const p of props.grupo.participantes) {
    expect(Object.keys(p).sort()).toEqual(['avatar', 'nome']);
  }
};

describe('getServerSideProps de /grupos/[id] — visão pública', () => {
  it('anônimo não recebe campos internos, e-mails nem IDs', async () => {
    const r = await abrir();
    semVazamento(r.props);
    expect(r.props.visao).toEqual({ jaMembro: false, souAdmin: false });
  });

  it('mantém o que a página pública usa (vitrine, preço, vagas, dono e participantes)', async () => {
    const { grupo } = (await abrir()).props;
    expect(grupo).toMatchObject({
      _id: String(grupoId), nome: 'Grupo Seguro', subtitulo: 'Plano anual', descricao: 'Descricao publica',
      imageUrl: 'http://img/g.png', valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true,
      capacidadeTotal: 4, adminNome: 'Dono Real', adminAvatar: 'http://img/dono.png', membrosAtivos: 2,
    });
    // banido fora da lista; dono e membro ativos aparecem só com nome e avatar
    expect(grupo.participantes.map((p) => p.nome)).toEqual(['Dono Real', 'Maria']);
  });

  it('usuário comum logado (nem dono, nem staff, nem membro) recebe a visão pública', async () => {
    estado.session = sessao(estranhoId);
    const r = await abrir();
    semVazamento(r.props);
    expect(r.props.visao).toEqual({ jaMembro: false, souAdmin: false });
  });

  it('membro comum recebe a visão pública e visao.jaMembro verdadeiro', async () => {
    estado.session = sessao(membroId);
    const r = await abrir();
    expect(r.props.visao).toEqual({ jaMembro: true, souAdmin: false });
    expect(r.props.grupo).not.toHaveProperty('observacoesInternas');
    expect(JSON.stringify(r.props)).not.toContain('membro@privado.com');
  });

  it('membro banido não é tratado como membro', async () => {
    estado.session = sessao(banidoId);
    expect((await abrir()).props.visao.jaMembro).toBe(false);
  });

  it('nome do participante sem nome cadastrado não cai no e-mail', async () => {
    estado.db.collection('users').docs.find((u) => u._id === membroId).nome = undefined;
    const r = await abrir();
    expect(JSON.stringify(r.props)).not.toContain('membro@privado.com');
    expect(r.props.grupo.participantes.map((p) => p.nome)).toContain('Membro 2');
  });

  it('erro ao obter a sessão cai na visão pública', async () => {
    estado.erroSessao = true;
    const r = await abrir();
    semVazamento(r.props);
    expect(r.props.visao).toEqual({ jaMembro: false, souAdmin: false });
  });

  it('conta bloqueada nunca recebe a visão completa, mesmo sendo dono ou admin do sistema', async () => {
    estado.session = sessao(donoId, { isBlocked: true });
    semVazamento((await abrir()).props);
    estado.session = sessao(estranhoId, { systemRole: 'admin', isBlocked: true });
    semVazamento((await abrir()).props);
  });

  it('finance não é staff de grupos: visão pública', async () => {
    estado.session = sessao(estranhoId, { systemRole: 'finance' });
    semVazamento((await abrir()).props);
  });

  it('mantém notFound para id inválido e grupo inexistente', async () => {
    expect(await abrir('x')).toEqual({ notFound: true });
    expect(await abrir(new ObjectId())).toEqual({ notFound: true });
  });
});

describe('getServerSideProps de /grupos/[id] — visão completa', () => {
  it('dono recebe o documento completo e a área do dono (sem e-mail de participante)', async () => {
    estado.session = sessao(donoId);
    const r = await abrir();
    expect(r.props.grupo).toMatchObject({
      observacoesInternas: 'segredo da equipe', necessitaAnalise: true, imageKey: 'grupos/chave-interna.png',
      adminEmail: 'dono@privado.com', membrosAtivos: 2,
    });
    expect(r.props.grupo.admin).toMatchObject({ id: String(donoId), email: 'dono@privado.com' });
    expect(r.props.visao).toEqual({ jaMembro: true, souAdmin: true });
    const pendente = r.props.grupo.participantes.find((p) => p.nome === 'Maria');
    expect(pendente).toMatchObject({ userId: String(membroId), papel: 'membro', aguardandoEnvioAcesso: true });
    for (const p of r.props.grupo.participantes) expect(p).not.toHaveProperty('email');
    expect(JSON.stringify(r.props)).not.toContain('membro@privado.com');
  });

  it('admin do grupo via membrosGrupo (sem adminId no documento) também recebe a visão completa', async () => {
    const outroAdmin = new ObjectId();
    estado.db.collection('users').docs.push({ _id: outroAdmin, nome: 'Co-admin', email: 'co@privado.com' });
    estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId, userId: outroAdmin, papel: 'admin', status: 'ativo' });
    estado.session = sessao(outroAdmin);
    const r = await abrir();
    expect(r.props.grupo.observacoesInternas).toBe('segredo da equipe');
    expect(r.props.visao.souAdmin).toBe(true);
  });

  it('admin do grupo banido volta à visão pública', async () => {
    const outroAdmin = new ObjectId();
    estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId, userId: outroAdmin, papel: 'admin', status: 'banido' });
    estado.session = sessao(outroAdmin);
    semVazamento((await abrir()).props);
  });

  it('staff (support e admin) recebe a visão completa, sem ser tratado como dono', async () => {
    for (const systemRole of ['support', 'admin']) {
      estado.session = sessao(estranhoId, { systemRole });
      const r = await abrir();
      expect(r.props.grupo).toMatchObject({ observacoesInternas: 'segredo da equipe', adminEmail: 'dono@privado.com' });
      expect(r.props.visao).toEqual({ jaMembro: false, souAdmin: false });
    }
  });

  it('o resultado é serializável (JSON) para o Next', async () => {
    estado.session = sessao(donoId);
    const r = await abrir();
    expect(JSON.parse(JSON.stringify(r.props))).toEqual(r.props);
  });
});
