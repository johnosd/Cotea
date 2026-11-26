// Testes de contrato da feature 006-checkout-caucao (TRAVADOS em
// sdd/specs/006-checkout-caucao/contract-tests.lock — o sdd-execute só pode fazê-los
// passar, nunca editá-los). Só pela interface pública: handlers HTTP e documentos
// persistidos (data-model.md). Banco transacional em memória com o LEDGER REAL por cima;
// só sessão, auditoria, R2 e o gate de cadastro financeiro são simulados.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarRes } from '../helpers/db-grupos-memoria.js';
import { criarBancoTransacional } from '../helpers/db-transacional-memoria.js';

const estado = vi.hoisted(() => ({ banco: null, session: null }));

// `req.sessao` fixa a sessão por requisição (necessário em chamadas concorrentes).
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async (req) => req?.sessao ?? estado.session) }));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async (req) => req?.sessao ?? estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/r2', () => ({ deleteFromR2: vi.fn(), hasR2Config: () => false }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({
    db: () => estado.banco.db,
    startSession: () => estado.banco.client.startSession(),
  }),
  getDb: vi.fn(async () => estado.banco.db),
  getClient: vi.fn(async () => estado.banco.client),
  getWalletByUser: vi.fn(async (userId) => estado.banco.db.collection('wallets').findOne({ userId })),
  createWallet: vi.fn(async ({ userId }) => {
    const carteira = { _id: `w-${userId}`, userId, status: 'active' };
    await estado.banco.db.collection('wallets').insertOne(carteira);
    return carteira;
  }),
}));
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({
  verificarCadastroFinanceiro: vi.fn(async () => ({ ok: true, cpf: '52998224725', usuario: {} })),
}));

const { calcularResumo } = await import('../../lib/ledger/ledger.js');
const { default: handlerPay } = await import('../../pages/api/assinaturas/pay.js');
const { default: handlerResumo } = await import('../../pages/api/assinaturas/resumo.js');
const { default: handlerJoin } = await import('../../pages/api/grupos/[id]/join.js');
const { default: handlerModeracaoAdmin } = await import('../../pages/api/admin/grupos/[id]/moderacao.js');

const donoId = new ObjectId();
const adminSistemaId = new ObjectId();
const ana = new ObjectId();
const bia = new ObjectId();
const caio = new ObjectId();
const dora = new ObjectId();

const docs = (nome) => estado.banco.db.collection(nome).docs;
const sessao = (id, extra = {}) => ({
  user: { id: String(id), email: `${id}@teste`, systemRole: 'user', contaValidada: true, isBlocked: false, ...extra },
});

const chamar = async (handler, req) => {
  const res = criarRes();
  await handler({ headers: {}, socket: {}, query: {}, body: {}, ...req }, res);
  return res;
};

let semente = 0;
const creditar = (userId, valor) => {
  semente += 1;
  docs('walletTransactions').push({
    _id: `semente-${semente}`, walletId: `w-${userId}`, type: 'credit', amount: valor, status: 'confirmed',
    source: 'pix', referenceId: null, categoria: 'pessoal', organizacaoId: null, grupoId: null,
    participacaoId: null, operacaoId: `semente:${semente}`, pernasTotal: 1, createdAt: new Date(),
  });
};

const semearUsuario = (userId, saldoInicial = 0) => {
  docs('users').push({ _id: userId, nome: 'Pessoa', email: `${userId}@teste`, contaValidada: true, isBlocked: false });
  docs('wallets').push({ _id: `w-${userId}`, userId: String(userId), status: 'active' });
  if (saldoInicial > 0) creditar(userId, saldoInicial);
};

