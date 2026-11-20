// /api/admin/calendario — feriados nacionais (leitura) e datas extras não úteis (FR-019, FR-020).
// GET ?ano=YYYY · POST { data, descricao } · DELETE ?data=YYYY-MM-DD. Só admin do sistema.
import { getDb } from '../../../lib/mongodb';
import { logAudit } from '../../../lib/audit';
import { getClientIp } from '../../../lib/ratelimit';
import { exigirAdminRotinas } from '../../../lib/rotinas/autorizacao';
import { dataLocalBrasilia, feriadosNacionais } from '../../../lib/calendario';
import { ehDataValida, validarDataExtra } from '../../../lib/calendario-dados';

async function listar(req, res, db) {
  const anoParam = Number(req.query.ano);
  const ano = Number.isInteger(anoParam) && anoParam >= 2000 && anoParam <= 2100
    ? anoParam
    : Number(dataLocalBrasilia(new Date()).slice(0, 4));

  const datasExtras = await db
    .collection('calendarioDatasExtras')
    .find({ _id: { $gte: `${ano}-01-01`, $lte: `${ano}-12-31` } })
    .sort({ _id: 1 })
    .toArray();

  return res.status(200).json({
    ano,
    feriadosNacionais: feriadosNacionais(ano),
    datasExtras: datasExtras.map((d) => ({ data: d._id, descricao: d.descricao, criadoPor: d.criadoPor, criadoEm: d.criadoEm })),
  });
}

async function incluir(req, res, db, auth) {
  const validacao = validarDataExtra(req.body || {});
  if (!validacao.ok) return res.status(400).json({ error: validacao.error });
  const { data, descricao } = validacao;

  if (feriadosNacionais(Number(data.slice(0, 4))).includes(data)) {
    return res.status(409).json({ error: 'Data ja e feriado nacional' });
  }

  try {
    await db.collection('calendarioDatasExtras').insertOne({
      _id: data,
      descricao,
      criadoPor: String(auth.userId),
      criadoEm: new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Data ja cadastrada' });
    throw error;
  }

  await logAudit({
    action: 'calendario.data_extra_incluida',
    actorId: auth.userId,
    actorEmail: auth.session.user.email,
    targetId: data,
    targetCollection: 'calendarioDatasExtras',
    details: { data, descricao },
    ip: getClientIp(req),
  });

  return res.status(201).json({ data, descricao });
}

async function remover(req, res, db, auth) {
  const data = String(req.query.data || '').trim();
  if (!ehDataValida(data)) return res.status(400).json({ error: 'Data invalida. Use o formato AAAA-MM-DD.' });

  const removida = await db.collection('calendarioDatasExtras').findOneAndDelete({ _id: data });
  if (!removida) return res.status(404).json({ error: 'Data nao cadastrada' });

  await logAudit({
    action: 'calendario.data_extra_removida',
    actorId: auth.userId,
    actorEmail: auth.session.user.email,
    targetId: data,
    targetCollection: 'calendarioDatasExtras',
    details: { data, descricao: removida.descricao },
    ip: getClientIp(req),
  });

  return res.status(200).json({ data });
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }
  const auth = await exigirAdminRotinas(req, res);
  if (!auth) return undefined;

  try {
    const db = await getDb();
    if (req.method === 'GET') return await listar(req, res, db);
    if (req.method === 'POST') return await incluir(req, res, db, auth);
    return await remover(req, res, db, auth);
  } catch (error) {
    console.error('Erro na API de calendario:', error?.message || error);
    return res.status(500).json({ error: 'Erro interno no calendario' });
  }
}
