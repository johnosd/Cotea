import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { getSessionUserId } from '../../../lib/wallet';
import { hasRole, isUserBlocked } from '../../../lib/authz';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
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
    if (!hasRole(session, ['admin', 'finance', 'support'])) {
      return res.status(403).json({ error: 'Apenas administradores, financeiro ou suporte podem listar saques' });
    }

    const db = await getDb();
    const items = await db
      .collection('withdrawals')
      .find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    return res.status(200).json(items);
  } catch (error) {
    console.error('Erro ao listar saques:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
