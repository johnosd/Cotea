import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { calculateBalances, ensureWallet, getSessionUserId } from '../../../lib/wallet';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const userId = getSessionUserId(session);
    if (!session || !userId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }

    const wallet = await ensureWallet(userId);
    const balances = await calculateBalances(wallet._id);

    return res.status(200).json({
      walletId: wallet._id,
      ...balances,
    });
  } catch (error) {
    console.error('Erro ao consultar saldo:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
