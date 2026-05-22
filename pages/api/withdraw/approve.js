import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { calculateBalances, getSessionUserId } from '../../../lib/wallet';
import { hasRole, isUserBlocked } from '../../../lib/authz';
import { logAudit } from '../../../lib/audit';
import { getClientIp } from '../../../lib/ratelimit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const adminId = getSessionUserId(session);
    if (!session || !adminId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }
    if (isUserBlocked(session)) {
      return res.status(403).json({ error: 'Conta bloqueada. Procure o suporte.' });
    }
    if (!hasRole(session, ['admin', 'finance'])) {
      return res.status(403).json({ error: 'Apenas administradores ou financeiro podem aprovar saques' });
    }

    const withdrawalId = String(req.body?.withdrawalId || '').trim();
    if (!withdrawalId) {
      return res.status(400).json({ error: 'withdrawalId obrigatorio' });
    }

    const db = await getDb();
    const withdrawal = await db.collection('withdrawals').findOne({ _id: withdrawalId });
    if (!withdrawal) {
      return res.status(404).json({ error: 'Saque nao encontrado' });
    }
    if (['paid', 'rejected'].includes(withdrawal.status)) {
      return res.status(400).json({ error: 'Saque ja finalizado' });
    }

    const ledger = await db
      .collection('walletTransactions')
      .findOne({ referenceId: withdrawalId, walletId: withdrawal.walletId, source: 'saque' });
    if (!ledger) {
      return res.status(404).json({ error: 'Lancamento do saque nao encontrado' });
    }
    if (ledger.status === 'cancelled') {
      return res.status(400).json({ error: 'Lancamento ja cancelado' });
    }

    const ledgerUpdated = await db.collection('walletTransactions').findOneAndUpdate(
      { _id: ledger._id, status: { $in: ['blocked', 'pending'] } },
      { $set: { status: 'confirmed' } },
      { returnDocument: 'after' }
    );

    if (!ledgerUpdated.value && ledger.status !== 'confirmed') {
      return res.status(400).json({ error: 'Nao foi possivel confirmar o lancamento do saque' });
    }

    const withdrawalUpdate = await db.collection('withdrawals').findOneAndUpdate(
      { _id: withdrawalId },
      { $set: { status: 'paid', adminId } },
      { returnDocument: 'after' }
    );

    const balances = await calculateBalances(withdrawal.walletId);

    logAudit({
      action: 'withdrawal.approved',
      actorId: adminId,
      actorEmail: session.user.email,
      targetId: withdrawalId,
      targetCollection: 'withdrawals',
      details: { amount: withdrawal.amount, userId: withdrawal.userId, walletId: withdrawal.walletId },
      ip: getClientIp(req),
    });

    return res.status(200).json({
      withdrawalId,
      status: withdrawalUpdate.value?.status || 'paid',
      walletId: withdrawal.walletId,
      ledgerId: ledger._id,
      balance: balances.balance,
      available: balances.available,
    });
  } catch (error) {
    console.error('Erro ao aprovar saque:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
