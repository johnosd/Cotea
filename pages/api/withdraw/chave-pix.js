import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { getSessionUserId } from '../../../lib/wallet';
import { PERMISSIONS, hasRole, isUserBlocked } from '../../../lib/authz';
import { decryptCPF } from '../../../lib/encryption';
import { logAudit } from '../../../lib/audit';
import { getClientIp } from '../../../lib/ratelimit';

// Único ponto que devolve o CPF completo da chave PIX de um saque: só para o
// financeiro, só enquanto o saque está em aberto (aprovar/rejeitar) e com
// trilha de auditoria (sem o CPF). As listagens devolvem apenas o mascarado.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const actorId = getSessionUserId(session);
    if (!session || !actorId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }
    if (isUserBlocked(session)) {
      return res.status(403).json({ error: 'Conta bloqueada. Procure o suporte.' });
    }
    if (!hasRole(session, PERMISSIONS.CPF_COMPLETO_SAQUE)) {
      return res.status(403).json({ error: 'Apenas o financeiro pode ver o CPF completo do saque' });
    }

    const withdrawalId = String(req.query?.withdrawalId || '').trim();
    if (!withdrawalId) {
      return res.status(400).json({ error: 'withdrawalId obrigatorio' });
    }

    const db = await getDb();
    const withdrawal = await db
      .collection('withdrawals')
      .findOne({ _id: withdrawalId }, { projection: { pixKeyCpf: 1, status: 1 } });
    if (!withdrawal) {
      return res.status(404).json({ error: 'Saque nao encontrado' });
    }
    if (!['requested', 'blocked'].includes(withdrawal.status)) {
      return res.status(400).json({ error: 'CPF completo so esta disponivel para saques em aberto' });
    }

    const cpf = decryptCPF(withdrawal.pixKeyCpf || '');
    if (!cpf) {
      return res.status(500).json({ error: 'Nao foi possivel ler a chave PIX do saque' });
    }

    await logAudit({
      action: 'withdrawal.cpf_viewed',
      actorId,
      actorEmail: session.user.email,
      targetId: withdrawalId,
      targetCollection: 'withdrawals',
      details: {},
      ip: getClientIp(req),
    });

    return res.status(200).json({ withdrawalId, cpf });
  } catch (error) {
    console.error('Erro ao consultar chave PIX do saque:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
