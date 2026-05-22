import { createWallet, getDb, getWalletByUser } from './mongodb';

export function normalizeAmount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  return Math.round(num * 100) / 100;
}

export async function ensureWallet(userId) {
  if (!userId) {
    throw new Error('userId obrigatorio para carteira');
  }
  const existing = await getWalletByUser(userId);
  if (existing) return existing;
  try {
    return await createWallet({ userId });
  } catch (error) {
    // Evita falha em condição de corrida quando carteira já existe
    if (error?.code === 11000) {
      const duplicated = await getWalletByUser(userId);
      if (duplicated) return duplicated;
    }
    throw error;
  }
}

export async function calculateBalances(walletId) {
  if (!walletId) {
    throw new Error('walletId obrigatorio para calcular saldo');
  }
  const db = await getDb();
  const summary = await db
    .collection('walletTransactions')
    .aggregate([
      { $match: { walletId } },
      {
        $group: {
          _id: { type: '$type', status: '$status' },
          total: { $sum: '$amount' },
        },
      },
    ])
    .toArray();

  let confirmedCredits = 0;
  let confirmedDebits = 0;
  let blockedDebits = 0;
  let pendingTotal = 0;
  let returnedTotal = 0;

  for (const item of summary) {
    const { type, status } = item._id || {};
    const total = Number(item.total || 0);
    if (type === 'credit' && status === 'confirmed') confirmedCredits += total;
    if (type === 'debit' && status === 'confirmed') confirmedDebits += total;
    if (type === 'debit' && status === 'blocked') blockedDebits += total;
    if (status === 'pending') pendingTotal += total;
    if (status === 'cancelled') {
      // Cancelled debits funcionam como valores devolvidos; credits cancelados apenas informativos
      returnedTotal += type === 'debit' ? total : 0;
    }
  }

  const balance = confirmedCredits - confirmedDebits;
  const available = balance - blockedDebits;

  return { balance, available, confirmedCredits, confirmedDebits, blockedDebits, pendingTotal, returnedTotal };
}

export function getSessionUserId(session) {
  if (!session) return null;
  const candidate = session.user?.id || session.user?._id || session.user?.sub;
  return candidate ? String(candidate) : null;
}
