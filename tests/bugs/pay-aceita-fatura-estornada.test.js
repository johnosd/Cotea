// Regressão pay-aceita-fatura-estornada: o `pay` nunca cobra, reabre nem dá como paga
// uma fatura que já existe. Reescrito na 006-checkout-caucao (T014): a entrada ignora
// `invoiceId` e sempre emite a própria fatura, na mesma transação da cobrança.
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
const { logAudit } = await import('../../lib/audit');
const { default: handlerPay } = await import('../../pages/api/assinaturas/pay.js');
const { default: handlerResumo } = await import('../../pages/api/assinaturas/resumo.js');

const c = criarCenario(estado, { calcularResumo });
let membroId;
let grupoId;

beforeEach(() => {
  logAudit.mockClear();
  estado.banco = criarBancoTransacional();
  membroId = c.semearUsuario(100);
  estado.session = sessao(membroId);
  grupoId = c.semearGrupo();
});

const antiga = (status) => {
  const fatura = {
    _id: 'fatura-1', userId: String(membroId), grupoId: String(grupoId), amount: 10.5,
    ...(status === undefined ? {} : { status }),
  };
  c.docs('invoices').push(fatura);
  return structuredClone(fatura);
};
const noBanco = () => c.docs('invoices').find((f) => f._id === 'fatura-1');

describe('POST /api/assinaturas/pay — fatura existente nunca é reaproveitada', () => {
  it.each(['estornada', 'cancelada', 'pending', undefined, 'paga', 'aguardando_pagamento', 'aguardando_recarga'])(
    'fatura %s no corpo: a entrada emite fatura própria e a antiga não muda',
    async (status) => {
      const antes = antiga(status);
      const pedido = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
      const res = await chamar(handlerPay, { body: { ...pedido, invoiceId: 'fatura-1' } });
      expect(res.statusCode).toBe(200);
      expect(res.body.invoiceId).not.toBe('fatura-1');
      expect(noBanco()).toEqual(antes);
      expect(c.docs('invoices')).toHaveLength(2);
      expect(c.debitos().map((l) => l.amount)).toEqual([21]);
    }
  );

  it('só grupoId + invoiceId (tela antiga): 400, sem lançamento, auditoria nem mudança', async () => {
    const antes = antiga('aguardando_recarga');
    const res = await chamar(handlerPay, { body: { grupoId: String(grupoId), invoiceId: 'fatura-1' } });
    expect(res.statusCode).toBe(400);
    expect(noBanco()).toEqual(antes);
    expect(c.debitos()).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
