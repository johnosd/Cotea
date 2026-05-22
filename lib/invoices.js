import { randomUUID } from 'crypto';
import { getDb } from './mongodb';
import { normalizeAmount } from './wallet';

export const INVOICE_STATUS = {
  AGUARDANDO_PAGAMENTO: 'aguardando_pagamento',
  AGUARDANDO_RECARGA: 'aguardando_recarga',
  PAGA: 'paga',
  ESTORNADA: 'estornada',
};

export async function createInvoice({ userId, grupoId, amount, status, description = '', metadata = {} }, { session } = {}) {
  if (!userId || !grupoId) {
    throw new Error('userId e grupoId sao obrigatorios para a fatura');
  }
  const valor = normalizeAmount(amount);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error('Valor da fatura invalido');
  }

  const db = await getDb();
  const invoice = {
    _id: randomUUID(),
    userId: String(userId),
    grupoId: String(grupoId),
    amount: valor,
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
  const updateResult = await db.collection('invoices').findOneAndUpdate(
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
  return updateResult.value;
}

export async function markInvoiceAwaitingTopUp({ invoiceId, faltante, saldoDisponivel }) {
  const db = await getDb();
  const updateResult = await db.collection('invoices').findOneAndUpdate(
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
  return updateResult.value;
}

export async function markInvoiceRefunded({ invoiceId, walletId, ledgerId, refundedAt = new Date() }) {
  const db = await getDb();
  const updateResult = await db.collection('invoices').findOneAndUpdate(
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
    { returnDocument: 'after' }
  );
  return updateResult.value;
}
