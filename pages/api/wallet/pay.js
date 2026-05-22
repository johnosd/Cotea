import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { insertLedgerEntry } from '../../../lib/mongodb';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../lib/wallet';

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
    const balances = await calculateBalances(wallet._id);
    if (amount > balances.available) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    const ledgerEntry = await insertLedgerEntry({
      walletId: wallet._id,
      type: 'debit',
      amount,
      source: 'uso_saldo',
      referenceId: null,
      status: 'confirmed',
      description: description || undefined,
    });

    const updatedBalances = await calculateBalances(wallet._id);

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
