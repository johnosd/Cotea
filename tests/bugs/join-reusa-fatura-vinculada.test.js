// Regressão: um pagamento dá direito a UMA entrada. Reescrito na 006-checkout-caucao
// (T014): o POST /join (que criava o membro a partir de uma fatura) foi desativado, e a
// proteção passou para a chave da confirmação no POST /api/assinaturas/pay.
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
const { default: handlerJoin } = await import('../../pages/api/grupos/[id]/join.js');

const c = criarCenario(estado, { calcularResumo });
let membroId;
let grupoId;

beforeEach(() => {
  estado.banco = criarBancoTransacional();
  membroId = c.semearUsuario(100);
  estado.session = sessao(membroId);
  grupoId = c.semearGrupo();
});

const semearFatura = (extra = {}) => c.docs('invoices').push({
  _id: 'fatura-1', userId: String(membroId), grupoId: String(grupoId), amount: 10.5, status: 'paga', ...extra,
});
const sair = () => {
  const lista = c.docs('membrosGrupo');
  lista.splice(lista.findIndex((m) => String(m.userId) === String(membroId)), 1);
};

describe('um pagamento, uma entrada', () => {
  it.each([
    ['livre', {}],
    ['vinculada a uma entrada encerrada', { vinculadoEm: new Date() }],
  ])('POST /join com fatura paga %s: 410 e nenhum membro', async (_rotulo, extra) => {
    semearFatura(extra);
    const res = await chamar(handlerJoin, { query: { id: String(grupoId) }, body: { invoiceId: 'fatura-1' } });
    expect(res.statusCode).toBe(410);
    expect(res.body.codigo).toBe('rota_desativada');
    expect(c.participacao(grupoId, membroId)).toBeUndefined();
  });

  it('entrar, sair e repetir a mesma confirmação: 409, sem membro e sem nova cobrança', async () => {
    const pedido = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
    expect((await chamar(handlerPay, { body: pedido })).statusCode).toBe(200);
    sair();
    const res = await chamar(handlerPay, { body: pedido });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('confirmacao_ja_utilizada');
    expect(c.participacao(grupoId, membroId)).toBeUndefined();
    expect(c.debitos()).toHaveLength(1);
  });

  it('a mesma chave em outro grupo não aproveita o pagamento anterior', async () => {
    const pedido = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
    await chamar(handlerPay, { body: pedido });
    const outro = c.semearGrupo();
    const res = await chamar(handlerPay, { body: { ...pedido, grupoId: String(outro) } });
    expect(res.body.codigo).toBe('confirmacao_ja_utilizada');
    expect(c.participacao(outro, membroId)).toBeUndefined();
    expect(c.debitos()).toHaveLength(1);
  });

  it('depois de sair, uma confirmação nova cobra de novo e permite a reentrada', async () => {
    await chamar(handlerPay, { body: await c.corpoDeEntrada(handlerResumo, membroId, grupoId) });
    sair();
    const res = await chamar(handlerPay, { body: await c.corpoDeEntrada(handlerResumo, membroId, grupoId) });
    expect(res.statusCode).toBe(200);
    expect(c.debitos()).toHaveLength(2);
    expect(c.docs('invoices')).toHaveLength(2);
    expect(c.participacao(grupoId, membroId)).toBeTruthy();
  });
});
