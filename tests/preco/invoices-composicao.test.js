// createInvoice com composição (003-preco-por-vaga, T008).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarDbMemoria } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => ({ db: null }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  getWalletByUser: vi.fn(),
  createWallet: vi.fn(),
}));

const { createInvoice } = await import('../../lib/invoices.js');

beforeEach(() => { estado.db = criarDbMemoria(); });

describe('createInvoice — composicao', () => {
  it('grava a composição quando soma o valor', async () => {
    const f = await createInvoice({ userId: 'u', grupoId: 'g', amount: 3.5, composicao: { repasseDono: 3.33, taxaCotea: 0.17 } });
    expect(f.composicao).toEqual({ repasseDono: 3.33, taxaCotea: 0.17 });
  });

  it('recusa composição que não soma o valor', async () => {
    await expect(createInvoice({ userId: 'u', grupoId: 'g', amount: 3.5, composicao: { repasseDono: 3.33, taxaCotea: 0.16 } }))
      .rejects.toThrow('Composicao da fatura nao soma o valor');
    expect(estado.db.collection('invoices').docs).toHaveLength(0);
  });

  it('sem composição continua como antes', async () => {
    const f = await createInvoice({ userId: 'u', grupoId: 'g', amount: 10 });
    expect(f).not.toHaveProperty('composicao');
  });

  // 006-checkout-caucao (FR-019): a fatura de entrada registra caução e taxa do meio.
  it('entrada: caução e taxa entram na soma e na composição; id e dados da entrada informados', async () => {
    const f = await createInvoice({
      _id: 'fatura-1', userId: 'u', grupoId: 'g', amount: 21, status: 'paga',
      composicao: { repasseDono: 10, taxaCotea: 0.5, caucao: 10.5, taxaPagamento: 0 },
      entrada: { chave: 'k' }, walletId: 'w', ledgerId: 'l', paidAt: new Date(),
    });
    expect(f).toMatchObject({ _id: 'fatura-1', entrada: { chave: 'k' }, walletId: 'w', ledgerId: 'l' });
    expect(f.composicao).toEqual({ repasseDono: 10, taxaCotea: 0.5, caucao: 10.5, taxaPagamento: 0 });
    await expect(createInvoice({ userId: 'u', grupoId: 'g', amount: 21, composicao: { repasseDono: 10, taxaCotea: 0.5, caucao: 10 } }))
      .rejects.toThrow('Composicao da fatura nao soma o valor');
    await expect(createInvoice({ userId: 'u', grupoId: 'g', amount: 21, composicao: { repasseDono: 31.5, taxaCotea: 0, caucao: -10.5 } }))
      .rejects.toThrow('Composicao da fatura invalida');
  });
});
