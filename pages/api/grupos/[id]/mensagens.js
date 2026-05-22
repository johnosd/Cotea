import { ObjectId } from 'mongodb';
import nodemailer from 'nodemailer';
import clientPromise from '../../../../lib/mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import { isValidEmail } from '../../../../lib/validation';

const MAX_LEN = 1000;

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
  if (!adminId) {
    return res.status(403).json({ error: 'Usuario invalido' });
  }

  const { conteudo } = req.body || {};
  const mensagem = (conteudo || '').toString().trim();
  if (!mensagem) return res.status(400).json({ error: 'Mensagem obrigatoria' });
  if (mensagem.length > MAX_LEN) return res.status(400).json({ error: `Mensagem deve ter ate ${MAX_LEN} caracteres` });

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);
    const grupoId = new ObjectId(id);

    const grupo = await db.collection('grupos').findOne({ _id: grupoId });
    if (!grupo) return res.status(404).json({ error: 'Grupo nao encontrado' });

    const membroAdmin = await db.collection('membrosGrupo').findOne({
      grupoId,
      userId: adminId,
      papel: 'admin',
      status: { $ne: 'banido' },
    });
    const adminIdDoc = parseObjectId(grupo.adminId || grupo.adminIdString || grupo.admin?.userId);
    if (!membroAdmin && (!adminIdDoc || String(adminIdDoc) !== String(adminId))) {
      return res.status(403).json({ error: 'Apenas administradores podem enviar mensagens' });
    }

    const membrosAtivos = await db
      .collection('membrosGrupo')
      .aggregate([
        { $match: { grupoId, status: { $ne: 'banido' } } },
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
            email: { $ifNull: ['$user.email', null] },
          },
        },
      ])
      .toArray();

    const destinatarios = membrosAtivos
      .map((m) => m.email)
      .filter((email) => isValidEmail(email));

    if (!destinatarios.length) {
      return res.status(400).json({ error: 'Nenhum destinatario ativo com email valido' });
    }

    const transporter = buildTransporter();
    const emailsEnviados = [];
    const emailsFalha = [];

    await Promise.all(
      destinatarios.map(async (email) => {
        try {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: `Mensagem do grupo: ${grupo.nome || 'Grupo'}`,
            text: mensagem,
          });
          emailsEnviados.push(email);
        } catch (err) {
          emailsFalha.push(email);
        }
      })
    );

    const registro = {
      grupoId,
      adminId,
      conteudo: mensagem,
      destinatarios,
      enviados: emailsEnviados,
      falha: emailsFalha,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: emailsFalha.length ? 'parcial' : 'enviado',
    };
    await db.collection('mensagens').insertOne(registro);

    return res.status(200).json({
      message: 'Mensagem processada',
      enviados: emailsEnviados.length,
      falha: emailsFalha.length,
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem aos membros:', error);
    return res.status(500).json({ error: 'Erro interno ao enviar mensagem' });
  }
}
