// Testes de contrato da feature 005-aprovacao-grupos (TRAVADOS em
// sdd/specs/005-aprovacao-grupos/contract-tests.lock — o sdd-execute só pode
// fazê-los passar, nunca editá-los). Só pela interface pública: handlers HTTP,
// a rotina registrada e documentos persistidos (data-model.md).
// Sessão, Mongo (fake em memória), auditoria, ledger e cadastro financeiro mockados.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, session: null, operacoes: [] }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => estado.session) }));
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
vi.mock('../../lib/wallet', async (importOriginal) => ({
  ...(await importOriginal()),
  ensureWallet: vi.fn(async () => ({ _id: 'wallet-membro' })),
  calculateBalances: vi.fn(async () => ({ available: 100 })),
}));
vi.mock('../../lib/ledger/servidor', () => ({
  obterLedger: vi.fn(async () => ({
    registrarOperacao: async (op) => {
      const lancamentos = op.pernas.map((p, i) => ({ _id: `lanc-${op.operacaoId}-${i}`, ...p }));
      estado.operacoes.push({ ...op, lancamentos });
      const resultadoExtra = op.extra ? await op.extra({ sessao: null, lancamentos }) : undefined;
      return { criada: true, lancamentos, resultadoExtra };
    },
  })),
}));
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({
  verificarCadastroFinanceiro: vi.fn(async () => ({ ok: true, cpf: '52998224725', usuario: {} })),
}));

const { logAudit } = await import('../../lib/audit');
const { default: handlerGrupos } = await import('../../pages/api/grupos/index.js');
const { default: handlerGrupo } = await import('../../pages/api/grupos/[id].js');
const { default: handlerPay } = await import('../../pages/api/assinaturas/pay.js');
const { default: handlerModeracaoAdmin } = await import('../../pages/api/admin/grupos/[id]/moderacao.js');
const { default: handlerModeracaoDono } = await import('../../pages/api/grupos/[id]/moderacao.js');
const { rotinaAprovacaoAutomatica } = await import('../../lib/rotinas/aprovacao-automatica.js');

const donoId = new ObjectId();
const membroId = new ObjectId();
const outroId = new ObjectId();
const adminSistemaId = new ObjectId();
const suporteId = new ObjectId();

const sessao = (id, extra = {}) => ({
  user: { id: String(id), email: `${id}@teste`, systemRole: 'user', contaValidada: true, isBlocked: false, ...extra },
});
const SESSAO_ADMIN = () => sessao(adminSistemaId, { systemRole: 'admin' });
const SESSAO_SUPORTE = () => sessao(suporteId, { systemRole: 'support' });

const CORPO_GRUPO = { nome: 'Grupo Contrato', valorTotal: 40, capacidadeTotal: 4, categoria: 'jogos' };
const PRECO_OK = { valorTotal: 40, valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true };

const chamar = async (handler, req) => {
  const res = criarRes();
  await handler({ headers: {}, socket: {}, query: {}, body: {}, ...req }, res);
  return res;
};

const grupoNoBanco = (id) => estado.db.collection('grupos').docs.find((g) => String(g._id) === String(id));
const notificacoesDe = (userId) => estado.db.collection('notificacoesUsuario').docs
  .filter((n) => String(n.userId) === String(userId));
const auditoriasComAcao = (action) => logAudit.mock.calls.filter(([arg]) => arg?.action === action);

/**
 * Grupo semeado no formato de data-model.md (sem passar pelo código da feature).
 * `status: undefined` / `moderacao: null` explícitos = documento legado sem esses campos
 * (emenda R-007: o default do destructuring transformava o legado em `em_aprovacao`).
 */
