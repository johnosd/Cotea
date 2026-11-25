import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { getSessionUserId } from '../../../lib/wallet';
import { hasRole, isUserBlocked, PERMISSIONS } from '../../../lib/authz';
import { decryptCPF } from '../../../lib/encryption';
import { mascararCPF } from '../../../lib/cpf-mascara';

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
    if (!hasRole(session, PERMISSIONS.WITHDRAWALS_TAB)) {
      return res.status(403).json({ error: 'Apenas administradores ou financeiro podem listar saques' });
    }

    const db = await getDb();
    const items = await db
      .collection('withdrawals')
      .find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    // A chave PIX (CPF) nunca sai na listagem: só mascarada. O CPF completo
    // fica em /api/withdraw/chave-pix, restrito ao financeiro (RN CPF mascarado).
    return res.status(200).json(
      items.map(({ pixKeyCpf, ...resto }) => ({
        ...resto,
        pixKeyCpfMascarado: mascararCPF(decryptCPF(pixKeyCpf || '')),
      }))
    );
  } catch (error) {
    console.error('Erro ao listar saques:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
