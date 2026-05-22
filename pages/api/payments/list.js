import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { getSessionUserId } from '../../../lib/wallet';

const ALLOWED_STATUS = ['pending', 'confirmed', 'failed'];

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

    const status = String(req.query.status || '').trim().toLowerCase();
    const filter = { userId };
    if (ALLOWED_STATUS.includes(status)) {
      filter.status = status;
    }

    const db = await getDb();
    const payments = await db
      .collection('payments')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    return res.status(200).json(payments);
  } catch (error) {
    console.error('Erro ao listar pagamentos:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
