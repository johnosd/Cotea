import clientPromise from '../../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import { INVOICE_STATUS, getInvoiceById } from '../../../../lib/invoices';

const parseObjectId = (valor) => {
  if (typeof valor === 'string' && ObjectId.isValid(valor)) return new ObjectId(valor);
  return null;
};

const parseNumero = (valor, padrao = NaN) => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : padrao;
};

export default async function handler(req, res) {
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

      await membrosCollection.deleteOne({ _id: membro._id });
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

      return res.status(200).json({ message: 'Participacao cancelada' });
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

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ error: 'Metodo nao permitido' });
    }

    const session = await getServerSession(req, res, authOptions);
    const sessionUserId = session?.user?.id || session?.user?._id || session?.user?.sub;
    const userObjectId = parseObjectId(sessionUserId);

    if (!session || !userObjectId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }
    if (!session.user.contaValidada) {
      return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para entrar em grupos.' });
    }

    const invoiceIdRaw = String(req.body?.invoiceId || '').trim();
    if (!invoiceIdRaw) {
      return res.status(400).json({ error: 'invoiceId obrigatorio para entrar no grupo' });
    }
    const invoice = await getInvoiceById(invoiceIdRaw);
    if (!invoice || invoice.userId !== String(userObjectId) || invoice.grupoId !== String(id)) {
      return res.status(404).json({ error: 'Fatura nao encontrada para este usuario/grupo' });
    }
    if (invoice.status !== INVOICE_STATUS.PAGA) {
      return res.status(402).json({ error: 'Fatura nao esta paga', status: invoice.status });
    }

    const grupo = await db
      .collection('grupos')
      .findOne(
        { _id: grupoId },
        { projection: { capacidadeTotal: 1, vagasReservadasAdmin: 1, acesso: 1, status: 1, statusDetalhado: 1, nome: 1 } }
      );

    if (!grupo) {
      return res.status(404).json({ error: 'Grupo nao encontrado' });
    }

    const membros = await membrosCollection.find({ grupoId, status: { $ne: 'banido' } }).toArray();

    const jaMembro = membros.find((m) => m.userId && m.userId.equals(userObjectId));
    if (jaMembro) {
      await db.collection('invoices').updateOne(
        { _id: invoice._id },
        { $set: { vinculadoEm: new Date(), membroId: jaMembro._id } }
      );
      return res.status(200).json({ message: 'Usuario ja e membro', membro: jaMembro, invoiceId: invoice._id });
    }

    const capacidadeNum = parseNumero(grupo.capacidadeTotal, NaN);
    const capacidade = Number.isFinite(capacidadeNum) && capacidadeNum > 0 ? capacidadeNum : Infinity;
    if (capacidade !== Infinity && membros.length >= capacidade) {
      return res.status(400).json({ error: 'Grupo completo' });
    }

    const agora = new Date();
    const novoMembro = {
      grupoId,
      userId: userObjectId,
      papel: 'membro',
      status: 'ativo',
      temCaucao: false,
      aguardandoEnvioAcesso: true,
      dataEntrada: agora,
      createdAt: agora,
      invoiceId: invoice._id,
      valorPago: invoice.amount,
      pagamentoStatus: invoice.status,
      pagamentoData: invoice.paidAt || agora,
    };

    let vagasDisponiveis = null;
    if (capacidade !== Infinity) {
      const reservadas = Math.max(parseNumero(grupo.vagasReservadasAdmin, 0), 0);
      const membrosNaoAdmin = membros.filter((m) => m.papel !== 'admin').length + 1; // inclui o novo membro
      vagasDisponiveis = Math.max(capacidade - reservadas - membrosNaoAdmin, 0);
    }

    try {
      const insertResult = await membrosCollection.insertOne(novoMembro);

      const totalMembros = membros.length + 1;
      const capacidadeNum = parseNumero(grupo.capacidadeTotal, NaN);
      const atingiuCapacidade = Number.isFinite(capacidadeNum) && capacidadeNum > 0 && totalMembros >= capacidadeNum;

      const updateGrupo = { $set: { updatedAt: agora } };
      if (grupo.acesso === 'apos_completar' && atingiuCapacidade) {
        updateGrupo.$set.statusDetalhado = 'ativo';
        updateGrupo.$set.status = 'ativo';
      }

      await db.collection('grupos').updateOne({ _id: grupoId }, updateGrupo);
      await db.collection('invoices').updateOne(
        { _id: invoice._id },
        { $set: { vinculadoEm: agora, membroId: insertResult.insertedId } }
      );

      // Notifica admin sobre novo membro
      const adminMemberNovo = await membrosCollection.findOne({ grupoId, papel: 'admin' });
      const adminIdNovo = adminMemberNovo?.userId;
      if (adminIdNovo) {
        await db.collection('notificacoesUsuario').insertOne({
          userId: adminIdNovo,
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

      return res.status(200).json({ message: 'Membro adicionado', membroId: insertResult.insertedId, status: novoMembro.status });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(200).json({ message: 'Usuario ja e membro' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Erro ao adicionar membro:', error);
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
}
