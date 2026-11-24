import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../lib/wallet';
import { obterLedger } from '../../../lib/ledger/servidor';
import { CATEGORIAS } from '../../../lib/ledger/categorias';
import { SaldoInsuficienteError } from '../../../lib/ledger/ledger';
import { logAudit } from '../../../lib/audit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const userId = getSessionUserId(session);
    if (!session || !userId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }

    const amount = normalizeAmount(req.body?.amount);
    const description = (req.body?.description || '').trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valor invalido' });
    }

    const wallet = await ensureWallet(userId);
    const ledger = await obterLedger();

    // Saldo conferido dentro da transação, com a carteira travada (FR-008).
    let operacao;
    try {
      operacao = await ledger.registrarOperacao({
        operacaoId: `uso_saldo:${randomUUID()}`,
        source: 'uso_saldo',
        referenceId: null,
        descricao: description || undefined,
        pernas: [{
          walletId: wallet._id,
          type: 'debit',
          categoria: CATEGORIAS.PESSOAL,
          valor: amount,
          organizacaoId: null,
        }],
      });
    } catch (err) {
      if (err instanceof SaldoInsuficienteError) {
        return res.status(400).json({ error: 'Saldo insuficiente' });
      }
      throw err;
    }
    const ledgerEntry = operacao.lancamentos[0];

    const updatedBalances = await calculateBalances(wallet._id);

    await logAudit({
      action: 'wallet.debit',
      actorId: String(userId),
      actorEmail: session.user.email,
      targetId: String(wallet._id),
      targetCollection: 'wallets',
      details: { amount, ledgerId: String(ledgerEntry._id), description: description || null },
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    });

    return res.status(201).json({
      walletId: wallet._id,
      ledgerId: ledgerEntry._id,
      balance: updatedBalances.balance,
      available: updatedBalances.available,
    });
  } catch (error) {
    console.error('Erro ao debitar carteira:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
