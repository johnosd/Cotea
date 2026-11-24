import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { INVOICE_STATUS, getInvoiceById, markInvoiceRefunded } from '../../../lib/invoices';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../lib/wallet';
import { obterLedger } from '../../../lib/ledger/servidor';
import { CATEGORIAS } from '../../../lib/ledger/categorias';
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

    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) {
      return res.status(400).json({ error: 'invoiceId obrigatorio' });
    }

    const invoice = await getInvoiceById(invoiceId);
    if (!invoice || invoice.userId !== String(userId)) {
      return res.status(404).json({ error: 'Fatura nao encontrada' });
    }

    if (invoice.status === INVOICE_STATUS.ESTORNADA) {
      return res.status(200).json({ invoiceId, status: invoice.status, message: 'Fatura ja estornada' });
    }

    if (invoice.status !== INVOICE_STATUS.PAGA) {
      return res.status(400).json({ error: 'Apenas faturas pagas podem ser estornadas' });
    }

    const valor = normalizeAmount(invoice.amount);
    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ error: 'Valor da fatura invalido para estorno' });
    }

    const wallet = await ensureWallet(userId);

    // Crédito pessoal de estorno idempotente por operacaoId (D-05), com a
    // fatura marcada estornada na MESMA transação (D-08).
    const ledger = await obterLedger();
    const operacao = await ledger.registrarOperacao({
      operacaoId: `estorno_assinatura:${invoiceId}`,
      source: 'estorno_assinatura',
      referenceId: invoiceId,
      descricao: `Estorno fatura ${invoiceId}`,
      pernas: [{
        walletId: wallet._id,
        type: 'credit',
        categoria: CATEGORIAS.PESSOAL,
        valor,
        grupoId: invoice.grupoId ? String(invoice.grupoId) : null,
        organizacaoId: null,
      }],
      extra: ({ sessao, lancamentos }) => markInvoiceRefunded({
        invoiceId,
        walletId: wallet._id,
        ledgerId: lancamentos[0]._id,
        refundedAt: new Date(),
      }, { session: sessao }),
    });
    const creditEntry = operacao.lancamentos[0];

    if (!operacao.criada) {
      // Crédito já existia: só alinha a fatura (sem novo lançamento).
      await markInvoiceRefunded({ invoiceId, walletId: wallet._id, ledgerId: creditEntry._id });
    }
    const refunded = operacao.resultadoExtra;
    const balances = await calculateBalances(wallet._id);

    await logAudit({
      action: 'assinatura.refunded',
      actorId: String(userId),
      actorEmail: session.user.email,
      targetId: invoiceId,
      targetCollection: 'invoices',
      details: { amount: valor, ledgerId: String(creditEntry._id), walletId: String(wallet._id) },
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    });

    return res.status(200).json({
      invoiceId,
      status: refunded?.status || INVOICE_STATUS.ESTORNADA,
      ledgerId: creditEntry._id,
      walletId: wallet._id,
      balance: balances.balance,
      available: balances.available,
    });
  } catch (error) {
    console.error('Erro ao estornar fatura:', error);
    return res.status(500).json({ error: 'Erro interno ao estornar' });
  }
}
