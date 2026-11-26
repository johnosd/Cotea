// 005-aprovacao-grupos — executarTransicao / notificarEventoModeracao com o fake de Mongo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria } from '../helpers/db-grupos-memoria.js';

vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));

const { logAudit } = await import('../../lib/audit');
const { executarTransicao, notificarEventoModeracao } = await import('../../lib/moderacao-servidor.js');

const donoId = new ObjectId();
let db;

const semear = (status = 'em_aprovacao', moderacao = {}) => {
  const _id = new ObjectId();
  db.collection('grupos').docs.push({
    _id, nome: 'Grupo X', status, adminId: donoId,
    moderacao: { envio: 1, enviadoEm: new Date(), revisaoPendente: false, historico: [], ...moderacao },
  });
  return _id;
};

beforeEach(() => {
  db = criarDbMemoria();
  logAudit.mockClear();
});

describe('executarTransicao', () => {
  it('conflito (estado já mudou) → 409 sem notificar nem auditar', async () => {
    const id = semear('ativo');
    const r = await executarTransicao(db, { grupoId: id, acao: 'aprovar', ator: { id: 'adm' } });
    expect(r).toMatchObject({ ok: false, http: 409, body: { codigo: 'moderacao_conflito' } });
    expect(db.collection('notificacoesUsuario').docs).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('grupo inexistente → 404', async () => {
    expect((await executarTransicao(db, { grupoId: new ObjectId(), acao: 'aprovar', ator: { id: 'adm' } })).http).toBe(404);
  });

  it('corrida: o filtro condicional faz só uma decisão vencer', async () => {
    const id = semear();
    const [a, b] = await Promise.all([
      executarTransicao(db, { grupoId: id, acao: 'aprovar', ator: { id: 'adm1' } }),
      executarTransicao(db, { grupoId: id, acao: 'rejeitar', texto: 'nao', ator: { id: 'adm2' } }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(db.collection('notificacoesUsuario').docs).toHaveLength(1);
  });

  it('auditoria grupo.moderacao.<acao> após gravar, com de/para/texto', async () => {
    const id = semear();
    await executarTransicao(db, { grupoId: id, acao: 'pedir_ajuste', texto: ' ajuste ', ator: { id: 'adm', email: 'a@x' }, ip: '1.2.3.4' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'grupo.moderacao.pedir_ajuste', actorId: 'adm', actorEmail: 'a@x', targetId: String(id), ip: '1.2.3.4',
      details: expect.objectContaining({ de: 'em_aprovacao', para: 'ajustes', texto: 'ajuste', automatico: false }),
    }));
    const g = db.collection('grupos').docs[0];
    expect(g.moderacao.ultimaDecisao).toMatchObject({ acao: 'pedir_ajuste', texto: 'ajuste', porId: 'adm' });
    expect(g.moderacao.historico).toHaveLength(1);
  });

  it('histórico limitado a 100 eventos', async () => {
    const antigos = Array.from({ length: 100 }, (_, i) => ({ acao: 'x', envio: i }));
    const id = semear('em_aprovacao', { historico: antigos });
    await executarTransicao(db, { grupoId: id, acao: 'aprovar', ator: { id: 'adm' } });
    const h = db.collection('grupos').docs[0].moderacao.historico;
    expect(h).toHaveLength(100);
    expect(h[99].acao).toBe('aprovar');
    expect(h[0].envio).toBe(1);
  });
});

describe('notificarEventoModeracao', () => {
  it('repetir o mesmo evento não duplica notificação', async () => {
    const id = semear();
    const grupo = db.collection('grupos').docs[0];
    const evento = { acao: 'aprovar', envio: 1, em: new Date() };
    expect(await notificarEventoModeracao(db, { grupo, evento, destino: 'dono' })).toBe(1);
    expect(await notificarEventoModeracao(db, { grupo, evento, destino: 'dono' })).toBe(0);
    const docs = db.collection('notificacoesUsuario').docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ _id: `moderacao:${id}:1:aprovar:${donoId}`, tipo: 'grupo', acao: `/grupos/${id}`, lido: false });
    expect(String(docs[0].userId)).toBe(String(donoId));
  });

  it('dono_e_membros: dono + membros atuais, sem banidos nem duplicar o dono', async () => {
    const id = semear('cancelado');
    const ativo = new ObjectId();
    const banido = new ObjectId();
    db.collection('membrosGrupo').docs.push(
      { grupoId: id, userId: donoId, papel: 'admin', status: 'ativo' },
      { grupoId: id, userId: ativo, papel: 'membro', status: 'ativo' },
      { grupoId: id, userId: banido, papel: 'membro', status: 'banido' },
    );
    const grupo = db.collection('grupos').docs[0];
    await notificarEventoModeracao(db, { grupo, evento: { acao: 'cancelar', envio: 1, texto: 'fraude' }, destino: 'dono_e_membros' });
    const destinos = db.collection('notificacoesUsuario').docs.map((n) => String(n.userId)).sort();
    expect(destinos).toEqual([String(donoId), String(ativo)].sort());
    const doMembro = db.collection('notificacoesUsuario').docs.find((n) => String(n.userId) === String(ativo));
    expect(doMembro.mensagem).toContain('suporte');
    expect(doMembro.mensagem).not.toContain('fraude'); // motivo só para o dono
  });

  it('membros (encerrar pelo dono): só membros atuais, sem o dono', async () => {
    const id = semear('cancelado');
    const membro = new ObjectId();
    db.collection('membrosGrupo').docs.push(
      { grupoId: id, userId: donoId, papel: 'admin', status: 'ativo' },
      { grupoId: id, userId: membro, papel: 'membro', status: 'ativo' },
    );
    await notificarEventoModeracao(db, { grupo: db.collection('grupos').docs[0], evento: { acao: 'encerrar', envio: 1 }, destino: 'membros' });
    const docs = db.collection('notificacoesUsuario').docs;
    expect(docs.map((n) => String(n.userId))).toEqual([String(membro)]);
    expect(docs[0].titulo).toBe('Grupo encerrado pelo dono');
  });

  it('sem destino → nada', async () => {
    semear();
    expect(await notificarEventoModeracao(db, { grupo: db.collection('grupos').docs[0], evento: { acao: 'desistir', envio: 1 }, destino: null })).toBe(0);
  });
});
