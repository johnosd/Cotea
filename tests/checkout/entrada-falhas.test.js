// Atomicidade da entrada (006-checkout-caucao, T016 — FR-015, SC-002): se qualquer parte
// falhar, nada fica; falha depois do commit não desfaz nem muda a resposta.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarBancoTransacional } from '../helpers/db-transacional-memoria.js';
import { chamar, criarCenario, sessao } from '../helpers/checkout-cenario.js';

const estado = vi.hoisted(() => ({ banco: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async (req) => req?.sessao ?? estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/mongodb', async () => (await import('../helpers/checkout-cenario.js')).mongoFalso(estado));
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({
  verificarCadastroFinanceiro: vi.fn(async () => ({ ok: true, cpf: '52998224725', usuario: {} })),
}));

const { calcularResumo } = await import('../../lib/ledger/ledger.js');
const { default: handlerPay } = await import('../../pages/api/assinaturas/pay.js');
const { default: handlerResumo } = await import('../../pages/api/assinaturas/resumo.js');

const c = criarCenario(estado, { calcularResumo });
let membroId;
let grupoId;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  estado.banco = criarBancoTransacional();
  membroId = c.semearUsuario(30);
  estado.session = sessao(membroId);
  grupoId = c.semearGrupo();
});

/** Faz `metodo` da coleção `nome` falhar. */
const quebrar = (nome, metodo) => {
  const colecao = estado.banco.db.collection.bind(estado.banco.db);
  vi.spyOn(estado.banco.db, 'collection').mockImplementation((n) => {
    const original = colecao(n);
    if (n !== nome) return original;
    return { ...original, [metodo]: async () => { throw new Error(`falha forcada em ${n}.${metodo}`); } };
  });
};

describe('atomicidade da entrada', () => {
  it.each([
    ['invoices', 'insertOne'],
    ['membrosGrupo', 'insertOne'],
    ['walletTransactions', 'insertMany'],
  ])('falha em %s.%s: 500 sem débito, participação, fatura nem versão do grupo', async (nome, metodo) => {
    const pedido = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
    quebrar(nome, metodo);
    const res = await chamar(handlerPay, { body: pedido });
    expect(res.statusCode).toBe(500);
    vi.restoreAllMocks();
    expect(c.debitos()).toHaveLength(0);
    expect(c.docs('invoices')).toHaveLength(0);
    expect(c.participacao(grupoId, membroId)).toBeUndefined();
    expect(c.grupo(grupoId).versaoParticipacao).toBeUndefined();
    expect(c.carteira(membroId).disponivel).toBe(30);
  });

  it('a mesma confirmação funciona depois de uma falha', async () => {
    const pedido = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
    quebrar('invoices', 'insertOne');
    await chamar(handlerPay, { body: pedido });
    vi.restoreAllMocks();
    const res = await chamar(handlerPay, { body: pedido });
    expect(res.body).toMatchObject({ status: 'paga', repetida: false });
    expect(c.debitos()).toHaveLength(1);
  });

  it('falha ao notificar depois do commit: a entrada vale e a resposta é 200', async () => {
    const pedido = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
    quebrar('notificacoesUsuario', 'insertOne');
    const res = await chamar(handlerPay, { body: pedido });
    expect(res.statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(c.participacao(grupoId, membroId)).toBeTruthy();
    expect(c.debitos()).toHaveLength(1);
  });

  it('saque pendente reduz o disponível usado no pagamento', async () => {
    c.docs('walletTransactions').push({
      _id: 'saque', walletId: `w-${membroId}`, type: 'debit', amount: 15, status: 'blocked', source: 'saque',
      categoria: 'pessoal', organizacaoId: null, operacaoId: 'saque:1', createdAt: new Date(),
    });
    const res = await chamar(handlerPay, { body: await c.corpoDeEntrada(handlerResumo, membroId, grupoId) });
    expect(res.body).toMatchObject({ codigo: 'saldo_insuficiente', resumo: { saldoDisponivel: 15, valorPix: 6 } });
    expect(c.docs('invoices')).toHaveLength(0);
  });

  it('dois cliques de chaves diferentes ao mesmo tempo: uma só entrada e uma só cobrança', async () => {
    c.creditar(membroId, 30);
    const um = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
    const outro = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
    const respostas = await Promise.all([chamar(handlerPay, { body: um }), chamar(handlerPay, { body: outro })]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(respostas.find((r) => r.statusCode === 409).body.codigo).toBe('ja_membro');
    expect(c.membrosNaoDono(grupoId)).toHaveLength(1);
    expect(c.debitos()).toHaveLength(1);
  });
});
