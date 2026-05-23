import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth/next';
import clientPromise from '../../lib/mongodb';
import { authOptions } from './auth/[...nextauth]';
import { getSessionUserId } from '../../lib/wallet';
import { hasRole, isUserBlocked } from '../../lib/authz';

const parseObjectId = (valor) => {
  if (typeof valor === 'string' && ObjectId.isValid(valor)) return new ObjectId(valor);
  return null;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) {
    return res.status(401).json({ error: 'Nao autenticado' });
  }
  if (isUserBlocked(session)) {
    return res.status(403).json({ error: 'Conta bloqueada' });
  }

  const userIdRaw = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;
  const userId = parseObjectId(userIdRaw);
  if (!userId) {
    return res.status(400).json({ error: 'userId obrigatorio e deve ser um ObjectId valido' });
  }

  // Usuários comuns só podem ver seus próprios grupos; admin e support podem ver de qualquer um
  const sessionUserId = getSessionUserId(session);
  const isStaff = hasRole(session, ['admin', 'support']);
  if (!isStaff && sessionUserId !== userIdRaw) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);

    const grupos = await db
      .collection('membrosGrupo')
      .aggregate([
        { $match: { userId, status: { $ne: 'banido' } } },
        {
          $lookup: {
            from: 'grupos',
            localField: 'grupoId',
            foreignField: '_id',
            as: 'grupo',
          },
        },
        { $unwind: '$grupo' },
        {
          $lookup: {
            from: 'membrosGrupo',
            let: { gId: '$grupoId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ['$grupoId', '$$gId'] }, { $ne: ['$status', 'banido'] }],
                  },
                },
              },
            ],
            as: 'membrosGrupoDoc',
          },
        },
        {
          $lookup: {
            from: 'users',
            let: {
              adminIds: {
                $map: {
                  input: {
                    $filter: {
                      input: '$membrosGrupoDoc',
                      as: 'm',
                      cond: { $eq: ['$$m.papel', 'admin'] },
                    },
                  },
                  as: 'adm',
                  in: '$$adm.userId',
                },
              },
            },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ['$_id', '$$adminIds'] },
                },
              },
              { $project: { name: 1, nome: 1, email: 1, image: 1, avatar: 1 } },
            ],
            as: 'admins',
          },
        },
        {
          $addFields: {
            adminDoc: { $arrayElemAt: ['$admins', 0] },
            membrosAtivos: { $size: '$membrosGrupoDoc' },
            vagasDisponiveisCalc: {
              $max: [{ $subtract: ['$grupo.capacidadeTotal', { $size: '$membrosGrupoDoc' }] }, 0],
            },
          },
        },
        {
          $addFields: {
            adminNome: {
              $ifNull: [
                { $ifNull: ['$adminDoc.name', '$adminDoc.nome'] },
                { $ifNull: ['$adminDoc.email', '$grupo.adminEmail'] },
                '$grupo.adminNome',
              ],
            },
            adminEmail: { $ifNull: ['$adminDoc.email', '$grupo.adminEmail'] },
            adminAvatar: { $ifNull: ['$adminDoc.image', '$adminDoc.avatar', '$grupo.adminAvatar'] },
          },
        },
        {
          $project: {
            _id: '$grupo._id',
            nome: '$grupo.nome',
            descricao: '$grupo.descricao',
            capa: '$grupo.capa',
            imageUrl: '$grupo.imageUrl',
            categoria: '$grupo.categoria',
            status: '$grupo.status',
            statusDetalhado: '$grupo.statusDetalhado',
            capacidadeTotal: '$grupo.capacidadeTotal',
            vagasReservadasAdmin: '$grupo.vagasReservadasAdmin',
            vagasDisponiveis: '$vagasDisponiveisCalc',
            subtitulo: '$grupo.subtitulo',
            acesso: '$grupo.acesso',
            tempoEntrega: '$grupo.tempoEntrega',
            confiabilidade: '$grupo.confiabilidade',
            valorTotal: '$grupo.valorTotal',
            valorPorVaga: '$grupo.valorPorVaga',
            adminNome: 1,
            adminEmail: 1,
            adminAvatar: 1,
            membrosAtivos: 1,
            papel: '$papel',
            statusMembro: '$status',
            invoiceId: '$invoiceId',
            valorPago: '$valorPago',
            pagamentoStatus: '$pagamentoStatus',
            pagamentoData: '$pagamentoData',
          },
        },
      ])
      .toArray();

    return res.status(200).json(grupos);
  } catch (error) {
    console.error('Erro ao carregar meus grupos:', error);
    return res.status(500).json({ error: 'Erro interno ao carregar grupos' });
  }
}
