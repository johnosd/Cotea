import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getClient, getDb, insertLedgerEntry } from '../../../lib/mongodb';
import { INVOICE_STATUS, createInvoice, getInvoiceById, markInvoiceAwaitingTopUp, markInvoicePaid } from '../../../lib/invoices';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../lib/wallet';

const parseObjectId = (valor) => {
  if (valor instanceof ObjectId) return valor;
  if (typeof valor === 'string' && ObjectId.isValid(valor)) return new ObjectId(valor);
  return null;
};

const getGrupoPreco = (grupo) => {
  const valorVaga = normalizeAmount(grupo?.valorPorVaga);
  const valorTotal = normalizeAmount(grupo?.valorTotal);
  if (Number.isFinite(valorVaga) && valorVaga > 0) return valorVaga;
  if (Number.isFinite(valorTotal) && valorTotal > 0) return valorTotal;
  return NaN;
};

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
      return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para assinar grupos.' });
    }

    const grupoIdRaw = String(req.body?.grupoId || '').trim();
    const invoiceIdRaw = String(req.body?.invoiceId || '').trim() || null;
    const grupoIdObj = parseObjectId(grupoIdRaw);
    if (!grupoIdObj) {
      return res.status(400).json({ error: 'grupoId obrigatorio e invalido' });
    }

    const db = await getDb();
    const grupo = await db.collection('grupos').findOne(
      { _id: grupoIdObj },
      { projection: { nome: 1, valorPorVaga: 1, valorTotal: 1 } }
    );
    if (!grupo) {
      return res.status(404).json({ error: 'Grupo nao encontrado' });
    }

    const bodyAmount = normalizeAmount(req.body?.amount);
    const amountFromGrupo = getGrupoPreco(grupo);
    const amount = Number.isFinite(amountFromGrupo) && amountFromGrupo > 0
      ? amountFromGrupo
      : bodyAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valor da fatura invalido' });
    }

    const wallet = await ensureWallet(userId);

    let invoice = null;
    if (invoiceIdRaw) {
      invoice = await getInvoiceById(invoiceIdRaw);
      if (!invoice || invoice.userId !== String(userId) || invoice.grupoId !== String(grupoIdRaw)) {
        return res.status(404).json({ error: 'Fatura nao encontrada para este usuario/grupo' });
      }
      if (invoice.status === INVOICE_STATUS.PAGA) {
        return res.status(200).json({
          invoiceId: invoice._id,
          status: invoice.status,
          amount: invoice.amount,
          walletId: invoice.walletId || wallet._id,
          message: 'Fatura ja esta paga',
        });
      }
    } else {
      invoice = await createInvoice({
        userId,
        grupoId: grupoIdRaw,
        amount,
        status: INVOICE_STATUS.AGUARDANDO_PAGAMENTO,
        description: `Assinatura do grupo ${grupo?.nome || ''}`.trim(),
        metadata: { grupoNome: grupo?.nome || '', origem: 'checkout_grupo' },
      });
    }

    const balances = await calculateBalances(wallet._id);
    if (balances.available >= amount) {
      const mongoClient = await getClient();
      const txSession = mongoClient.startSession();
      let ledgerEntry, updatedInvoice;
      try {
        await txSession.withTransaction(async () => {
          ledgerEntry = await insertLedgerEntry({
            walletId: wallet._id,
            type: 'debit',
            amount,
            source: 'assinatura_grupo',
            referenceId: invoice._id,
            status: 'confirmed',
            description: `Assinatura do grupo ${grupo?.nome || grupoIdRaw}`,
          }, { session: txSession });

          updatedInvoice = await markInvoicePaid({
            invoiceId: invoice._id,
            walletId: wallet._id,
            ledgerId: ledgerEntry._id,
            paidAt: new Date(),
          }, { session: txSession });
        });
      } finally {
        await txSession.endSession();
      }

      const updatedBalances = await calculateBalances(wallet._id);
      return res.status(200).json({
        invoiceId: updatedInvoice?._id || invoice._id,
        status: INVOICE_STATUS.PAGA,
        ledgerId: ledgerEntry._id,
        walletId: wallet._id,
        amount,
        saldoAposDebito: updatedBalances.available,
        grupoId: grupoIdRaw,
      });
    }

    const faltante = Math.max(amount - balances.available, 0);
    const awaitingInvoice = await markInvoiceAwaitingTopUp({
      invoiceId: invoice._id,
      faltante,
      saldoDisponivel: balances.available,
    });

    return res.status(200).json({
      invoiceId: awaitingInvoice?._id || invoice._id,
      status: INVOICE_STATUS.AGUARDANDO_RECARGA,
      faltante,
      saldoDisponivel: balances.available,
      walletId: wallet._id,
      amount,
      grupoId: grupoIdRaw,
    });
  } catch (error) {
    console.error('Erro ao criar/pagar fatura de assinatura:', error);
    return res.status(500).json({ error: 'Erro interno ao processar fatura' });
  }
}
