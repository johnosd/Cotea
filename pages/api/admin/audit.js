import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { hasRole, PERMISSIONS } from '../../../lib/authz';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Nao autenticado' });
  if (!hasRole(session, PERMISSIONS.AUDIT_TAB)) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  return res.status(200).json({ message: 'Auditoria reservada para administradores.', items: [] });
}
