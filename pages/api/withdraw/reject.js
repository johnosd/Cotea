import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { calculateBalances, getSessionUserId } from '../../../lib/wallet';
import { hasRole, isUserBlocked } from '../../../lib/authz';
import { logAudit } from '../../../lib/audit';
import { getClientIp } from '../../../lib/ratelimit';
import { obterLedger } from '../../../lib/ledger/servidor';
import { finalizarSaque } from '../../../lib/ledger/saque';

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
      return res.status(403).json({ error: 'Apenas administradores ou financeiro podem rejeitar saques' });
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

    const resultado = await finalizarSaque({
      db,
      ledger: await obterLedger(),
      withdrawal,
      acao: 'cancelar',
      adminId,
    });
    if (!resultado.ok) {
      return res.status(resultado.status).json({ error: resultado.error });
    }

    const balances = await calculateBalances(withdrawal.walletId);

    logAudit({
      action: 'withdrawal.rejected',
      actorId: adminId,
      actorEmail: session.user.email,
      targetId: withdrawalId,
      targetCollection: 'withdrawals',
      details: { amount: withdrawal.amount, userId: withdrawal.userId, walletId: withdrawal.walletId },
      ip: getClientIp(req),
    });

    return res.status(200).json({
      withdrawalId,
      status: resultado.withdrawal?.status || 'rejected',
      walletId: withdrawal.walletId,
      ledgerId: resultado.ledgerId,
      balance: balances.balance,
      available: balances.available,
    });
  } catch (error) {
    console.error('Erro ao rejeitar saque:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
