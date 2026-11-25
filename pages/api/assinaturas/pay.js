import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { INVOICE_STATUS, createInvoice, getInvoiceById, markInvoiceAwaitingTopUp, markInvoicePaid } from '../../../lib/invoices';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../lib/wallet';
import { obterLedger } from '../../../lib/ledger/servidor';
import { CATEGORIAS } from '../../../lib/ledger/categorias';
import { SaldoInsuficienteError } from '../../../lib/ledger/ledger';
import { logAudit } from '../../../lib/audit';
import { precoDoGrupo } from '../../../lib/preco';
import { avaliarEntradaNoGrupo } from '../../../lib/grupo-entrada';

// Unicos status de fatura existente que o pay pode cobrar (ou reabrir para recarga).
const STATUS_FATURA_COBRAVEL = [INVOICE_STATUS.AGUARDANDO_PAGAMENTO, INVOICE_STATUS.AGUARDANDO_RECARGA];

const parseObjectId =(valor) => {
  if (valor instanceof ObjectId) return valor;
  if (typeof valor === 'string' && ObjectId.isValid(valor)) return new ObjectId(valor);
  return null;
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
      { projection: { nome: 1, valorPorVaga: 1, repassePorVaga: 1, taxaPorVaga: 1, precoValido: 1, status: 1, capacidadeTotal: 1, adminId: 1 } }
    );
    if (!grupo) {
      return res.status(404).json({ error: 'Grupo nao encontrado' });
    }

    // Preco vem so do grupo (003-preco-por-vaga, D-07): sem fallback para valorTotal
    // nem para o amount enviado pelo cliente. Fatura existente e cobrada pelo
    // proprio valor, congelado na emissao (FR-016).
    let invoice = null;
    let preco = null;
    let amount = NaN;
    if (invoiceIdRaw) {
      invoice = await getInvoiceById(invoiceIdRaw);
      if (!invoice || invoice.userId !== String(userId) || invoice.grupoId !== String(grupoIdRaw)) {
        return res.status(404).json({ error: 'Fatura nao encontrada para este usuario/grupo' });
      }
      // Fatura existente so segue se estiver paga (reconciliacao) ou aberta. Estornada
      // exige fatura nova; status desconhecido nunca e cobrado nem reaberto.
      if (invoice.status === INVOICE_STATUS.ESTORNADA) {
        return res.status(409).json({
          error: 'Esta fatura foi estornada. Inicie um novo pagamento.',
          codigo: 'fatura_estornada',
        });
      }
      if (!STATUS_FATURA_COBRAVEL.includes(invoice.status) && invoice.status !== INVOICE_STATUS.PAGA) {
        return res.status(409).json({
          error: 'Fatura indisponivel para pagamento. Inicie um novo pagamento.',
          codigo: 'fatura_indisponivel',
        });
      }
      amount = normalizeAmount(invoice.amount);
    } else {
      preco = precoDoGrupo(grupo);
      if (!preco.valido) {
        return res.status(409).json({ error: 'Preco indisponivel para este grupo', codigo: 'preco_indisponivel' });
      }
      amount = preco.valorPorVaga;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valor da fatura invalido' });
    }

    // B-04: nada e cobrado se a entrada e impossivel (grupo indisponivel/cheio,
    // usuario ja membro/dono/banido). Fatura ja paga nao e reavaliada: segue
    // devolvendo 200 para a reconciliacao de pagamentos ja feitos.
    if (!invoice || invoice.status !== INVOICE_STATUS.PAGA) {
      const membros = await db.collection('membrosGrupo').find({ grupoId: grupoIdObj }).toArray();
      const impedimento = avaliarEntradaNoGrupo({ grupo, userId, membros });
      if (impedimento) {
        return res.status(impedimento.http).json({ error: impedimento.error, codigo: impedimento.codigo });
      }
    }

    const wallet = await ensureWallet(userId);

    if (invoice) {
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
        composicao: { repasseDono: preco.repasse, taxaCotea: preco.taxa },
        status: INVOICE_STATUS.AGUARDANDO_PAGAMENTO,
        description: `Assinatura do grupo ${grupo?.nome || ''}`.trim(),
        metadata: { grupoNome: grupo?.nome || '', origem: 'checkout_grupo' },
      });
    }

    // Débito pessoal pelo núcleo (FR-008): o saldo é conferido dentro da
    // transação e a fatura é marcada paga na MESMA transação (D-08).
    const ledger = await obterLedger();
    let operacao = null;
    let saldoInsuficiente = null;
    try {
      operacao = await ledger.registrarOperacao({
        operacaoId: `assinatura_grupo:${invoice._id}`,
        source: 'assinatura_grupo',
        referenceId: invoice._id,
        descricao: `Assinatura do grupo ${grupo?.nome || grupoIdRaw}`,
        pernas: [{
          walletId: wallet._id,
          type: 'debit',
          categoria: CATEGORIAS.PESSOAL,
          valor: amount,
          grupoId: grupoIdRaw,
          organizacaoId: null,
        }],
        extra: ({ sessao, lancamentos }) => markInvoicePaid({
          invoiceId: invoice._id,
          walletId: wallet._id,
          ledgerId: lancamentos[0]._id,
          paidAt: new Date(),
        }, { session: sessao }),
      });
    } catch (err) {
      if (!(err instanceof SaldoInsuficienteError)) throw err;
      saldoInsuficiente = err;
    }

    // Debito ja existia (repeticao do mesmo operacaoId): nada foi cobrado agora e o
    // `extra` nao rodou. So responde "paga" se a fatura realmente esta paga.
    if (operacao && !operacao.criada) {
      const atual = await getInvoiceById(invoice._id);
      if (atual?.status !== INVOICE_STATUS.PAGA) {
        return res.status(409).json({
          error: 'Fatura em estado inconsistente. Inicie um novo pagamento.',
          codigo: 'fatura_inconsistente',
        });
      }
      return res.status(200).json({
        invoiceId: atual._id,
        status: atual.status,
        amount: atual.amount,
        walletId: atual.walletId || wallet._id,
        message: 'Fatura ja esta paga',
      });
    }

    if (operacao) {
      const ledgerEntry = operacao.lancamentos[0];
      const updatedInvoice = operacao.resultadoExtra;
      const updatedBalances = await calculateBalances(wallet._id);

      await logAudit({
        action: 'assinatura.paid',
        actorId: String(userId),
        actorEmail: session.user.email,
        targetId: String(updatedInvoice?._id || invoice._id),
        targetCollection: 'invoices',
        details: { grupoId: grupoIdRaw, grupoNome: grupo.nome, amount, ledgerId: String(ledgerEntry._id) },
        ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      });

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

    const saldoDisponivel = Number(saldoInsuficiente.disponivel) || 0;
    const faltante = Math.max(Math.round((amount - saldoDisponivel) * 100) / 100, 0);
    const awaitingInvoice = await markInvoiceAwaitingTopUp({
      invoiceId: invoice._id,
      faltante,
      saldoDisponivel,
    });

    return res.status(200).json({
      invoiceId: awaitingInvoice?._id || invoice._id,
      status: INVOICE_STATUS.AGUARDANDO_RECARGA,
      faltante,
      saldoDisponivel,
      walletId: wallet._id,
      amount,
      grupoId: grupoIdRaw,
    });
  } catch (error) {
    console.error('Erro ao criar/pagar fatura de assinatura:', error);
    return res.status(500).json({ error: 'Erro interno ao processar fatura' });
  }
}