/** Grupo público aprovado, mensalidade R$ 10,50 (repasse 10 + taxa 0,50), com o membro do dono. */
const semearGrupo = ({ capacidade = 4, acesso = 'imediato' } = {}) => {
  const _id = new ObjectId();
  docs('grupos').push({
    _id, nome: `Grupo ${_id}`, slug: `grupo-${_id}`, status: 'ativo', statusDetalhado: 'em_formacao', acesso,
    capacidadeTotal: capacidade, valorTotal: 10 * capacidade, valorPorVaga: 10.5, repassePorVaga: 10,
    taxaPorVaga: 0.5, precoValido: true, fidelidade: { periodoMeses: 3 },
    adminId: donoId, adminIdString: String(donoId), admin: { userId: donoId },
    moderacao: {
      envio: 1, enviadoEm: new Date('2026-11-20T13:00:00Z'), revisaoPendente: false,
      aprovacao: { tipo: 'manual', em: new Date('2026-11-21T13:00:00Z') }, ultimaDecisao: null, historico: [],
    },
  });
  docs('membrosGrupo').push({
    _id: new ObjectId(), grupoId: _id, userId: donoId, papel: 'admin', status: 'ativo',
    temCaucao: false, aguardandoEnvioAcesso: false,
  });
  return _id;
};

const carteira = (userId) => calcularResumo(docs('walletTransactions').filter((l) => l.walletId === `w-${userId}`));
const caucaoDe = (userId) => carteira(userId).categorias.caucao.valor;
const retidoDe = (userId) => carteira(userId).categorias.retido_entrada.valor;
const participacao = (grupoId, userId) => docs('membrosGrupo')
  .find((m) => String(m.grupoId) === String(grupoId) && String(m.userId) === String(userId));
const membrosNaoDono = (grupoId) => docs('membrosGrupo')
  .filter((m) => String(m.grupoId) === String(grupoId) && m.papel !== 'admin');
const notificacoesDe = (userId) => docs('notificacoesUsuario').filter((n) => String(n.userId) === String(userId));

const verResumo = async (userId, grupoId) => {
  estado.session = sessao(userId);
  const res = await chamar(handlerResumo, { method: 'GET', query: { grupoId: String(grupoId) } });
  expect(res.statusCode).toBe(200);
  return res.body.resumo;
};

let chaves = 0;
/** Corpo do POST /api/assinaturas/pay montado a partir do resumo, como a tela faz. */
const corpoDeEntrada = async (userId, grupoId) => {
  const resumo = await verResumo(userId, grupoId);
  chaves += 1;
  return {
    grupoId: String(grupoId), chave: `chave-contrato-${chaves}`, vinculo: 'amigo',
    aceiteRegras: { versao: resumo.regras.versao }, versaoResumo: resumo.versaoResumo,
    saldoVisto: resumo.saldoDisponivel,
  };
};

const pagar = (userId, corpo) => chamar(handlerPay, { method: 'POST', body: corpo, sessao: sessao(userId) });

const entrar = async (userId, grupoId) => {
  const corpo = await corpoDeEntrada(userId, grupoId);
  const res = await pagar(userId, corpo);
  expect(res.statusCode).toBe(200);
  return { corpo, res };
};

const sair = (userId, grupoId) => {
  estado.session = sessao(userId);
  return chamar(handlerJoin, { method: 'DELETE', query: { id: String(grupoId) }, body: { userId: String(userId) } });
};

beforeEach(() => {
  estado.banco = criarBancoTransacional();
  estado.session = null;
  docs('users').push({ _id: donoId, nome: 'Dono', email: 'dono@teste', contaValidada: true });
});

