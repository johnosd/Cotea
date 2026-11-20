// Guarda das rotas de admin de rotinas/calendário (FR-016, D-09).
// Sessão real do servidor + papel admin do sistema (bloqueado → negado).
import { getServerSession } from 'next-auth';
import { authOptions } from '../../pages/api/auth/[...nextauth]';
import { PERMISSIONS, hasRole } from '../authz';
import { getSessionUserId } from '../wallet';

/** Retorna a sessão autorizada, ou responde 401/403 e retorna null. */
export async function exigirAdminRotinas(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) {
    res.status(401).json({ error: 'Nao autenticado' });
    return null;
  }
  if (!hasRole(session, PERMISSIONS.ROTINAS_TAB)) {
    res.status(403).json({ error: 'Acesso negado' });
    return null;
  }
  return { session, userId: getSessionUserId(session) };
}
