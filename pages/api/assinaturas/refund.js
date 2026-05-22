import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb, insertLedgerEntry } from '../../../lib/mongodb';
import { INVOICE_STATUS, getInvoiceById, markInvoiceRefunded } from '../../../lib/invoices';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../lib/wallet';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const userId = getSessionUserId(session);
    if (!session || !userId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }

    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) {
      return res.status(400).json({ error: 'invoiceId obrigatorio' });
    }

    const invoice = await getInvoiceById(invoiceId);
    if (!invoice || invoice.userId !== String(userId)) {
      return res.status(404).json({ error: 'Fatura nao encontrada' });
    }

    if (invoice.status === INVOICE_STATUS.ESTORNADA) {
      return res.status(200).json({ invoiceId, status: invoice.status, message: 'Fatura ja estornada' });
    }

    if (invoice.status !== INVOICE_STATUS.PAGA) {
      return res.status(400).json({ error: 'Apenas faturas pagas podem ser estornadas' });
    }

    const valor = normalizeAmount(invoice.amount);
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ error: 'Valor da fatura invalido para estorno' });
    }

    const wallet = await ensureWallet(userId);

    // Cria credito de estorno idempotente por referenceId+source
    const db = await getDb();
    const existingCredit = await db.collection('walletTransactions').findOne({
      referenceId: invoiceId,
      type: 'credit',
      source: 'estorno_assinatura',
    });
    let creditEntry = existingCredit;

    if (!creditEntry) {
      try {
        creditEntry = await insertLedgerEntry({
          walletId: wallet._id,
          type: 'credit',
          amount: valor,
          source: 'estorno_assinatura',
          referenceId: invoiceId,
          status: 'confirmed',
          description: `Estorno fatura ${invoiceId}`,
        });
      } catch (err) {
        if (err?.code === 11000) {
          creditEntry = await db.collection('walletTransactions').findOne({
            referenceId: invoiceId,
            type: 'credit',
            source: 'estorno_assinatura',
          });
        } else {
          throw err;
        }
      }
    }

    const balances = await calculateBalances(wallet._id);
    const refunded = await markInvoiceRefunded({
      invoiceId,
      walletId: wallet._id,
      ledgerId: creditEntry._id,
      refundedAt: new Date(),
    });

    return res.status(200).json({
      invoiceId,
      status: refunded?.status || INVOICE_STATUS.ESTORNADA,
      ledgerId: creditEntry._id,
      walletId: wallet._id,
      balance: balances.balance,
      available: balances.available,
    });
  } catch (error) {
    console.error('Erro ao estornar fatura:', error);
    return res.status(500).json({ error: 'Erro interno ao estornar' });
  }
}
