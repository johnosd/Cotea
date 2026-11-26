// 005-aprovacao-grupos — rotina de aprovação automática com o executor da 001 (T030) e
// revisão posterior pela rota do admin (T031). FR-015 a FR-018.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';
import { criarRepositorioMemoria } from '../helpers/repositorio-rotinas-memoria.js';

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

const { executarRotina } = await import('../../lib/rotinas/executor.js');
const { rotinaAprovacaoAutomatica } = await import('../../lib/rotinas/aprovacao-automatica.js');
const { listarRotinas } = await import('../../lib/rotinas/registro.js');
const { default: decidir } = await import('../../pages/api/admin/grupos/[id]/moderacao.js');

const donoId = new ObjectId();
const DEPOIS_DO_PRAZO = new Date('2026-12-02T03:00:00Z'); // envio sexta 27/11 10h → vence ter 01/12 23:59 (BRT)

const semear = (status = 'em_aprovacao', moderacao = {}) => {
  const _id = new ObjectId();
  estado.db.collection('grupos').docs.push({
    _id, nome: 'G', status, adminId: donoId,
    moderacao: { envio: 1, enviadoEm: new Date('2026-11-27T13:00:00Z'), revisaoPendente: false, historico: [], ...moderacao },
  });
  return _id;
};

const doc = (id) => estado.db.collection('grupos').docs.find((g) => String(g._id) === String(id));
const contexto = () => ({ db: estado.db, datasExtras: [] });

beforeEach(() => {
  estado.db = criarDbMemoria();
});

describe('rotina com o executor da 001 (T030)', () => {
  it('está registrada e ativa', () => {
    expect(listarRotinas().map((r) => r.id)).toContain('aprovacao-automatica-grupos');
  });

  it('duas execuções seguidas: 1 processado, depois pulado; sem efeito duplicado', async () => {
    const id = semear();
    const repo = criarRepositorioMemoria();
    const r1 = await executarRotina(rotinaAprovacaoAutomatica, { repo, agora: DEPOIS_DO_PRAZO, contexto: contexto() });
    expect(r1).toMatchObject({ resultado: 'sucesso', processados: 1 });
    const r2 = await executarRotina(rotinaAprovacaoAutomatica, { repo, agora: DEPOIS_DO_PRAZO, contexto: contexto() });
    expect(r2).toMatchObject({ processados: 0 });
    expect(doc(id).status).toBe('ativo');
    expect(estado.db.collection('notificacoesUsuario').docs).toHaveLength(1);
  });

  it('item do envio antigo é ignorado quando o grupo foi reenviado', async () => {
    const id = semear();
    const [item] = await rotinaAprovacaoAutomatica.buscarVencidos({ agora: DEPOIS_DO_PRAZO, contexto: contexto() });
    // pedido de ajuste e reenvio acontecem antes de o item ser processado
    Object.assign(doc(id), { status: 'em_aprovacao' });
    doc(id).moderacao.envio = 2;
    doc(id).moderacao.enviadoEm = new Date('2026-12-01T13:00:00Z');
    expect(await rotinaAprovacaoAutomatica.processarItem({ ...item, agora: DEPOIS_DO_PRAZO, contexto: contexto() })).toBe('ignorado');
    expect(doc(id).status).toBe('em_aprovacao');
  });

  it('decisão manual antes do processamento → ignorado, sem renotificar', async () => {
    const id = semear();
    const [item] = await rotinaAprovacaoAutomatica.buscarVencidos({ agora: DEPOIS_DO_PRAZO, contexto: contexto() });
    doc(id).status = 'rejeitado';
    expect(await rotinaAprovacaoAutomatica.processarItem({ ...item, agora: DEPOIS_DO_PRAZO, contexto: contexto() })).toBe('ignorado');
    expect(estado.db.collection('notificacoesUsuario').docs).toHaveLength(0);
  });

  it('sem db no contexto → nenhum item', async () => {
    semear();
    expect(await rotinaAprovacaoAutomatica.buscarVencidos({ agora: DEPOIS_DO_PRAZO, contexto: {} })).toEqual([]);
  });
});

describe('revisão posterior (T031)', () => {
  const sessaoAdmin = { user: { id: String(new ObjectId()), email: 'a@t', systemRole: 'admin' } };
  const post = async (id, body) => {
    estado.session = sessaoAdmin;
    const res = criarRes();
    await decidir({ method: 'POST', query: { id: String(id) }, body, headers: {}, socket: {} }, res);
    return res;
  };
  const autoAprovado = () => semear('ativo', { revisaoPendente: true, aprovacao: { tipo: 'automatica', em: new Date(), porId: null } });

  it('confirmar limpa a marca e mantém aprovado', async () => {
    const id = autoAprovado();
    expect((await post(id, { acao: 'confirmar_revisao' })).statusCode).toBe(200);
    expect(doc(id)).toMatchObject({ status: 'ativo', moderacao: { revisaoPendente: false, revisao: { resultado: 'confirmada' } } });
    expect((await post(id, { acao: 'confirmar_revisao' })).body.codigo).toBe('moderacao_conflito');
  });

  it('reprovar sem motivo → 400; com motivo → cancelado pelo Cotea e dono + membros notificados', async () => {
    const id = autoAprovado();
    const membro = new ObjectId();
    estado.db.collection('membrosGrupo').docs.push(
      { grupoId: id, userId: donoId, papel: 'admin', status: 'ativo' },
      { grupoId: id, userId: membro, papel: 'membro', status: 'ativo' },
    );
    expect((await post(id, { acao: 'reprovar_revisao' })).body.codigo).toBe('texto_obrigatorio');
    expect((await post(id, { acao: 'reprovar_revisao', texto: 'Serviço não permite compartilhamento' })).statusCode).toBe(200);
    expect(doc(id)).toMatchObject({
      status: 'cancelado',
      moderacao: { revisaoPendente: false, revisao: { resultado: 'reprovada' }, cancelamento: { origem: 'cotea' } },
    });
    const destinos = estado.db.collection('notificacoesUsuario').docs.map((n) => String(n.userId)).sort();
    expect(destinos).toEqual([String(donoId), String(membro)].sort());
  });

  it('grupo aprovado manualmente não tem revisão a confirmar', async () => {
    const id = semear('ativo');
    expect((await post(id, { acao: 'confirmar_revisao' })).body.codigo).toBe('moderacao_conflito');
  });
});
