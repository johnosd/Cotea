import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import { getClient, getDb } from '../../../../lib/mongodb';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../../lib/wallet';

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

    const paymentId = String(req.body?.paymentId || '').trim();
    if (!paymentId) {
      return res.status(400).json({ error: 'paymentId obrigatorio' });
    }

    const db = await getDb();
    const payment = await db.collection('payments').findOne({ _id: paymentId, userId });
    if (!payment) {
      return res.status(404).json({ error: 'Pagamento nao encontrado' });
    }
    if (payment.status === 'failed') {
      return res.status(400).json({ error: 'Pagamento falhou' });
    }

    const wallet = await ensureWallet(userId);

    const confirmAndGetLedger = async (creditAmount) => {
      let ledgerDoc = await db
        .collection('walletTransactions')
        .findOne({ referenceId: paymentId, type: 'credit', source: 'pix' });
      if (ledgerDoc) return ledgerDoc;

      const toInsert = {
        _id: randomUUID(),
        walletId: wallet._id,
        type: 'credit',
        amount: creditAmount,
        source: 'pix',
        referenceId: paymentId,
        status: 'confirmed',
        createdAt: new Date(),
      };

      try {
        const result = await db.collection('walletTransactions').insertOne(toInsert);
        if (!result?.acknowledged) {
          console.error('PIX confirm: insertOne nao acknowledged', { paymentId, walletId: wallet._id });
          throw new Error('Insert do ledger nao foi confirmado');
        }
        // Releitura para garantir que ficou persistido
        const inserted = await db.collection('walletTransactions').findOne({ _id: toInsert._id });
        if (inserted) return inserted;
        console.error('PIX confirm: insert acknowledged mas nao encontrou documento apos insert', {
          _id: toInsert._id,
          paymentId,
        });
        return toInsert;
      } catch (error) {
        if (error?.code === 11000) {
          const duplicated = await db
            .collection('walletTransactions')
            .findOne({ referenceId: paymentId, type: 'credit', source: 'pix' });
          if (duplicated) return duplicated;
        }
        console.error('PIX confirm: erro ao inserir ledger', error);
        throw error;
      }
    };

    if (payment.status === 'confirmed') {
      const creditAmount = normalizeAmount(payment.amount);
      if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
        return res.status(400).json({ error: 'Valor do pagamento invalido' });
      }
      const ledgerDoc = await confirmAndGetLedger(creditAmount);
      const balances = await calculateBalances(wallet._id);
      return res.status(200).json({
        paymentId,
        status: 'confirmed',
        ledgerId: ledgerDoc._id,
        walletId: wallet._id,
        balance: balances.balance,
        available: balances.available,
      });
    }

    const creditAmount = normalizeAmount(payment.amount);
    if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
      return res.status(400).json({ error: 'Valor do pagamento invalido' });
    }

    const mongoClient = await getClient();
    const txSession = mongoClient.startSession();
    let ledgerEntry;
    try {
      await txSession.withTransaction(async () => {
        const result = await db.collection('payments').findOneAndUpdate(
          { _id: paymentId, userId, status: 'pending' },
          { $set: { status: 'confirmed' } },
          { returnDocument: 'after', session: txSession }
        );

        // Pagamento já confirmado — garante idempotência sem erro
        const confirmedPayment = result ?? await db.collection('payments').findOne(
          { _id: paymentId, userId, status: 'confirmed' },
          { session: txSession }
        );
        if (!confirmedPayment) {
          throw Object.assign(new Error('Pagamento nao esta pendente'), { statusCode: 400 });
        }

        ledgerEntry = await confirmAndGetLedger(creditAmount);
      });
    } finally {
      await txSession.endSession();
    }

    if (!ledgerEntry?._id) {
      throw new Error('Falha ao criar registro de credito no ledger');
    }

    const balances = await calculateBalances(wallet._id);
    return res.status(200).json({
      paymentId,
      status: 'confirmed',
      ledgerId: ledgerEntry._id,
      ledgerStatus: ledgerEntry.status,
      ledgerAmount: ledgerEntry.amount,
      ledgerSource: ledgerEntry.source,
      walletId: wallet._id,
      balance: balances.balance,
      available: balances.available,
    });
  } catch (error) {
    console.error('Erro ao confirmar PIX simulado:', error);
    return res.status(500).json({ error: error?.message || 'Erro interno no servidor' });
  }
}
