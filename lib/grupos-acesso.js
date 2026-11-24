// Acesso à tela de edição de grupo (/admin/grupos/[id]) — regra no servidor.
// Pode ver quem pode editar: dono/membro admin não banido (mesmo critério do
// PUT em pages/api/grupos/[id].js) ou staff com PERMISSIONS.GROUPS_TAB.
// Não importa lib/mongodb.js: recebe o `db` por parâmetro (testável em memória).
import { hasRole, isUserBlocked, PERMISSIONS } from './authz.js';
import { parseObjectId } from './grupos-utils.js';

const idDaSessao = (session) => {
  const candidato = session?.user?.id || session?.user?._id || session?.user?.sub;
  return candidato ? parseObjectId(String(candidato)) : null;
};

/**
 * Regra pura. `membroAdmin` é o membrosGrupo { papel: 'admin', status != 'banido' }
 * do solicitante neste grupo, ou null. IDs são normalizados (ObjectId vs string).
 */
export function podeEditarGrupo({ session, grupo, membroAdmin = null }) {
  if (!session?.user || !grupo) return false;
  if (isUserBlocked(session)) return false;
  if (hasRole(session, PERMISSIONS.GROUPS_TAB)) return true;

  const solicitanteId = idDaSessao(session);
  if (!solicitanteId) return false;

  const donoId = parseObjectId(grupo.adminId || grupo.adminIdString || grupo.admin?.userId);
  if (donoId && donoId.equals(solicitanteId)) return true;

  return Boolean(
    membroAdmin &&
      membroAdmin.papel === 'admin' &&
      membroAdmin.status !== 'banido' &&
      String(membroAdmin.userId) === String(solicitanteId)
  );
}

/**
 * Carrega o grupo e os participantes para a tela de edição, já autorizado.
 * Retorna { status: 'login' | 'nao_encontrado' | 'ok', ... }. Quem não pode
 * ver recebe 'nao_encontrado' e NENHUM dado do grupo.
 */
export async function carregarGrupoParaEdicao({ db, session, id }) {
  if (!session?.user) return { status: 'login' };

  const grupoId = parseObjectId(id);
  if (!grupoId) return { status: 'nao_encontrado' };

  const grupo = await db.collection('grupos').findOne({ _id: grupoId });
  if (!grupo) return { status: 'nao_encontrado' };

  const solicitanteId = idDaSessao(session);
  const membroAdmin = solicitanteId
    ? await db.collection('membrosGrupo').findOne({ grupoId, userId: solicitanteId, papel: 'admin', status: { $ne: 'banido' } })
    : null;

  if (!podeEditarGrupo({ session, grupo, membroAdmin })) return { status: 'nao_encontrado' };

  // Dono: adminId do documento ou, na falta, o membro com papel admin.
  const membroDono = await db.collection('membrosGrupo').findOne({ grupoId, papel: 'admin' });
  const donoId = parseObjectId(grupo.adminId || grupo.adminIdString) || parseObjectId(membroDono?.userId);
  const donoUser = donoId
    ? await db.collection('users').findOne({ _id: donoId }, { projection: { name: 1, nome: 1, email: 1, image: 1, avatar: 1 } })
    : null;

  const adminNome = donoUser?.name || donoUser?.nome || grupo.adminNome || membroDono?.nome || donoUser?.email || grupo.admin?.nome || 'Administrador';
  const adminEmail = donoUser?.email || grupo.adminEmail || '';
  const adminAvatar = donoUser?.image || donoUser?.avatar || grupo.adminAvatar || '';
  const membrosAtivos = await db.collection('membrosGrupo').countDocuments({ grupoId, status: { $ne: 'banido' } });

  const grupoCompleto = {
    ...grupo,
    adminId: donoId || grupo.adminId || null,
    adminIdString: donoId ? String(donoId) : grupo.adminIdString || null,
    adminNome,
    adminEmail,
    adminAvatar,
    membrosAtivos,
    admin: { id: donoId ? String(donoId) : grupo.adminIdString || null, nome: adminNome, email: adminEmail, avatar: adminAvatar },
  };

  // Participantes (exceto o dono) com nome/e-mail do usuário.
  const membros = await db.collection('membrosGrupo').find({ grupoId, papel: { $ne: 'admin' } }).toArray();
  const userIds = membros.map((m) => m.userId).filter(Boolean);
  const usuarios = userIds.length ? await db.collection('users').find({ _id: { $in: userIds } }).toArray() : [];
  const usuarioPorId = new Map(usuarios.map((u) => [String(u._id), u]));
  const participantes = membros.map((m) => {
    const u = usuarioPorId.get(String(m.userId));
    return {
      userId: m.userId,
      papel: m.papel,
      status: m.status,
      nome: u?.nome || '',
      email: u?.email || '',
      image: u?.image || '',
    };
  });

  return {
    status: 'ok',
    grupo: JSON.parse(JSON.stringify(grupoCompleto)),
    participantes: JSON.parse(JSON.stringify(participantes)),
  };
}

/**
 * Resultado de getServerSideProps da tela de edição: redirect (sem sessão),
 * notFound (sem permissão ou grupo inexistente) ou props (autorizado).
 */
export async function resolverPaginaEdicaoGrupo({ db, session, id }) {
  const destino = `/admin/grupos/${id}`;
  const paraLogin = { redirect: { destination: `/auth/signin?callbackUrl=${encodeURIComponent(destino)}`, permanent: false } };
  if (!session?.user) return paraLogin;
  const resultado = await carregarGrupoParaEdicao({ db, session, id });
  if (resultado.status === 'login') return paraLogin;
  if (resultado.status !== 'ok') return { notFound: true };
  return { props: { grupo: resultado.grupo, participantes: resultado.participantes } };
}
