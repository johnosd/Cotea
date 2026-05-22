import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from '../../../auth/[...nextauth]';
import { getDb } from '../../../../../lib/mongodb';
import { PERMISSIONS, hasRole } from '../../../../../lib/authz';
import { logAudit } from '../../../../../lib/audit';
import { getClientIp } from '../../../../../lib/ratelimit';

const ROLES_VALIDOS = ['user', 'support', 'finance', 'admin'];

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Nao autenticado' });
  if (!hasRole(session, PERMISSIONS.ROLE_CHANGE)) {
    return res.status(403).json({ error: 'Apenas administradores podem alterar papeis' });
  }

  const { id } = req.query;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID invalido' });
  }

  // Admin não pode alterar o próprio papel
  if (String(session.user.id) === String(id)) {
    return res.status(403).json({ error: 'Voce nao pode alterar o proprio papel' });
  }

  const { systemRole } = req.body || {};
  if (!ROLES_VALIDOS.includes(systemRole)) {
    return res.status(400).json({ error: `Papel invalido. Valores aceitos: ${ROLES_VALIDOS.join(', ')}` });
  }

  try {
    const db = await getDb();
    const target = await db.collection('users').findOne({ _id: new ObjectId(id) }, { projection: { systemRole: 1, email: 1 } });
    if (!target) {
      return res.status(404).json({ error: 'Usuario nao encontrado' });
    }

    await db.collection('users').updateOne({ _id: new ObjectId(id) }, { $set: { systemRole } });

    logAudit({
      action: 'user.role_changed',
      actorId: session.user.id,
      actorEmail: session.user.email,
      targetId: id,
      targetCollection: 'users',
      details: { from: target.systemRole, to: systemRole, targetEmail: target.email },
      ip: getClientIp(req),
    });

    return res.status(200).json({ systemRole });
  } catch (error) {
    console.error('Erro ao alterar papel:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
