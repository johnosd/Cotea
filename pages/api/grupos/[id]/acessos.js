import { ObjectId } from 'mongodb';
import nodemailer from 'nodemailer';
import { getServerSession } from 'next-auth';
import clientPromise from '../../../../lib/mongodb';
import { authOptions } from '../../auth/[...nextauth]';
import { isValidEmail } from '../../../../lib/validation';

const parseObjectId = (valor) => {
  if (valor instanceof ObjectId) return valor;
  if (typeof valor === 'string' && ObjectId.isValid(valor)) return new ObjectId(valor);
  return null;
};

const buildTransporter = () =>
  nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'Nao autenticado' });
  }

  const { id } = req.query;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID invalido' });
  }

  const adminId = parseObjectId(session.user.id || session.user._id || session.user.sub);
  if (!adminId) return res.status(403).json({ error: 'Usuario invalido' });

  const conteudoBody = (req.body?.conteudo || '').toString().trim();

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);
    const grupoId = new ObjectId(id);

    const grupo = await db
      .collection('grupos')
      .findOne({ _id: grupoId }, { projection: { nome: 1, adminId: 1, adminIdString: 1, admin: 1 } });
    if (!grupo) return res.status(404).json({ error: 'Grupo nao encontrado' });

    const adminIdDoc = parseObjectId(grupo.adminId || grupo.adminIdString || grupo.admin?.userId);
    const membroAdmin = await db.collection('membrosGrupo').findOne({
      grupoId,
      userId: adminId,
      papel: 'admin',
      status: { $ne: 'banido' },
    });
    if (!membroAdmin && (!adminIdDoc || String(adminIdDoc) !== String(adminId))) {
      return res.status(403).json({ error: 'Apenas administradores podem enviar acessos' });
    }

    const pendentes = await db
      .collection('membrosGrupo')
      .aggregate([
        {
          $match: {
            grupoId,
            status: { $ne: 'banido' },
            aguardandoEnvioAcesso: true,
            papel: { $ne: 'admin' },
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            userId: 1,
            email: '$user.email',
            nome: { $ifNull: ['$user.nome', '$user.name'] },
          },
        },
      ])
      .toArray();

    if (!pendentes.length) {
      return res.status(400).json({ error: 'Nao ha membros aguardando envio de acesso' });
    }

    const destinatarios = pendentes
      .map((p) => p.email)
      .filter((email) => isValidEmail(email));

    if (!destinatarios.length) {
      return res.status(400).json({ error: 'Nenhum membro aguardando possui email valido' });
    }

    const transporter = buildTransporter();
    const enviados = [];
    const falha = [];
    const agora = new Date();
    const assunto = `Acesso liberado - ${grupo.nome || 'Grupo'}`;
    const corpo =
      conteudoBody ||
      `Ola! Seu acesso ao grupo ${grupo.nome || ''} foi liberado. Siga as instrucoes enviadas pelo administrador.`;

    const sucessoUserIds = [];

    await Promise.all(
      pendentes.map(async (p) => {
        const email = p.email;
        if (!email || !isValidEmail(email)) {
          falha.push(email || '');
          return;
        }
        try {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: assunto,
            text: corpo,
          });
          enviados.push(email);
          sucessoUserIds.push(p.userId);
        } catch (err) {
          falha.push(email);
        }
      })
    );

    if (sucessoUserIds.length) {
      await db.collection('membrosGrupo').updateMany(
        {
          grupoId,
          userId: { $in: sucessoUserIds },
          aguardandoEnvioAcesso: true,
        },
        {
          $set: { aguardandoEnvioAcesso: false, dataEnvioAcesso: agora },
        }
      );
    }

    await db.collection('mensagens').insertOne({
      grupoId,
      adminId,
      tipo: 'acesso',
      metodoEnvio: 'email',
      payload: { assunto, corpo },
      conteudo: corpo,
      destinatarios,
      enviados,
      falha,
      status: falha.length ? 'parcial' : 'enviado',
      createdAt: agora,
      updatedAt: agora,
    });

    return res.status(200).json({ message: 'Envio processado', enviados: enviados.length, falha: falha.length });
  } catch (error) {
    console.error('Erro ao enviar acessos:', error);
    return res.status(500).json({ error: 'Erro interno ao enviar acessos' });
  }
}
