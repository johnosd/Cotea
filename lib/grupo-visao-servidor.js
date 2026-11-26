// Decide quem enxerga o quê no detalhe de um grupo (bug ssr-grupo-detalhe-expoe-dados-internos).
// Uso no servidor (getServerSideProps): lê a sessão de forma opcional e devolve a "visão"
// do visitante. Mesma regra de `podeVerCamposInternos` em pages/api/grupos/[id].js:
// visão completa só para staff (PERMISSIONS.GROUPS_TAB) e dono/admin do grupo; qualquer
// falha de sessão, ausência de sessão ou conta bloqueada cai na visão pública (falha segura).
import { getServerSession } from 'next-auth';
import { authOptions } from '../pages/api/auth/[...nextauth]';
import { hasRole, isUserBlocked, PERMISSIONS } from './authz';
import { getSessionUserId } from './wallet';
import { parseObjectId } from './grupos-utils';

export const VISAO_PUBLICA = Object.freeze({ completa: false, staff: false, dono: false, userId: null });

/**
 * @param {{ req: object, res: object, db: object, grupoId: import('mongodb').ObjectId,
 *           grupo: object, adminIdResolvido?: any }} entrada
 * @returns {Promise<{ completa: boolean, staff: boolean, dono: boolean, userId: string|null }>}
 *   `completa` = staff ou dono/admin do grupo (pode ver campos internos);
 *   `dono` = dono/admin do grupo; `userId` = id da sessão (só quando a conta não está bloqueada).
 */
export async function identificarVisaoGrupo({ req, res, db, grupoId, grupo, adminIdResolvido = null }) {
  let session = null;
  try {
    session = await getServerSession(req, res, authOptions);
  } catch {
    return { ...VISAO_PUBLICA };
  }
  if (!session?.user) return { ...VISAO_PUBLICA };
  if (isUserBlocked(session)) return { ...VISAO_PUBLICA };

  const staff = hasRole(session, PERMISSIONS.GROUPS_TAB);
  const textoId = getSessionUserId(session);
  const requesterId = parseObjectId(textoId);

  let dono = false;
  if (requesterId) {
    const donoId = parseObjectId(adminIdResolvido || grupo.admin?.userId);
    if (donoId && donoId.equals(requesterId)) {
      dono = true;
    } else {
      const membroAdmin = await db.collection('membrosGrupo').findOne({
        grupoId, userId: requesterId, papel: 'admin', status: { $ne: 'banido' },
      });
      dono = Boolean(membroAdmin);
    }
  }

  return { completa: staff || dono, staff, dono, userId: requesterId ? String(requesterId) : null };
}
