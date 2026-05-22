import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth';
import clientPromise from '../../../lib/mongodb';
import { authOptions } from '../auth/[...nextauth]';
import { deleteFromR2, hasR2Config, missingR2Config } from '../../../lib/r2';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.id) {
    return res.status(401).json({ error: 'Nao autenticado' });
  }

  if (!hasR2Config()) {
    return res
      .status(500)
      .json({ error: `Configuracao R2 ausente: ${missingR2Config().join(', ')}` });
  }

  const { groupId } = req.body || {};
  if (!groupId || !ObjectId.isValid(groupId)) {
    return res.status(400).json({ error: 'groupId invalido' });
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB);

  const grupo = await db.collection('grupos').findOne({ _id: new ObjectId(groupId) });
  if (!grupo) {
    return res.status(404).json({ error: 'Grupo nao encontrado' });
  }

  if (grupo.admin?.userId && String(grupo.admin.userId) !== String(session.user.id)) {
    return res.status(403).json({ error: 'Apenas administradores podem remover a imagem' });
  }

  const oldKey = (() => {
    if (grupo.imageKey) return grupo.imageKey;
    if (grupo.imageUrl) {
      try {
        return new URL(grupo.imageUrl).pathname.replace(/^\/+/, '');
      } catch (e) {
        return null;
      }
    }
    return null;
  })();

  if (oldKey) {
    try {
      await deleteFromR2(oldKey);
    } catch (error) {
      console.warn('Falha ao remover imagem do R2:', error?.message);
    }
  }

  await db
    .collection('grupos')
    .updateOne({ _id: new ObjectId(groupId) }, { $set: { imageUrl: '', imageKey: '', capa: '' } });

  return res.status(200).json({ message: 'Imagem removida' });
}
