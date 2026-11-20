// POST /api/admin/rotinas/[id]/reexecutar — reexecuta um item (FR-018, FR-020). Body: { chave }.
import { getDb } from '../../../../../lib/mongodb';
import { logAudit } from '../../../../../lib/audit';
import { getClientIp } from '../../../../../lib/ratelimit';
import { exigirAdminRotinas } from '../../../../../lib/rotinas/autorizacao';
import { obterRotina } from '../../../../../lib/rotinas/registro';
import { reexecutarItem } from '../../../../../lib/rotinas/executor';
import { montarDependencias } from '../../../../../lib/rotinas/dependencias';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }
  const auth = await exigirAdminRotinas(req, res);
  if (!auth) return undefined;

  const rotina = obterRotina(String(req.query.id || ''));
  if (!rotina) return res.status(404).json({ error: 'Rotina nao encontrada' });

  const chave = String(req.body?.chave || '').trim();
  if (!chave) return res.status(400).json({ error: 'chave obrigatoria' });

  try {
    const db = await getDb();
    const deps = await montarDependencias(db);
    const resultado = await reexecutarItem(rotina, chave, { ...deps, autorId: auth.userId });

    await logAudit({
      action: 'rotina.item_reexecutado',
      actorId: auth.userId,
      actorEmail: auth.session.user.email,
      targetId: `${rotina.id}:${chave}`,
      targetCollection: 'rotinaItens',
      details: { rotinaId: rotina.id, chave, situacao: resultado.situacao, reprocessado: resultado.reprocessado },
      ip: getClientIp(req),
    });

    return res.status(200).json(resultado);
  } catch (error) {
    if (error?.code === 'ITEM_NAO_ENCONTRADO') return res.status(404).json({ error: 'Item nao encontrado' });
    console.error('Erro ao reexecutar item de rotina:', error?.message || error);
    return res.status(500).json({ error: 'Erro interno ao reexecutar item' });
  }
}
