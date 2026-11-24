// POST /api/admin/rotinas/[id]/executar — disparo manual da rotina inteira (FR-018, FR-020).
import { getDb } from '../../../../../lib/mongodb';
import { logAudit } from '../../../../../lib/audit';
import { getClientIp } from '../../../../../lib/ratelimit';
import { exigirAdminRotinas } from '../../../../../lib/rotinas/autorizacao';
import { obterRotina } from '../../../../../lib/rotinas/registro';
import { executarRotina } from '../../../../../lib/rotinas/executor';
import { montarDependencias, PRAZO_EXECUCAO_MS } from '../../../../../lib/rotinas/dependencias';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }
  const auth = await exigirAdminRotinas(req, res);
  if (!auth) return undefined;

  const rotina = obterRotina(String(req.query.id || ''));
  if (!rotina) return res.status(404).json({ error: 'Rotina nao encontrada' });

  try {
    const db = await getDb();
    const deps = await montarDependencias(db);
    const resultado = await executarRotina(rotina, { ...deps, origem: 'manual', autorId: auth.userId, prazoMs: PRAZO_EXECUCAO_MS });

    await logAudit({
      action: 'rotina.executada_manual',
      actorId: auth.userId,
      actorEmail: auth.session.user.email,
      targetId: rotina.id,
      targetCollection: 'rotinaExecucoes',
      details: {
        execucaoId: resultado.execucaoId,
        resultado: resultado.resultado,
        processados: resultado.processados,
        falhas: resultado.falhas,
        cortada: Boolean(resultado.cortada),
      },
      ip: getClientIp(req),
    });

    return res.status(200).json({ rotinaId: rotina.id, ...resultado });
  } catch (error) {
    console.error('Erro ao executar rotina manualmente:', error?.message || error);
    return res.status(500).json({ error: 'Erro interno ao executar rotina' });
  }
}
