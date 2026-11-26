import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { insertWithdrawal } from '../../../lib/mongodb';
import { calculateBalances, ensureWallet, getSessionUserId, normalizeAmount } from '../../../lib/wallet';
import { encryptCPF } from '../../../lib/encryption';
import { obterLedger } from '../../../lib/ledger/servidor';
import { CATEGORIAS } from '../../../lib/ledger/categorias';
import { SaldoInsuficienteError } from '../../../lib/ledger/ledger';
import { logAudit } from '../../../lib/audit';
import { verificarCadastroFinanceiro } from '../../../lib/cadastro-financeiro-servidor';

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

    // 004-cadastro-financeiro (D-03): cadastro financeiro completo antes de qualquer efeito.
    const verificacao = await verificarCadastroFinanceiro(userId);
    if (!verificacao.ok) return res.status(verificacao.http).json(verificacao.body);

    const amount = normalizeAmount(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valor invalido' });
    }
    // 004-cadastro-financeiro (FR-016, D-07): a chave PIX do saque é sempre o CPF
    // do perfil; `cpfPixKey` enviado pelo cliente é ignorado e não é mais exigido.
    const cpfPixKey = verificacao.cpf;

    const wallet = await ensureWallet(userId);
    const ledger = await obterLedger();

    // O id do saque existe antes da operação: ele compõe o operacaoId (D-05).
    const withdrawalId = randomUUID();
    const pixKeyCpf = encryptCPF(cpfPixKey);

    // Reserva (débito blocked de pessoal) com saldo conferido dentro da
    // transação, carteira travada (FR-008/FR-010); o saque é criado na MESMA
    // transação (D-08).
    let operacao;
    try {
      operacao = await ledger.registrarOperacao({
        operacaoId: `saque:${withdrawalId}`,
        source: 'saque',
        referenceId: withdrawalId,
        pernas: [{
          walletId: wallet._id,
          type: 'debit',
          categoria: CATEGORIAS.PESSOAL,
          valor: amount,
          status: 'blocked',
          organizacaoId: null,
        }],
        extra: ({ sessao }) => insertWithdrawal({
          _id: withdrawalId,
          userId,
          walletId: wallet._id,
          pixKeyCpf,
          amount,
          status: 'requested',
        }, { session: sessao }),
      });
    } catch (err) {
      if (err instanceof SaldoInsuficienteError) {
        return res.status(400).json({ error: 'Saldo insuficiente para saque' });
      }
      throw err;
    }
    const withdrawal = operacao.resultadoExtra;
    const ledgerEntry = operacao.lancamentos[0];

    // Auditoria só depois do commit (R-003); sem CPF.
    await logAudit({
      action: 'withdrawal.requested',
      actorId: String(userId),
      actorEmail: session.user.email,
      targetId: withdrawalId,
      targetCollection: 'withdrawals',
      details: { amount, walletId: String(wallet._id), ledgerId: String(ledgerEntry._id) },
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    });

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