describe('006-checkout-caucao — contrato', () => {
  // US1/AC1 + AC4 · FR-004, FR-012, FR-015, FR-016, FR-018, FR-019, FR-020 · SC-001
  it('entrada cobra mensalidade + caução com valores do servidor, grava participação e fatura, e repetir não cobra de novo', async () => {
    const grupoId = semearGrupo();
    semearUsuario(ana, 30);
    const corpo = await corpoDeEntrada(ana, grupoId);

    const res = await pagar(ana, { ...corpo, amount: 1, valor: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'paga', repetida: false });

    const membro = participacao(grupoId, ana);
    expect(membro).toMatchObject({
      papel: 'membro', status: 'ativo', aguardandoEnvioAcesso: true, temCaucao: true, vinculo: 'amigo',
      aceiteRegras: { versao: corpo.aceiteRegras.versao },
      caucao: { valor: 10.5, situacao: 'bloqueada' },
    });
    expect(membro.aceiteRegras.em).toBeInstanceOf(Date);

    expect(carteira(ana).disponivel).toBe(9);
    expect(carteira(ana).categorias.caucao.porGrupo)
      .toEqual([{ grupoId: String(grupoId), participacaoId: String(membro._id), valor: 10.5 }]);
    expect(retidoDe(ana)).toBe(0);

    expect(docs('invoices')).toHaveLength(1);
    expect(docs('invoices')[0]).toMatchObject({
      status: 'paga', amount: 21,
      composicao: { repasseDono: 10, taxaCotea: 0.5, caucao: 10.5, taxaPagamento: 0 },
      entrada: { vinculo: 'amigo', participacaoId: String(membro._id), chave: corpo.chave },
    });
    expect(String(membro.invoiceId)).toBe(String(docs('invoices')[0]._id));
    expect(notificacoesDe(donoId).length).toBeGreaterThan(0);
    expect(notificacoesDe(ana).length).toBeGreaterThan(0);

    const lancamentos = docs('walletTransactions').length;
    const repetida = await pagar(ana, corpo);
    expect(repetida.statusCode).toBe(200);
    expect(repetida.body).toMatchObject({ status: 'paga', repetida: true });
    expect(docs('walletTransactions')).toHaveLength(lancamentos);
    expect(docs('invoices')).toHaveLength(1);
    expect(membrosNaoDono(grupoId)).toHaveLength(1);
  });

  // US1/AC2 + AC4 · FR-016, FR-017 · SC-002, SC-003 (corrida pela última vaga e clique duplo)
  it('última vaga disputada: só um entra e o outro não é debitado; clique duplo cobra uma vez', async () => {
    const lotavel = semearGrupo({ capacidade: 2 });
    semearUsuario(ana, 30);
    semearUsuario(bia, 30);
    const corpoAna = await corpoDeEntrada(ana, lotavel);
    const corpoBia = await corpoDeEntrada(bia, lotavel);

    const respostas = await Promise.all([pagar(ana, corpoAna), pagar(bia, corpoBia)]);

    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(respostas.find((r) => r.statusCode === 409).body.codigo).toBe('grupo_cheio');
    expect(membrosNaoDono(lotavel)).toHaveLength(1);
    expect(docs('invoices')).toHaveLength(1);
    const venceu = String(membrosNaoDono(lotavel)[0].userId);
    const [vencedor, perdedor] = venceu === String(ana) ? [ana, bia] : [bia, ana];
    expect(carteira(vencedor).disponivel).toBe(9);
    expect(carteira(perdedor).disponivel).toBe(30);
    expect(caucaoDe(perdedor)).toBe(0);

    const outro = semearGrupo();
    semearUsuario(caio, 50);
    const corpo = await corpoDeEntrada(caio, outro);
    const duplo = await Promise.all([pagar(caio, corpo), pagar(caio, corpo)]);
    expect(duplo.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(membrosNaoDono(outro)).toHaveLength(1);
    expect(docs('invoices').filter((f) => f.grupoId === String(outro))).toHaveLength(1);
    expect(carteira(caio).disponivel).toBe(29);
    expect(caucaoDe(caio)).toBe(10.5);
  });

  // US3/AC1, AC3, AC4 + US5/AC2 · FR-001, FR-002, FR-003, FR-005, FR-006, FR-009, FR-010, FR-013
  it('resumo divide saldo e PIX; saldo curto, resumo velho, vínculo ou aceite ausentes e o join antigo não cobram nada', async () => {
    const grupoId = semearGrupo();
    semearUsuario(ana, 5);

    const resumo = await verResumo(ana, grupoId);
    expect(resumo).toMatchObject({
      mensalidade: 10.5, caucao: 10.5, taxa: 0, total: 21,
      saldoDisponivel: 5, valorSaldo: 5, valorPix: 16, retemMensalidade: false, fidelidadeMeses: 3,
    });
    expect(resumo.regras.itens.length).toBeGreaterThanOrEqual(5);

    const corpo = await corpoDeEntrada(ana, grupoId);
    const curto = await pagar(ana, corpo);
    expect(curto.statusCode).toBe(402);
    expect(curto.body).toMatchObject({ codigo: 'saldo_insuficiente', resumo: { valorPix: 16 } });

    creditar(ana, 25);
    const saldoMudou = await pagar(ana, corpo);
    expect(saldoMudou.statusCode).toBe(409);
    expect(saldoMudou.body).toMatchObject({ codigo: 'resumo_desatualizado', resumo: { saldoDisponivel: 30, valorPix: 0 } });

    const atual = { ...corpo, saldoVisto: 30 };
    for (const vinculo of [undefined, '', 'colega']) {
      const r = await pagar(ana, { ...atual, vinculo });
      expect(r.statusCode, `vinculo=${vinculo}`).toBe(400);
      expect(r.body.codigo, `vinculo=${vinculo}`).toBe('vinculo_invalido');
    }
    for (const aceiteRegras of [undefined, { versao: 'antiga' }]) {
      const r = await pagar(ana, { ...atual, aceiteRegras });
      expect(r.statusCode).toBe(400);
      expect(r.body.codigo).toBe('aceite_obrigatorio');
    }

    Object.assign(docs('grupos')[0], { valorPorVaga: 21, repassePorVaga: 20, taxaPorVaga: 1 });
    const precoMudou = await pagar(ana, atual);
    expect(precoMudou.statusCode).toBe(409);
    expect(precoMudou.body).toMatchObject({ codigo: 'resumo_desatualizado', resumo: { total: 42 } });

    docs('invoices').push({ _id: 'fatura-antiga', userId: String(ana), grupoId: String(grupoId), amount: 10.5, status: 'paga' });
    estado.session = sessao(ana);
    const joinAntigo = await chamar(handlerJoin, {
      method: 'POST', query: { id: String(grupoId) }, body: { invoiceId: 'fatura-antiga' },
    });
    expect(joinAntigo.statusCode).toBe(410);

    expect(membrosNaoDono(grupoId)).toHaveLength(0);
    expect(docs('invoices')).toHaveLength(1);
    expect(docs('walletTransactions').filter((l) => l.type === 'debit')).toHaveLength(0);
    expect(carteira(ana).disponivel).toBe(30);
  });

  // US2/AC1, AC2, AC4, AC5 · FR-012, FR-016, FR-021, FR-022, FR-024, FR-031 · SC-004
  it('a caução volta uma única vez na saída do membro e no cancelamento pelo Cotea; membro sem caução não recebe nada', async () => {
    const grupoId = semearGrupo();
    semearUsuario(ana, 30);
    const { corpo } = await entrar(ana, grupoId);

    const saida = await sair(ana, grupoId);
    expect(saida.statusCode).toBe(200);
    expect(saida.body.devolvido).toEqual({ caucao: 10.5, mensalidade: 0, total: 10.5 });
    expect(participacao(grupoId, ana)).toBeUndefined();
    expect(carteira(ana).disponivel).toBe(19.5);
    expect(caucaoDe(ana)).toBe(0);
    expect(docs('invoices')[0].entrada.vinculo).toBe('amigo');
    expect(docs('invoices')[0].encerramento.em).toBeInstanceOf(Date);

    const antes = docs('walletTransactions').length;
    const velha = await pagar(ana, corpo);
    expect(velha.statusCode).toBe(409);
    expect(velha.body.codigo).toBe('confirmacao_ja_utilizada');
    expect(docs('walletTransactions')).toHaveLength(antes);

    const cancelavel = semearGrupo();
    semearUsuario(bia, 30);
    semearUsuario(caio, 30);
    await entrar(bia, cancelavel);
    await entrar(caio, cancelavel);
    const avisosDaBia = notificacoesDe(bia).length;

    estado.session = sessao(adminSistemaId, { systemRole: 'admin' });
    const cancelado = await chamar(handlerModeracaoAdmin, {
      method: 'POST', query: { id: String(cancelavel) }, body: { acao: 'cancelar', texto: 'Fraude' },
    });
    expect(cancelado.statusCode).toBe(200);
    for (const id of [bia, caio]) {
      expect(carteira(id).disponivel).toBe(19.5);
      expect(caucaoDe(id)).toBe(0);
      expect(participacao(cancelavel, id).caucao.situacao).toBe('devolvida');
    }
    expect(notificacoesDe(bia).length).toBeGreaterThanOrEqual(avisosDaBia + 2); // cancelamento + devolução

    const depois = docs('walletTransactions').length;
    const saidaTardia = await sair(bia, cancelavel);
    expect(saidaTardia.statusCode).toBe(200);
    expect(saidaTardia.body.devolvido.total).toBe(0);
    expect(docs('walletTransactions')).toHaveLength(depois);
    expect(carteira(bia).disponivel).toBe(19.5);

    const antigo = semearGrupo();
    semearUsuario(dora, 0);
    docs('membrosGrupo').push({
      _id: new ObjectId(), grupoId: antigo, userId: dora, papel: 'membro', status: 'ativo',
      temCaucao: false, aguardandoEnvioAcesso: true,
    });
    const saidaAntiga = await sair(dora, antigo);
    expect(saidaAntiga.statusCode).toBe(200);
    expect(saidaAntiga.body.devolvido.total).toBe(0);
    expect(participacao(antigo, dora)).toBeUndefined();
    expect(docs('walletTransactions')).toHaveLength(depois);
  });

  // US4/AC1–AC5 · FR-025, FR-026, FR-027, FR-028 · SC-005
  it('grupo após completar: retém a mensalidade, devolve tudo antes de lotar e só a caução depois de lotar ou de receber acesso', async () => {
    const grupoId = semearGrupo({ capacidade: 3, acesso: 'apos_completar' });
    semearUsuario(ana, 30);
    semearUsuario(bia, 30);
    semearUsuario(caio, 30);

    expect(await verResumo(ana, grupoId)).toMatchObject({ retemMensalidade: true, aposCompletar: true });
    await entrar(ana, grupoId);
    expect(carteira(ana).disponivel).toBe(9);
    expect(retidoDe(ana)).toBe(10.5);
    expect(caucaoDe(ana)).toBe(10.5);
    expect(participacao(grupoId, ana).retencao).toMatchObject({ valor: 10.5, situacao: 'retida' });

    const cedo = await sair(ana, grupoId);
    expect(cedo.body.devolvido).toEqual({ caucao: 10.5, mensalidade: 10.5, total: 21 });
    expect(carteira(ana).disponivel).toBe(30);
    expect(retidoDe(ana)).toBe(0);

    await entrar(ana, grupoId);
    expect((await verResumo(bia, grupoId)).retemMensalidade).toBe(false); // quem completa não fica retido
    await entrar(bia, grupoId);
    const grupo = docs('grupos').find((g) => String(g._id) === String(grupoId));
    expect(grupo.lotadoEm).toBeInstanceOf(Date);
    expect(grupo.statusDetalhado).toBe('ativo');
    expect(retidoDe(ana)).toBe(0);
    expect(retidoDe(bia)).toBe(0);
    expect(carteira(ana).disponivel).toBe(9);
    expect(participacao(grupoId, ana).retencao.situacao).toBe('liberada');

    const tarde = await sair(ana, grupoId);
    expect(tarde.body.devolvido).toEqual({ caucao: 10.5, mensalidade: 0, total: 10.5 });
    expect(carteira(ana).disponivel).toBe(19.5);

    expect((await verResumo(caio, grupoId)).retemMensalidade).toBe(false);
    await entrar(caio, grupoId);
    expect(retidoDe(caio)).toBe(0);

    const comAcesso = semearGrupo({ capacidade: 4, acesso: 'apos_completar' });
    semearUsuario(dora, 30);
    await entrar(dora, comAcesso);
    expect(retidoDe(dora)).toBe(10.5);
    // O envio de acesso (POST /api/grupos/[id]/acessos) grava estes dois campos.
    Object.assign(participacao(comAcesso, dora), { aguardandoEnvioAcesso: false, dataEnvioAcesso: new Date() });
    const comAcessoSaiu = await sair(dora, comAcesso);
    expect(comAcessoSaiu.body.devolvido).toEqual({ caucao: 10.5, mensalidade: 0, total: 10.5 });
    expect(retidoDe(dora)).toBe(0);
    expect(carteira(dora).disponivel).toBe(19.5);
  });
});
