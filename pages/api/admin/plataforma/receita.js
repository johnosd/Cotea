import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import { getDb } from '../../../../lib/mongodb';
import { getSessionUserId } from '../../../../lib/wallet';
import { PERMISSIONS, hasRole, isUserBlocked } from '../../../../lib/authz';
import { calcularResumo, CONTA_PLATAFORMA_ID } from '../../../../lib/ledger/ledger';

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

function lerLimite(valor) {
  const n = Number.parseInt(String(valor ?? ''), 10);
  if (!Number.isFinite(n)) return LIMITE_PADRAO;
  return Math.min(Math.max(n, 1), LIMITE_MAXIMO);
}

// Receita do Cotea: total e últimos lançamentos da conta da plataforma
// (002, US3-AC2 · D-07/D-12). Conta vazia é resposta válida.
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
    if (!hasRole(session, PERMISSIONS.LEDGER_FINANCEIRO)) {
      return res.status(403).json({ error: 'Apenas administradores ou financeiro podem ver a receita da plataforma' });
    }

    const limite = lerLimite(req.query?.limite);
    const db = await getDb();
    const colecao = db.collection('walletTransactions');
    const projection = { amount: 1, type: 1, status: 1, categoria: 1 };
    const todos = await colecao.find({ walletId: CONTA_PLATAFORMA_ID }, { projection }).toArray();
    const lancamentos = await colecao
      .find(
        { walletId: CONTA_PLATAFORMA_ID },
        { projection: { amount: 1, type: 1, status: 1, source: 1, referenceId: 1, operacaoId: 1, organizacaoId: 1, createdAt: 1 } }
      )
      .sort({ createdAt: -1 })
      .limit(limite)
      .toArray();

    return res.status(200).json({
      walletId: CONTA_PLATAFORMA_ID,
      total: calcularResumo(todos).receitaTaxa,
      lancamentos,
    });
  } catch (error) {
    console.error('Erro ao consultar receita da plataforma:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
