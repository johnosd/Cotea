import { randomUUID } from 'crypto';
import { getDb } from './mongodb';
import { normalizeAmount } from './wallet';

export const INVOICE_STATUS = {
  AGUARDANDO_PAGAMENTO: 'aguardando_pagamento',
  AGUARDANDO_RECARGA: 'aguardando_recarga',
  PAGA: 'paga',
  ESTORNADA: 'estornada',
};

/**
 * Valida e normaliza a composição da fatura (003-preco-por-vaga): repasse ao
 * dono + taxa Cotea, congelados na emissão. A soma precisa bater com o valor.
 */
function normalizarComposicao(composicao, valor) {
  if (composicao === undefined || composicao === null) return undefined;
  const repasseDono = normalizeAmount(composicao.repasseDono);
  const taxaCotea = normalizeAmount(composicao.taxaCotea);
  if (!Number.isFinite(repasseDono) || !Number.isFinite(taxaCotea) || repasseDono < 0 || taxaCotea < 0) {
    throw new Error('Composicao da fatura invalida');
  }
  if (Math.round(repasseDono * 100) + Math.round(taxaCotea * 100) !== Math.round(valor * 100)) {
    throw new Error('Composicao da fatura nao soma o valor');
  }
  return { repasseDono, taxaCotea };
}

export async function createInvoice({ userId, grupoId, amount, status, description = '', metadata = {}, composicao }, { session } = {}) {
  if (!userId || !grupoId) {
    throw new Error('userId e grupoId sao obrigatorios para a fatura');
  }
  const valor = normalizeAmount(amount);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error('Valor da fatura invalido');
  }
  const composicaoNormalizada = normalizarComposicao(composicao, valor);

  const db = await getDb();
  const invoice = {
    _id: randomUUID(),
    userId: String(userId),
    grupoId: String(grupoId),
    amount: valor,
    ...(composicaoNormalizada ? { composicao: composicaoNormalizada } : {}),
    status: status || INVOICE_STATUS.AGUARDANDO_PAGAMENTO,
    description: description || undefined,
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.collection('invoices').insertOne(invoice, session ? { session } : undefined);
  return invoice;
}

export async function getInvoiceById(invoiceId) {
  if (!invoiceId) return null;
  const db = await getDb();
  return db.collection('invoices').findOne({ _id: invoiceId });
}

export async function markInvoicePaid({ invoiceId, walletId, ledgerId, paidAt = new Date(), balanceSnapshot = {} }, { session } = {}) {
  const db = await getDb();
  // Driver 6: findOneAndUpdate devolve o documento atualizado (ou null), sem `.value`.
  return db.collection('invoices').findOneAndUpdate(
    { _id: invoiceId },
    {
      $set: {
        status: INVOICE_STATUS.PAGA,
        walletId,
        ledgerId,
        paidAt,
        updatedAt: paidAt,
        balanceSnapshot,
      },
    },
    { returnDocument: 'after', ...(session ? { session } : {}) }
  );
}

export async function markInvoiceAwaitingTopUp({ invoiceId, faltante, saldoDisponivel }) {
  const db = await getDb();
  return db.collection('invoices').findOneAndUpdate(
    { _id: invoiceId },
    {
      $set: {
        status: INVOICE_STATUS.AGUARDANDO_RECARGA,
        faltante,
        saldoDisponivel,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );
}

export async function markInvoiceRefunded({ invoiceId, walletId, ledgerId, refundedAt = new Date() }, { session } = {}) {
  const db = await getDb();
  return db.collection('invoices').findOneAndUpdate(
    { _id: invoiceId },
    {
      $set: {
        status: INVOICE_STATUS.ESTORNADA,
        walletId,
        ledgerId,
        refundedAt,
        updatedAt: refundedAt,
      },
    },
    { returnDocument: 'after', ...(session ? { session } : {}) }
  );
}
