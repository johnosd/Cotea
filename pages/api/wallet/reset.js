import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb, getWalletByUser } from '../../../lib/mongodb';
import { getSessionUserId } from '../../../lib/wallet';
import { hasRole, isUserBlocked } from '../../../lib/authz';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const sessionUserId = getSessionUserId(session);
    if (!session || !sessionUserId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }

    const targetUserId = String(req.body?.userId || sessionUserId);
    const admin = hasRole(session, ['admin']);
    if (isUserBlocked(session)) {
      return res.status(403).json({ error: 'Conta bloqueada. Procure o suporte.' });
    }
    if (targetUserId !== sessionUserId && !admin) {
      return res.status(403).json({ error: 'Apenas o proprio usuario ou admin podem resetar' });
    }

    const db = await getDb();
    const wallet = await getWalletByUser(targetUserId);
    if (!wallet) {
      return res.status(404).json({ error: 'Carteira nao encontrada para o usuario informado' });
    }

    const paymentsResult = await db.collection('payments').deleteMany({ userId: targetUserId });
    const ledgerResult = await db.collection('walletTransactions').deleteMany({ walletId: wallet._id });
    const withdrawalsResult = await db.collection('withdrawals').deleteMany({ walletId: wallet._id });

    return res.status(200).json({
      walletId: wallet._id,
      userId: targetUserId,
      paymentsDeleted: paymentsResult.deletedCount || 0,
      ledgerDeleted: ledgerResult.deletedCount || 0,
      withdrawalsDeleted: withdrawalsResult.deletedCount || 0,
      message: 'Carteira resetada com sucesso para novos testes',
    });
  } catch (error) {
    console.error('Erro ao resetar carteira:', error);
    return res.status(500).json({ error: error?.message || 'Erro interno no servidor' });
  }
}
