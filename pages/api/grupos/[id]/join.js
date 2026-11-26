// /api/grupos/[id]/join — consulta (GET) e saída (DELETE) de um membro.
//
// A ENTRADA não passa mais por aqui (006-checkout-caucao, D-10 / FR-002): cobrança e
// participação são uma única operação em POST /api/assinaturas/pay. O POST responde 410.
// A SAÍDA liquida a participação (caução e retenção) junto com a remoção (FR-021/FR-022).
import clientPromise from '../../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import { encerrarParticipacao } from '../../../../lib/checkout-servidor';

const parseObjectId = (valor) => {
  if (typeof valor === 'string' && ObjectId.isValid(valor)) return new ObjectId(valor);
  return null;
};

export default async function handler(req, res) {
  if (req.method === 'POST') {
    return res.status(410).json({
      error: 'Rota desativada. A entrada em grupo acontece junto com o pagamento.',
      codigo: 'rota_desativada',
    });
  }

  const { id } = req.query;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID invalido' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);

    const grupoId = new ObjectId(id);
    const membrosCollection = db.collection('membrosGrupo');

    if (req.method === 'DELETE') {
      const deleteSession = await getServerSession(req, res, authOptions);
      const deleteSessionId = deleteSession?.user?.id || deleteSession?.user?._id || deleteSession?.user?.sub;
      if (!deleteSession || !deleteSessionId) {
        return res.status(401).json({ error: 'Nao autenticado' });
      }

      const { userId } = req.body || {};
      const userObjectId = parseObjectId(userId);
      if (!userObjectId) {
        return res.status(400).json({ error: 'userId obrigatorio e deve ser um ObjectId valido' });
      }

      const isStaffDelete = ['admin', 'support'].includes(deleteSession.user?.systemRole);
      if (!isStaffDelete && String(deleteSessionId) !== String(userId)) {
        return res.status(403).json({ error: 'Sem permissao para remover outro membro' });
      }

      const membro = await membrosCollection.findOne({ grupoId, userId: userObjectId });
      if (!membro) {
        return res.status(404).json({ error: 'Membro nao encontrado neste grupo' });
      }
      if (membro.papel === 'admin') {
        return res.status(403).json({ error: 'Administradores nao podem cancelar aqui' });
      }

      // O registro de um banido é o que impede a volta: ele não apaga o próprio; só o staff.
      const remover = membro.status !== 'banido' || isStaffDelete;
      // Saída e devolução valem juntas: se a liquidação falhar, o membro continua no grupo.
      const { devolvido } = await encerrarParticipacao({
        db,
        membroId: membro._id,
        motivo: String(deleteSessionId) === String(userId) ? 'saida_membro' : 'removido_staff',
        porId: String(deleteSessionId),
        remover,
      });

      // A saída já vale: falha daqui para baixo não muda a resposta.
      try {
        const agora = new Date();
        await db.collection('grupos').updateOne({ _id: grupoId }, { $set: { updatedAt: agora } });

        // Notifica o admin que um membro saiu
        const adminMember = await membrosCollection.findOne({ grupoId, papel: 'admin' });
        const adminId = adminMember?.userId || null;
        if (adminId) {
          const grupo = await db.collection('grupos').findOne(
            { _id: grupoId },
            { projection: { nome: 1 } }
          );
          await db.collection('notificacoesUsuario').insertOne({
            userId: adminId,
            titulo: 'Membro cancelou participacao',
            mensagem: `Um membro saiu do grupo ${grupo?.nome || ''}. Revise as vagas e atualizacoes.`,
            tipo: 'grupo',
            acao: `/admin/grupos/${id}`,
            lido: false,
            data: agora,
            importante: false,
          });
        }
      } catch (erro) {
        console.error('Falha ao notificar saida de membro:', erro?.message || erro);
      }

      return res.status(200).json({ message: 'Participacao cancelada', devolvido });
    }

    if (req.method === 'GET') {
      const userIdParam = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;
      const userObjectId = parseObjectId(userIdParam);

      if (!userObjectId) {
        return res.status(400).json({ error: 'userId obrigatorio e deve ser um ObjectId valido' });
      }

      const membro = await membrosCollection.findOne({
        grupoId,
        userId: userObjectId,
        status: { $ne: 'banido' },
      });

      return res.status(200).json({
        isMembro: Boolean(membro),
        status: membro?.status || null,
        papel: membro?.papel || null,
      });
    }

    res.setHeader('Allow', ['GET', 'DELETE']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  } catch (error) {
    console.error('Erro em /api/grupos/[id]/join:', error);
    return res.status(500).json({ error: 'Erro ao processar a participacao' });
  }
}
