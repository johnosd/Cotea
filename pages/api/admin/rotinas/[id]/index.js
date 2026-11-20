// GET /api/admin/rotinas/[id] — histórico de execuções e itens com falha (FR-017).
import { getDb } from '../../../../../lib/mongodb';
import { exigirAdminRotinas } from '../../../../../lib/rotinas/autorizacao';
import { obterRotina } from '../../../../../lib/rotinas/registro';
import { detalharRotina } from '../../../../../lib/rotinas/consultas';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }
  const auth = await exigirAdminRotinas(req, res);
  if (!auth) return undefined;

  const rotina = obterRotina(String(req.query.id || ''));
  if (!rotina) return res.status(404).json({ error: 'Rotina nao encontrada' });

  try {
    const db = await getDb();
    return res.status(200).json(await detalharRotina(db, rotina));
  } catch (error) {
    console.error('Erro ao detalhar rotina:', error?.message || error);
    return res.status(500).json({ error: 'Erro interno ao carregar rotina' });
  }
}
