// Regressão B-06: no driver mongodb 6.x, findOneAndUpdate devolve o documento
// direto (ou null), sem `{ value }`. O fake de tests/helpers/db-grupos-memoria.js
// já segue esse contrato.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null, sessao: null }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  getWalletByUser: vi.fn(),
  createWallet: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.sessao) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('../../lib/ratelimit', () => ({ getClientIp: () => '127.0.0.1' }));

const { markInvoicePaid, markInvoiceAwaitingTopUp, markInvoiceRefunded, INVOICE_STATUS } = await import('../../lib/invoices.js');
const { default: blockHandler } = await import('../../pages/api/admin/users/[id]/block.js');
const { logAudit } = await import('../../lib/audit');

beforeEach(() => {
  estado.db = criarDbMemoria();
  estado.sessao = { user: { id: 'admin1', email: 'admin@teste', systemRole: 'admin' } };
  vi.clearAllMocks();
});

describe('lib/invoices — retorna o documento atualizado (driver 6)', () => {
  const semear = () => estado.db.collection('invoices').docs.push({
    _id: 'inv-1', userId: 'u', grupoId: 'g', amount: 10, status: INVOICE_STATUS.AGUARDANDO_PAGAMENTO,
  });

  it('markInvoicePaid devolve a fatura paga', async () => {
    semear();
    const fatura = await markInvoicePaid({ invoiceId: 'inv-1', walletId: 'w1', ledgerId: 'l1' });
    expect(fatura).toMatchObject({ _id: 'inv-1', status: INVOICE_STATUS.PAGA, walletId: 'w1', ledgerId: 'l1' });
  });

  it('markInvoiceAwaitingTopUp devolve a fatura aguardando recarga', async () => {
    semear();
    const fatura = await markInvoiceAwaitingTopUp({ invoiceId: 'inv-1', faltante: 4, saldoDisponivel: 6 });
    expect(fatura).toMatchObject({ _id: 'inv-1', status: INVOICE_STATUS.AGUARDANDO_RECARGA, faltante: 4, saldoDisponivel: 6 });
  });

  it('markInvoiceRefunded devolve a fatura estornada', async () => {
    semear();
    const fatura = await markInvoiceRefunded({ invoiceId: 'inv-1', walletId: 'w1', ledgerId: 'l2' });
    expect(fatura).toMatchObject({ _id: 'inv-1', status: INVOICE_STATUS.ESTORNADA, ledgerId: 'l2' });
  });

  it('fatura inexistente devolve null sem lançar', async () => {
    await expect(markInvoicePaid({ invoiceId: 'nao-existe', walletId: 'w', ledgerId: 'l' })).resolves.toBeNull();
    await expect(markInvoiceAwaitingTopUp({ invoiceId: 'nao-existe', faltante: 1, saldoDisponivel: 0 })).resolves.toBeNull();
    await expect(markInvoiceRefunded({ invoiceId: 'nao-existe', walletId: 'w', ledgerId: 'l' })).resolves.toBeNull();
  });
});

describe('PUT /api/admin/users/[id]/block — driver 6', () => {
  const alvoId = new ObjectId();
  const chamar = async (id, body) => {
    const res = criarRes();
    await blockHandler({ method: 'PUT', query: { id: String(id) }, body, headers: {}, socket: {} }, res);
    return res;
  };

  it('bloqueia usuário existente: 200, isBlocked gravado e auditoria registrada (antes respondia 404)', async () => {
    estado.db.collection('users').docs.push({ _id: alvoId, email: 'alvo@teste', isBlocked: false });
    const res = await chamar(alvoId, { isBlocked: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ isBlocked: true });
    expect(estado.db.collection('users').docs[0].isBlocked).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.blocked',
      targetId: String(alvoId),
      details: { targetEmail: 'alvo@teste' },
    }));
  });

  it('desbloqueia usuário existente', async () => {
    estado.db.collection('users').docs.push({ _id: alvoId, email: 'alvo@teste', isBlocked: true });
    const res = await chamar(alvoId, { isBlocked: false });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ isBlocked: false });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.unblocked' }));
  });

  it('usuário inexistente: 404 (não 500 por TypeError) e sem auditoria', async () => {
    const res = await chamar(new ObjectId(), { isBlocked: true });
    expect(res.statusCode).toBe(404);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
