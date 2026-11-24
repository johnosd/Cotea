import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import { getDb } from '../../../../lib/mongodb';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../../lib/wallet';
import { obterLedger } from '../../../../lib/ledger/servidor';
import { CATEGORIAS } from '../../../../lib/ledger/categorias';
import { logAudit } from '../../../../lib/audit';

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

    const paymentId = String(req.body?.paymentId || '').trim();
    if (!paymentId) {
      return res.status(400).json({ error: 'paymentId obrigatorio' });
    }

    const db = await getDb();
    const payment = await db.collection('payments').findOne({ _id: paymentId, userId });
    if (!payment) {
      return res.status(404).json({ error: 'Pagamento nao encontrado' });
    }
    if (payment.status === 'failed') {
      return res.status(400).json({ error: 'Pagamento falhou' });
    }

    const creditAmount = normalizeAmount(payment.amount);
    if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
      return res.status(400).json({ error: 'Valor do pagamento invalido' });
    }

    const wallet = await ensureWallet(userId);
    const ledger = await obterLedger();
    const jaConfirmado = payment.status === 'confirmed';

    // Crédito pessoal idempotente por operacaoId (D-05). Pagamento pendente vira
    // confirmado na MESMA transação do crédito (D-08); já confirmado só garante
    // o lançamento, sem efeito extra.
    const operacao = await ledger.registrarOperacao({
      operacaoId: `pix:${paymentId}`,
      source: 'pix',
      referenceId: paymentId,
      pernas: [{
        walletId: wallet._id,
        type: 'credit',
        categoria: CATEGORIAS.PESSOAL,
        valor: creditAmount,
        organizacaoId: null,
      }],
      extra: jaConfirmado
        ? undefined
        : async ({ sessao }) => {
            const atualizado = await db.collection('payments').findOneAndUpdate(
              { _id: paymentId, userId, status: 'pending' },
              { $set: { status: 'confirmed' } },
              { returnDocument: 'after', session: sessao }
            );
            if (atualizado) return atualizado;
            const confirmado = await db.collection('payments').findOne(
              { _id: paymentId, userId, status: 'confirmed' },
              { session: sessao }
            );
            if (!confirmado) {
              throw Object.assign(new Error('Pagamento nao esta pendente'), { statusCode: 400 });
            }
            return confirmado;
          },
    });

    const ledgerEntry = operacao.lancamentos[0];
    if (!ledgerEntry?._id) {
      throw new Error('Falha ao criar registro de credito no ledger');
    }

    if (!operacao.criada && !jaConfirmado) {
      // Crédito já existia (repetição): só alinha o status do pagamento.
      await db.collection('payments').updateOne(
        { _id: paymentId, userId, status: 'pending' },
        { $set: { status: 'confirmed' } }
      );
    }

    if (operacao.criada) {
      await logAudit({
        action: 'wallet.credit',
        actorId: String(userId),
        actorEmail: session.user.email,
        targetId: String(wallet._id),
        targetCollection: 'wallets',
        details: { amount: creditAmount, ledgerId: String(ledgerEntry._id), paymentId, source: 'pix' },
        ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      });
    }

    const balances = await calculateBalances(wallet._id);
    if (jaConfirmado) {
      return res.status(200).json({
        paymentId,
        status: 'confirmed',
        ledgerId: ledgerEntry._id,
        walletId: wallet._id,
        balance: balances.balance,
        available: balances.available,
      });
    }

    return res.status(200).json({
      paymentId,
      status: 'confirmed',
      ledgerId: ledgerEntry._id,
      ledgerStatus: ledgerEntry.status,
      ledgerAmount: ledgerEntry.amount,
      ledgerSource: ledgerEntry.source,
      walletId: wallet._id,
      balance: balances.balance,
      available: balances.available,
    });
  } catch (error) {
    console.error('Erro ao confirmar PIX simulado:', error);
    return res.status(error?.statusCode || 500).json({ error: error?.message || 'Erro interno no servidor' });
  }
}
