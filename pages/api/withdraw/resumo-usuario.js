import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { calculateBalances, getSessionUserId } from '../../../lib/wallet';
import { PERMISSIONS, hasRole, isUserBlocked } from '../../../lib/authz';
import { enriquecerResumo, resumoPublico } from '../../../lib/ledger/apresentacao';

// Saldo segmentado do dono de um saque, para o financeiro decidir (002, US3-AC1).
// Só finance/admin (D-12); não devolve CPF.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const actorId = getSessionUserId(session);
    if (!session || !actorId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }
    if (isUserBlocked(session)) {
      return res.status(403).json({ error: 'Conta bloqueada. Procure o suporte.' });
    }
    if (!hasRole(session, PERMISSIONS.LEDGER_FINANCEIRO)) {
      return res.status(403).json({ error: 'Apenas administradores ou financeiro podem ver o saldo do usuario' });
    }

    const withdrawalId = String(req.query?.withdrawalId || '').trim();
    if (!withdrawalId) {
      return res.status(400).json({ error: 'withdrawalId obrigatorio' });
    }

    const db = await getDb();
    const withdrawal = await db
      .collection('withdrawals')
      .findOne({ _id: withdrawalId }, { projection: { userId: 1, walletId: 1 } });
    if (!withdrawal) {
      return res.status(404).json({ error: 'Saque nao encontrado' });
    }

    const { resumo } = await calculateBalances(withdrawal.walletId);
    return res.status(200).json({
      withdrawalId,
      userId: withdrawal.userId,
      walletId: withdrawal.walletId,
      resumo: resumoPublico(await enriquecerResumo(db, resumo)),
    });
  } catch (error) {
    console.error('Erro ao consultar saldo do usuario do saque:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
