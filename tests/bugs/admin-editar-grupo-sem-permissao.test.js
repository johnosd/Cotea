// Regressão: /admin/grupos/[id] só pode ser vista por dono/membro admin não
// banido do grupo ou por staff com PERMISSIONS.GROUPS_TAB (bug admin-editar-grupo-sem-permissao).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ObjectId } from 'mongodb';
import { criarDbMemoria } from '../helpers/db-grupos-memoria.js';
import { podeEditarGrupo, resolverPaginaEdicaoGrupo } from '../../lib/grupos-acesso.js';

const donoId = new ObjectId();
const estranhoId = new ObjectId();
const membroAdminId = new ObjectId();
const membroComumId = new ObjectId();
const grupoId = new ObjectId();

const sessao = (id, systemRole = 'user', extra = {}) => ({
  user: { id: String(id), email: `${id}@teste`, systemRole, ...extra },
});

let db;

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
  db = criarDbMemoria();
  db.collection('users').docs.push(
    { _id: donoId, nome: 'Dono', email: 'dono@teste' },
    { _id: membroComumId, nome: 'Membro', email: 'membro-secreto@teste' },
    { _id: membroAdminId, nome: 'Co-admin', email: 'coadmin@teste' }
  );
  db.collection('grupos').docs.push({
    _id: grupoId,
    nome: 'Canva Pro',
    adminId: donoId,
    observacoesInternas: 'NOTA-INTERNA-SECRETA',
    valorTotal: 40,
    capacidadeTotal: 4,
  });
  db.collection('membrosGrupo').docs.push(
    { _id: new ObjectId(), grupoId, userId: donoId, papel: 'admin', status: 'ativo' },
    { _id: new ObjectId(), grupoId, userId: membroComumId, papel: 'membro', status: 'ativo' },
    { _id: new ObjectId(), grupoId, userId: membroAdminId, papel: 'admin', status: 'ativo' }
  );
});

const abrir = (session, id = grupoId) => resolverPaginaEdicaoGrupo({ db, session, id: String(id) });
const semVazamento = (r) => {
  expect(r.props).toBeUndefined();
  expect(JSON.stringify(r)).not.toContain('NOTA-INTERNA-SECRETA');
  expect(JSON.stringify(r)).not.toContain('membro-secreto@teste');
};

describe('/admin/grupos/[id] — autorização no servidor', () => {
  it('sem sessão redireciona para o login com callbackUrl e não devolve dados', async () => {
    const r = await abrir(null);
    expect(r.redirect.destination).toBe(`/auth/signin?callbackUrl=${encodeURIComponent(`/admin/grupos/${grupoId}`)}`);
    semVazamento(r);
  });

  it('usuário comum que não é dono recebe notFound sem dados (o bug reportado)', async () => {
    const r = await abrir(sessao(estranhoId));
    expect(r).toEqual({ notFound: true });
    semVazamento(r);
  });

  it('membro comum do grupo (papel membro) não vê a tela', async () => {
    expect(await abrir(sessao(membroComumId))).toEqual({ notFound: true });
  });

  it('membro admin banido não vê a tela', async () => {
    db.collection('membrosGrupo').docs.find((m) => String(m.userId) === String(membroAdminId)).status = 'banido';
    expect(await abrir(sessao(membroAdminId))).toEqual({ notFound: true });
  });

  it('staff sem permissão de grupos (finance) e usuário bloqueado não veem', async () => {
    expect(await abrir(sessao(estranhoId, 'finance'))).toEqual({ notFound: true });
    expect(await abrir(sessao(estranhoId, 'admin', { isBlocked: true }))).toEqual({ notFound: true });
    expect(await abrir(sessao(donoId, 'user', { isBlocked: true }))).toEqual({ notFound: true });
  });

  it('grupo inexistente e ID inválido dão notFound', async () => {
    expect(await abrir(sessao(donoId), new ObjectId())).toEqual({ notFound: true });
    expect(await abrir(sessao(donoId), 'abc')).toEqual({ notFound: true });
  });

  it('dono vê grupo e participantes (sem o dono na lista)', async () => {
    const r = await abrir(sessao(donoId));
    expect(r.props.grupo).toMatchObject({
      nome: 'Canva Pro',
      adminIdString: String(donoId),
      adminNome: 'Dono',
      adminEmail: 'dono@teste',
      membrosAtivos: 3,
    });
    expect(r.props.participantes).toHaveLength(1);
    expect(r.props.participantes[0]).toMatchObject({ nome: 'Membro', email: 'membro-secreto@teste', papel: 'membro' });
  });

  it('dono identificado por adminIdString (string) e membro admin não banido também veem', async () => {
    const g = db.collection('grupos').docs[0];
    delete g.adminId;
    g.adminIdString = String(donoId);
    expect((await abrir(sessao(donoId))).props).toBeDefined();
    expect((await abrir(sessao(membroAdminId))).props).toBeDefined();
  });

  it('staff support e admin veem, mesmo sem ser dono', async () => {
    expect((await abrir(sessao(estranhoId, 'support'))).props.grupo.nome).toBe('Canva Pro');
    expect((await abrir(sessao(estranhoId, 'admin'))).props.grupo.nome).toBe('Canva Pro');
  });
});

describe('podeEditarGrupo — regra pura', () => {
  const grupo = { adminId: donoId };

  it('compara ObjectId e string de forma equivalente', () => {
    expect(podeEditarGrupo({ session: sessao(donoId), grupo })).toBe(true);
    expect(podeEditarGrupo({ session: sessao(donoId), grupo: { adminIdString: String(donoId) } })).toBe(true);
    expect(podeEditarGrupo({ session: sessao(estranhoId), grupo })).toBe(false);
  });

  it('exige papel admin não banido no membro e sessão presente', () => {
    const membro = (extra) => ({ userId: membroAdminId, papel: 'admin', status: 'ativo', ...extra });
    expect(podeEditarGrupo({ session: sessao(membroAdminId), grupo, membroAdmin: membro() })).toBe(true);
    expect(podeEditarGrupo({ session: sessao(membroAdminId), grupo, membroAdmin: membro({ status: 'banido' }) })).toBe(false);
    expect(podeEditarGrupo({ session: sessao(membroAdminId), grupo, membroAdmin: membro({ papel: 'membro' }) })).toBe(false);
    expect(podeEditarGrupo({ session: null, grupo })).toBe(false);
  });
});

describe('página /admin/grupos/[id]', () => {
  it('o getServerSideProps consulta a sessão no servidor e não faz fetch da API pública', () => {
    const fonte = readFileSync(new URL('../../pages/admin/grupos/[id].js', import.meta.url), 'utf8');
    const gssp = fonte.slice(fonte.indexOf('export async function getServerSideProps'));
    expect(gssp).toContain('getServerSession(req, res, authOptions)');
    expect(gssp).toContain('resolverPaginaEdicaoGrupo');
    expect(gssp).not.toContain('fetch(');
  });
});
