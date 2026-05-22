import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import clientPromise from '../../../../lib/mongodb';

const parseObjectId = (value) => {
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  return null;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  const session = await getServerSession(req, res, authOptions);
  const sessionUserId = session?.user?.id || session?.user?._id || session?.user?.sub;
  if (!session || !sessionUserId) {
    return res.status(401).json({ error: 'Nao autenticado' });
  }
  if (!session.user.contaValidada) {
    return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para entrar em grupos.' });
  }

  const { id } = req.query;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID do grupo invalido' });
  }

  // Admin/support podem adicionar outro usuário via body; demais só podem adicionar a si mesmos
  const isStaff = ['admin', 'support'].includes(session.user.systemRole);
  const bodyUserId = req.body?.userId;
  const userId = (isStaff && bodyUserId) ? bodyUserId : sessionUserId;

  if (!isStaff && bodyUserId && String(bodyUserId) !== String(sessionUserId)) {
    return res.status(403).json({ error: 'Sem permissao para adicionar outro usuario' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);
    const grupoId = new ObjectId(id);
    const grupo = await db.collection('grupos').findOne(
      { _id: grupoId },
      { projection: { capacidadeTotal: 1, acesso: 1, status: 1, statusDetalhado: 1, nome: 1 } }
    );

    if (!grupo) {
      return res.status(404).json({ error: 'Grupo nao encontrado' });
    }

    const userIdObj = parseObjectId(userId);
    if (!userIdObj) {
      return res.status(400).json({ error: 'userId deve ser um ObjectId valido' });
    }

    const membrosCollection = db.collection('membrosGrupo');
    const membrosAtivos = await membrosCollection.countDocuments({ grupoId, status: { $ne: 'banido' } });
    const capacidade = Number(grupo.capacidadeTotal) || 0;
    if (capacidade && membrosAtivos >= capacidade) {
      return res.status(409).json({ error: 'Grupo sem vagas disponiveis' });
    }

    const existente = await membrosCollection.findOne({ grupoId, userId: userIdObj, status: { $ne: 'banido' } });
    if (existente) {
      return res.status(200).json({ message: 'Usuario ja e membro', membrosAtivos });
    }

    const agora = new Date();
    const novoMembro = {
      grupoId,
      userId: userIdObj,
      papel: 'membro',
      status: 'ativo',
      temCaucao: false,
      aguardandoEnvioAcesso: true,
      dataEntrada: agora,
      createdAt: agora,
    };

    await membrosCollection.insertOne(novoMembro);

    const totalMembros = membrosAtivos + 1;
    const atingiuCapacidade = capacidade && totalMembros >= capacidade;

    const updateGrupo = { $set: { updatedAt: agora } };
    if (grupo.acesso === 'apos_completar' && atingiuCapacidade) {
      updateGrupo.$set.statusDetalhado = 'ativo';
      updateGrupo.$set.status = 'ativo';
    }

    await db.collection('grupos').updateOne({ _id: grupoId }, updateGrupo);

    // Notifica admin sobre novo membro
    const adminMember = await membrosCollection.findOne({ grupoId, papel: 'admin' });
    const adminId = adminMember?.userId;
    if (adminId) {
      await db.collection('notificacoesUsuario').insertOne({
        userId: adminId,
        titulo: 'Novo membro no grupo',
        mensagem: `Um novo membro entrou no grupo ${grupo.nome || ''}. Confira os detalhes e envie o acesso.`,
        tipo: 'grupo',
        acao: `/admin/grupos/${id}`,
        lido: false,
        data: agora,
        importante: false,
      });
    }

    if (grupo.acesso === 'apos_completar' && atingiuCapacidade) {
      const adminMember = await membrosCollection.findOne({ grupoId, papel: 'admin' });
      const adminId = adminMember?.userId;
      if (adminId) {
        await db.collection('notificacoesUsuario').insertOne({
          userId: adminId,
          titulo: 'Grupo formado',
          mensagem: `O grupo ${grupo.nome || ''} atingiu a capacidade e esta pronto para liberar acesso aos membros.`,
          tipo: 'grupo',
          acao: `/admin/grupos/${id}`,
          lido: false,
          data: agora,
          importante: true,
        });
      }
    }

    return res.status(200).json({ message: 'Participante adicionado', membrosAtivos: membrosAtivos + 1 });
  } catch (error) {
    console.error('Erro ao adicionar participante:', error);
    return res.status(500).json({ error: 'Erro interno ao adicionar participante' });
  }
}
