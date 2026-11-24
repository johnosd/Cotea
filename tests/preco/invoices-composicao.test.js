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
});
