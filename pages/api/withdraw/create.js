import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getClient, insertLedgerEntry, insertWithdrawal } from '../../../lib/mongodb';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../lib/wallet';
import { encryptCPF } from '../../../lib/encryption';

const CPF_REGEX = /^\d{11}$/;

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
    if (!session.user.contaValidada) {
      return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para realizar saques.' });
    }

    const amount = normalizeAmount(req.body?.amount);
    const cpfPixKey = String(req.body?.cpfPixKey || '').replace(/\D/g, '');
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valor invalido' });
    }
    if (!CPF_REGEX.test(cpfPixKey)) {
      return res.status(400).json({ error: 'PIX apenas CPF com 11 digitos' });
    }

    const wallet = await ensureWallet(userId);
    const balances = await calculateBalances(wallet._id);
    if (amount > balances.available) {
      return res.status(400).json({ error: 'Saldo insuficiente para saque' });
    }

    const mongoClient = await getClient();
    const txSession = mongoClient.startSession();
    let withdrawal, ledgerEntry;
    try {
      await txSession.withTransaction(async () => {
        withdrawal = await insertWithdrawal({
          userId,
          walletId: wallet._id,
          pixKeyCpf: encryptCPF(cpfPixKey),
          amount,
          status: 'requested',
        }, { session: txSession });

        ledgerEntry = await insertLedgerEntry({
          walletId: wallet._id,
          type: 'debit',
          amount,
          source: 'saque',
          referenceId: withdrawal._id,
          status: 'blocked',
        }, { session: txSession });
      });
    } finally {
      await txSession.endSession();
    }

    const updatedBalances = await calculateBalances(wallet._id);

    return res.status(201).json({
      withdrawalId: withdrawal._id,
      status: withdrawal.status,
      ledgerId: ledgerEntry._id,
      walletId: wallet._id,
      balance: updatedBalances.balance,
      available: updatedBalances.available,
    });
  } catch (error) {
    console.error('Erro ao solicitar saque:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
