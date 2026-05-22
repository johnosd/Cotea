import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from '../../auth/[...nextauth]';
import { getDb } from '../../../../../lib/mongodb';
import { PERMISSIONS, hasRole } from '../../../../../lib/authz';
import { logAudit } from '../../../../../lib/audit';
import { getClientIp } from '../../../../../lib/ratelimit';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session) return res.status(401).json({ error: 'Nao autenticado' });
    if (!hasRole(session, PERMISSIONS.USERS_TAB)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { id } = req.query;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID invalido' });
    }

    const isBlocked = req.body?.isBlocked;
    if (typeof isBlocked !== 'boolean') {
      return res.status(400).json({ error: 'isBlocked deve ser boolean' });
    }

    const db = await getDb();
    const updated = await db
      .collection('users')
      .findOneAndUpdate({ _id: new ObjectId(id) }, { $set: { isBlocked } }, { returnDocument: 'after' });

    if (!updated.value) {
      return res.status(404).json({ error: 'Usuario nao encontrado' });
    }

    logAudit({
      action: isBlocked ? 'user.blocked' : 'user.unblocked',
      actorId: session.user.id,
      actorEmail: session.user.email,
      targetId: id,
      targetCollection: 'users',
      details: { targetEmail: updated.value.email },
      ip: getClientIp(req),
    });

    return res.status(200).json({ isBlocked: updated.value.isBlocked === true });
  } catch (error) {
    console.error('Erro ao bloquear/desbloquear usuario:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