const semearGrupo = (opcoes = {}) => {
  const { status: _s, moderacao: _m, ...campos } = opcoes;
  const status = 'status' in opcoes ? opcoes.status : 'em_aprovacao';
  const moderacao = 'moderacao' in opcoes ? opcoes.moderacao : undefined;
  const _id = new ObjectId();
  const enviadoEm = new Date('2026-11-27T13:00:00Z'); // sexta 10h (Brasília)
  estado.db.collection('grupos').docs.push({
    _id, ...CORPO_GRUPO, ...PRECO_OK, slug: `grupo-${_id}`, adminId: donoId, adminIdString: String(donoId),
    admin: { userId: donoId }, tipoGrupo: 'publico', statusDetalhado: 'em_formacao',
    ...(status === undefined ? {} : { status }),
    ...(moderacao === null ? {} : {
      moderacao: moderacao ?? {
        envio: 1, enviadoEm, revisaoPendente: false, aprovacao: null, ultimaDecisao: null,
        historico: [{ acao: 'enviado', de: null, para: 'em_aprovacao', texto: null, porId: String(donoId), automatico: false, envio: 1, em: enviadoEm }],
      },
    }),
    ...campos,
  });
  estado.db.collection('membrosGrupo').docs.push({ _id: new ObjectId(), grupoId: _id, userId: donoId, papel: 'admin', status: 'ativo' });
  return _id;
};

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.operacoes = [];
  estado.session = null;
  logAudit.mockClear();
  const users = estado.db.collection('users').docs;
  users.push({ _id: donoId, nome: 'Dono', email: 'dono@teste', contaValidada: true, isBlocked: false });
  users.push({ _id: membroId, nome: 'Membro', email: 'membro@teste', contaValidada: true, isBlocked: false });
  users.push({ _id: adminSistemaId, nome: 'Admin', email: 'admin@teste', systemRole: 'admin', contaValidada: true, isBlocked: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('005-aprovacao-grupos — contrato', () => {
  // US1/AC1 + FR-002 + FR-004 + FR-007 (Constitution I: status nunca vem do cliente)
  it('criação ignora status/moderação do cliente, nasce em_aprovacao (inclusive por admin do sistema) e não aceita pagamento', async () => {
    estado.session = sessao(donoId);
    const criado = await chamar(handlerGrupos, {
      method: 'POST',
      body: { ...CORPO_GRUPO, status: 'ativo', statusDetalhado: 'ativo', tipoGrupo: 'organizacao', moderacao: { revisaoPendente: false, envio: 99 } },
    });
    expect(criado.statusCode).toBe(201);
    const doc = grupoNoBanco(criado.body._id);
    expect(doc.status).toBe('em_aprovacao');
    expect(doc.statusDetalhado).toBe('em_formacao');
    expect(doc.moderacao.envio).toBe(1);
    expect(doc.moderacao.revisaoPendente).toBe(false);
    expect(doc.moderacao.enviadoEm).toBeInstanceOf(Date);

    estado.session = SESSAO_ADMIN();
    const doAdmin = await chamar(handlerGrupos, { method: 'POST', body: { ...CORPO_GRUPO, nome: 'Grupo do Admin', status: 'ativo' } });
    expect(doAdmin.statusCode).toBe(201);
    expect(grupoNoBanco(doAdmin.body._id).status).toBe('em_aprovacao');

    estado.session = sessao(membroId);
    const pagamento = await chamar(handlerPay, { method: 'POST', body: { grupoId: String(criado.body._id) } });
    expect(pagamento.statusCode).toBe(409);
    expect(pagamento.body.codigo).toBe('grupo_indisponivel');
    expect(estado.db.collection('invoices').docs).toHaveLength(0);
    expect(estado.operacoes).toHaveLength(0);
  });

  // US1/AC2-AC3 + FR-006: não público só para dono, membro atual e staff
  it('detalhe de grupo não público responde 404 a terceiros e abre para dono, membro atual e staff', async () => {
    const pendente = semearGrupo();
    const legado = semearGrupo({ status: undefined, moderacao: null }); // sem status = ativo (legado)
    const cancelado = semearGrupo({ status: 'cancelado' });
    estado.db.collection('membrosGrupo').docs.push(
      { _id: new ObjectId(), grupoId: cancelado, userId: membroId, papel: 'membro', status: 'ativo' },
      { _id: new ObjectId(), grupoId: cancelado, userId: outroId, papel: 'membro', status: 'banido' },
    );
    const ver = (id, s) => { estado.session = s; return chamar(handlerGrupo, { method: 'GET', query: { id: String(id) } }); };

    expect((await ver(pendente, null)).statusCode).toBe(404);
    expect((await ver(pendente, sessao(outroId))).statusCode).toBe(404);
    const peloDono = await ver(pendente, sessao(donoId));
    expect(peloDono.statusCode).toBe(200);
    expect(peloDono.body.status).toBe('em_aprovacao');
    expect((await ver(pendente, SESSAO_SUPORTE())).statusCode).toBe(200);

    expect((await ver(legado, null)).statusCode).toBe(200);

    expect((await ver(cancelado, sessao(membroId))).statusCode).toBe(200);
    expect((await ver(cancelado, sessao(outroId))).statusCode).toBe(404); // banido não é membro atual
    expect((await ver(cancelado, null)).statusCode).toBe(404);
  });

  // US2/AC2, AC5, AC6 + FR-010, FR-011, FR-012, FR-014, FR-026
  it('fila: suporte não decide; ajuste exige texto; admin aprova uma única vez e o dono é notificado uma vez', async () => {
    const grupoId = semearGrupo();
    const decidir = (s, body) => { estado.session = s; return chamar(handlerModeracaoAdmin, { method: 'POST', query: { id: String(grupoId) }, body }); };

    const doSuporte = await decidir(SESSAO_SUPORTE(), { acao: 'aprovar' });
    expect(doSuporte.statusCode).toBe(403);
    expect(grupoNoBanco(grupoId).status).toBe('em_aprovacao');

    const semTexto = await decidir(SESSAO_ADMIN(), { acao: 'pedir_ajuste', texto: '   ' });
    expect(semTexto.statusCode).toBe(400);
    expect(semTexto.body.codigo).toBe('texto_obrigatorio');
    expect(grupoNoBanco(grupoId).status).toBe('em_aprovacao');

    const aprovado = await decidir(SESSAO_ADMIN(), { acao: 'aprovar' });
    expect(aprovado.statusCode).toBe(200);
    const doc = grupoNoBanco(grupoId);
    expect(doc.status).toBe('ativo');
    expect(doc.moderacao.revisaoPendente).toBe(false);
    expect(doc.moderacao.aprovacao).toMatchObject({ tipo: 'manual', porId: String(adminSistemaId) });

    const repetido = await decidir(SESSAO_ADMIN(), { acao: 'aprovar' });
    expect(repetido.statusCode).toBe(409);
    expect(repetido.body.codigo).toBe('moderacao_conflito');

    expect(notificacoesDe(donoId)).toHaveLength(1);
    expect(auditoriasComAcao('grupo.moderacao.aprovar')).toHaveLength(1);
  });

  // US3/AC1-AC3 + FR-015, FR-016, FR-017, SC-003 (idempotência: duas execuções concorrentes)
  it('rotina aprova automaticamente só após o fim do 2º dia útil, uma única vez, com marca de revisão pendente', async () => {
    const grupoId = semearGrupo(); // enviado sexta 2026-11-27 10h (Brasília)
    const contexto = { db: estado.db, datasExtras: [] };
    const doGrupo = (itens) => itens.filter((i) => i.chave.startsWith(`grupo:${grupoId}:`));

    // Prazo: terça 2026-12-01 23:59:59.999 (Brasília) = 2026-12-02T02:59:59.999Z
    const antes = new Date('2026-12-02T02:59:00Z');
    expect(doGrupo(await rotinaAprovacaoAutomatica.buscarVencidos({ agora: antes, contexto }))).toHaveLength(0);

    const depois = new Date('2026-12-02T03:00:00Z');
    const vencidos = doGrupo(await rotinaAprovacaoAutomatica.buscarVencidos({ agora: depois, contexto }));
    expect(vencidos).toHaveLength(1);
    expect(vencidos[0].chave).toBe(`grupo:${grupoId}:envio:1`);

    const item = { chave: vencidos[0].chave, dados: vencidos[0].dados ?? {}, agora: depois, contexto };
    const resultados = await Promise.all([
      rotinaAprovacaoAutomatica.processarItem(item),
      rotinaAprovacaoAutomatica.processarItem(item),
    ]);
    expect([...resultados].sort()).toEqual(['concluido', 'ignorado']);

    const doc = grupoNoBanco(grupoId);
    expect(doc.status).toBe('ativo');
    expect(doc.moderacao.revisaoPendente).toBe(true);
    expect(doc.moderacao.aprovacao).toMatchObject({ tipo: 'automatica', porId: null });
    expect(notificacoesDe(donoId)).toHaveLength(1);
    const auditorias = auditoriasComAcao('grupo.moderacao.aprovar_automatico');
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0][0].actorId).toBe('sistema');

    expect(await rotinaAprovacaoAutomatica.processarItem(item)).toBe('ignorado');
  });

  // US4/AC2-AC3 + US1/AC6 + FR-003, FR-019, FR-020, US3/AC6 (prazo reinicia; tempo em ajustes não conta)
  it('dono não edita em aprovação; em ajustes edita sem mudar status e o reenvio reinicia o prazo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const grupoId = semearGrupo(); // envio 1 sexta 2026-11-27 10h
    const editar = (body) => { estado.session = sessao(donoId); return chamar(handlerGrupo, { method: 'PUT', query: { id: String(grupoId) }, body }); };

    vi.setSystemTime(new Date('2026-11-30T12:00:00Z'));
    const bloqueada = await editar({ ...CORPO_GRUPO, descricao: 'nova' });
    expect(bloqueada.statusCode).toBe(409);
    expect(bloqueada.body.codigo).toBe('edicao_bloqueada_moderacao');

    vi.setSystemTime(new Date('2026-11-30T13:00:00Z'));
    estado.session = SESSAO_ADMIN();
    const ajuste = await chamar(handlerModeracaoAdmin, {
      method: 'POST', query: { id: String(grupoId) }, body: { acao: 'pedir_ajuste', texto: 'Corrija o link oficial' },
    });
    expect(ajuste.statusCode).toBe(200);
    expect(grupoNoBanco(grupoId).status).toBe('ajustes');

    vi.setSystemTime(new Date('2026-11-30T14:00:00Z'));
    const editada = await editar({ ...CORPO_GRUPO, linkOficial: 'https://oficial.example', status: 'ativo', statusDetalhado: 'ativo' });
    expect(editada.statusCode).toBe(200);
    expect(grupoNoBanco(grupoId).status).toBe('ajustes');

    const reenvioEm = new Date('2026-12-01T13:00:00Z'); // terça 10h
    vi.setSystemTime(reenvioEm);
    estado.session = sessao(donoId);
    const reenvio = await chamar(handlerModeracaoDono, { method: 'POST', query: { id: String(grupoId) }, body: { acao: 'reenviar' } });
    expect(reenvio.statusCode).toBe(200);
    const doc = grupoNoBanco(grupoId);
    expect(doc.status).toBe('em_aprovacao');
    expect(doc.moderacao.envio).toBe(2);
    expect(new Date(doc.moderacao.enviadoEm).getTime()).toBe(reenvioEm.getTime());

    vi.useRealTimers();
    const contexto = { db: estado.db, datasExtras: [] };
    const doGrupo = (itens) => itens.filter((i) => i.chave.startsWith(`grupo:${grupoId}:`));
    // Venceria pelo envio 1 (terça 23:59), mas o envio 2 vence só quinta 2026-12-03 23:59:59.999 (Brasília)
    expect(doGrupo(await rotinaAprovacaoAutomatica.buscarVencidos({ agora: new Date('2026-12-02T03:00:00Z'), contexto }))).toHaveLength(0);
    const vencidos = doGrupo(await rotinaAprovacaoAutomatica.buscarVencidos({ agora: new Date('2026-12-04T03:00:00Z'), contexto }));
    expect(vencidos.map((i) => i.chave)).toEqual([`grupo:${grupoId}:envio:2`]);
  });
});
