// GET /api/admin/rotinas — lista de rotinas com última execução e falhas (FR-016, FR-017).
import { getDb } from '../../../../lib/mongodb';
import { exigirAdminRotinas } from '../../../../lib/rotinas/autorizacao';
import { listarRotinas } from '../../../../lib/rotinas/registro';
import { resumirRotinas } from '../../../../lib/rotinas/consultas';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }
  const auth = await exigirAdminRotinas(req, res);
  if (!auth) return undefined;

  try {
    const db = await getDb();
    return res.status(200).json(await resumirRotinas(db, listarRotinas({ incluirInativas: true })));
  } catch (error) {
    console.error('Erro ao listar rotinas:', error?.message || error);
    return res.status(500).json({ error: 'Erro interno ao listar rotinas' });
  }
}
