import formidable from 'formidable';
import fs from 'fs/promises';
import path from 'path';
import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth';
import clientPromise from '../../../lib/mongodb';
import { authOptions } from '../auth/[...nextauth]';
import { uploadToR2, deleteFromR2, getPublicUrl, hasR2Config, missingR2Config } from '../../../lib/r2';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/pjpeg', 'image/x-png'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/x-png': '.png',
  'image/webp': '.webp',
};

const parseForm = (req) =>
  new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      maxFiles: 1,
      maxFileSize: MAX_SIZE,
      keepExtensions: true,
    });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });

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

  let formData;
  try {
    formData = await parseForm(req);
  } catch (error) {
    return res.status(400).json({ error: 'Falha ao processar upload: ' + error.message });
  }

  const groupId = formData.fields.groupId?.[0] || formData.fields.groupId;
  if (!groupId || !ObjectId.isValid(groupId)) {
    return res.status(400).json({ error: 'groupId invalido' });
  }

  const rawFile =
    formData.files.file || formData.files.image || Object.values(formData.files)[0];
  const file = Array.isArray(rawFile) ? rawFile[0] : rawFile;
  if (!file) {
    return res.status(400).json({ error: 'Arquivo de imagem obrigatorio' });
  }
  const mime = (file.mimetype || '').toLowerCase();
  const mimeOk = mime ? ALLOWED_MIME.includes(mime) : false;
  const extCandidates = [
    file.originalFilename,
    file.newFilename,
    file.filepath,
  ]
    .filter(Boolean)
    .map((name) => path.extname(name).toLowerCase())
    .filter(Boolean);
  const extFromName = extCandidates[0] || '';
  const mimeDerivedExt = mime ? MIME_TO_EXT[mime] : '';
  const extOk =
    (extFromName && ALLOWED_EXT.includes(extFromName)) ||
    (mimeDerivedExt && ALLOWED_EXT.includes(mimeDerivedExt)) ||
    extCandidates.some((e) => ALLOWED_EXT.includes(e));
  if (!mimeOk && !extOk) {
    return res.status(400).json({
      error: 'Formato invalido. Use jpeg, png ou webp.',
      detail: {
        mimetype: file.mimetype,
        originalFilename: file.originalFilename,
        newFilename: file.newFilename,
        filepath: file.filepath,
        extCandidates,
      },
    });
  }
  if (file.size > MAX_SIZE) {
    return res.status(400).json({ error: 'Tamanho maximo de 5MB excedido.' });
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB);
  const grupo = await db.collection('grupos').findOne({ _id: new ObjectId(groupId) });
  if (!grupo) {
    return res.status(404).json({ error: 'Grupo nao encontrado' });
  }

  // Valida se usuario e admin do grupo
  if (grupo.admin?.userId && String(grupo.admin.userId) !== String(session.user.id)) {
    return res.status(403).json({ error: 'Apenas administradores podem alterar a imagem' });
  }

  const finalExt = extFromName || mimeDerivedExt || '.jpg';
  const key = `imagens/grupos/${groupId}-${Date.now()}${finalExt}`;

  const buffer = await fs.readFile(file.filepath);
  await uploadToR2(key, buffer, file.mimetype);

  const newUrl = getPublicUrl(key);

  // Remove imagem antiga se houver
  const safeKeyFromUrl = (url) => {
    try {
      const u = new URL(url);
      return u.pathname.replace(/^\/+/, '');
    } catch (err) {
      return null;
    }
  };

  const oldKey = grupo.imageKey || safeKeyFromUrl(grupo.imageUrl) || safeKeyFromUrl(grupo.capa);

  if (oldKey && oldKey !== key) {
    try {
      await deleteFromR2(oldKey);
    } catch (err) {
      console.warn('Falha ao remover imagem antiga do R2:', err?.message);
    }
  }

  await db.collection('grupos').updateOne(
    { _id: new ObjectId(groupId) },
    { $set: { imageUrl: newUrl, imageKey: key, capa: newUrl } }
  );

  return res.status(200).json({ url: newUrl, key });
}
