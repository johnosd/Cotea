// Preço na cobrança (003-preco-por-vaga, US2), sobre a entrada atômica da
// 006-checkout-caucao: mensalidade e caução saem do preço gravado no grupo.
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

beforeEach(() => {
  estado.banco = criarBancoTransacional();
  membroId = c.semearUsuario(100);
  estado.session = sessao(membroId);
});

const pagar = (body) => chamar(handlerPay, { body });
const pedido = (grupoId) => c.corpoDeEntrada(handlerResumo, membroId, grupoId);

describe('POST /api/assinaturas/pay — preço único (003 US2)', () => {
  it('cobra o valor por vaga gravado e grava a composição, ignorando amount do body', async () => {
    const grupoId = c.semearGrupo();
    const res = await pagar({ ...(await pedido(grupoId)), amount: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(21);
    const [fatura] = c.docs('invoices');
    expect(fatura.amount).toBe(21);
    expect(fatura.composicao).toEqual({ repasseDono: 10, taxaCotea: 0.5, caucao: 10.5, taxaPagamento: 0 });
    expect(c.debitos().map((l) => l.amount)).toEqual([21]);
  });

  it('recusa com 409 grupo legado sem preço válido, sem fallback e sem criar fatura', async () => {
    const grupoId = c.semearGrupo({ precoValido: false });
    const res = await pagar({ grupoId: String(grupoId), amount: 40 });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'preco_indisponivel' });
    expect(c.docs('invoices')).toHaveLength(0);
    expect(c.debitos()).toHaveLength(0);
  });

  it('preço alterado depois do resumo: nada é cobrado até nova confirmação, e então vale o novo', async () => {
    const grupoId = c.semearGrupo();
    const velho = await pedido(grupoId);
    Object.assign(c.grupo(grupoId), { valorPorVaga: 21, repassePorVaga: 20, taxaPorVaga: 1 });
    const recusa = await pagar(velho);
    expect(recusa.body).toMatchObject({ codigo: 'resumo_desatualizado', resumo: { mensalidade: 21, total: 42 } });
    expect(c.debitos()).toHaveLength(0);
    expect((await pagar(await pedido(grupoId))).statusCode).toBe(200);
    expect(c.debitos().map((l) => l.amount)).toEqual([42]);
  });
});
