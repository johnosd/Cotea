import { randomUUID } from 'crypto';
import { getDb } from './mongodb';
import { normalizeAmount } from './wallet';

export const INVOICE_STATUS = {
  AGUARDANDO_PAGAMENTO: 'aguardando_pagamento',
  AGUARDANDO_RECARGA: 'aguardando_recarga',
  PAGA: 'paga',
  ESTORNADA: 'estornada',
  // Fatura aberta do checkout antigo, encerrada pela migração da 006.
  CANCELADA: 'cancelada',
};

// Partes opcionais da composição (006-checkout-caucao): só entram quando informadas.
const PARTES_OPCIONAIS = ['caucao', 'taxaPagamento'];

/**
 * Valida e normaliza a composição da fatura (003-preco-por-vaga): repasse ao
 * dono + taxa Cotea e, na entrada em grupo (006), caução + taxa do meio de
 * pagamento, congelados na emissão. A soma precisa bater com o valor.
 */
function normalizarComposicao(composicao, valor) {
  if (composicao === undefined || composicao === null) return undefined;
  const campos = ['repasseDono', 'taxaCotea', ...PARTES_OPCIONAIS.filter((c) => composicao[c] !== undefined)];
  const normalizada = {};
  let soma = 0;
  for (const campo of campos) {
    const parte = normalizeAmount(composicao[campo]);
    if (!Number.isFinite(parte) || parte < 0) throw new Error('Composicao da fatura invalida');
    normalizada[campo] = parte;
    soma += Math.round(parte * 100);
  }
  if (soma !== Math.round(valor * 100)) {
    throw new Error('Composicao da fatura nao soma o valor');
  }
  return normalizada;
}

export async function createInvoice({
  _id, userId, grupoId, amount, status, description = '', metadata = {}, composicao,
  entrada, walletId, ledgerId, paidAt,
}, { session } = {}) {
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
    _id: _id || randomUUID(),
    userId: String(userId),
    grupoId: String(grupoId),
    amount: valor,
    ...(composicaoNormalizada ? { composicao: composicaoNormalizada } : {}),
    status: status || INVOICE_STATUS.AGUARDANDO_PAGAMENTO,
    description: description || undefined,
    metadata,
    ...(entrada ? { entrada } : {}),
    ...(walletId ? { walletId } : {}),
    ...(ledgerId ? { ledgerId } : {}),
    ...(paidAt ? { paidAt } : {}),
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
