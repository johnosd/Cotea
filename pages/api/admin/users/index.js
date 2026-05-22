import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from '../../auth/[...nextauth]';
import { getDb } from '../../../../lib/mongodb';
import { PERMISSIONS, hasRole } from '../../../../lib/authz';
import { decryptCPF } from '../../../../lib/encryption';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session) return res.status(401).json({ error: 'Nao autenticado' });
    if (!hasRole(session, PERMISSIONS.USERS_TAB)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const db = await getDb();
    const users = await db
      .collection('users')
      .find({}, { projection: { nome: 1, sobrenome: 1, email: 1, cpf: 1, systemRole: 1, isBlocked: 1 } })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    return res.status(200).json(
      users.map((u) => ({
        _id: u._id instanceof ObjectId ? String(u._id) : u._id,
        nome: u.nome || '',
        sobrenome: u.sobrenome || '',
        email: u.email || '',
        cpf: decryptCPF(u.cpf || ''),
        systemRole: u.systemRole || 'user',
        isBlocked: Boolean(u.isBlocked),
      }))
    );
  } catch (error) {
    console.error('Erro ao listar usuarios:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
