import { createWallet, getDb, getWalletByUser } from './mongodb';
import { calcularResumo } from './ledger/ledger.js';
import { mapearSaldosLegados } from './ledger/apresentacao.js';

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
  // Saldos derivados em centavos inteiros pelo núcleo do ledger (002, D-02/D-09):
  // devolve os campos antigos + `resumo` segmentado.
  const lancamentos = await db.collection('walletTransactions').find({ walletId }).toArray();
  return mapearSaldosLegados(calcularResumo(lancamentos), lancamentos);
}

export function getSessionUserId(session) {
  if (!session) return null;
  const candidate = session.user?.id || session.user?._id || session.user?.sub;
  return candidate ? String(candidate) : null;
}
