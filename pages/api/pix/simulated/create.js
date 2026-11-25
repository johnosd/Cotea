import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import { insertPayment } from '../../../../lib/mongodb';
import { ensureWallet, getSessionUserId, normalizeAmount } from '../../../../lib/wallet';
import { checkRateLimit } from '../../../../lib/ratelimit';
import { encryptCPF } from '../../../../lib/encryption';
import { verificarCadastroFinanceiro } from '../../../../lib/cadastro-financeiro-servidor';

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
      return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para realizar pagamentos.' });
    }

    // 004-cadastro-financeiro (D-03): cadastro financeiro completo antes de qualquer efeito.
    const verificacao = await verificarCadastroFinanceiro(userId);
    if (!verificacao.ok) return res.status(verificacao.http).json(verificacao.body);

    const { allowed } = await checkRateLimit({
      key: `pix:${userId}`,
      max: 5,
      windowMs: 60 * 60 * 1000, // 1 hora
    });
    if (!allowed) {
      return res.status(429).json({ error: 'Limite de pagamentos atingido. Tente novamente em 1 hora.' });
    }

    const amount = normalizeAmount(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valor invalido' });
    }
    // 004-cadastro-financeiro (FR-015, D-07): o CPF do PIX é sempre o do perfil,
    // já validado pelo gate; qualquer `cpf` enviado pelo cliente é ignorado.
    const cpfDoPerfil = verificacao.cpf;

    const wallet = await ensureWallet(userId);
    const payment = await insertPayment({
      userId,
      gateway: 'simulated',
      pixCpf: encryptCPF(cpfDoPerfil),
      amount,
      status: 'pending',
    });

    return res.status(201).json({
      paymentId: payment._id,
      status: payment.status,
      walletId: wallet._id,
      qrCode: `SIMULATED-PIX-${payment._id}`,
      amount: payment.amount,
    });
  } catch (error) {
    console.error('Erro ao criar pagamento PIX simulado:', error);
    const message = error?.message || 'Erro interno no servidor';
    return res.status(500).json({ error: message });
  }
}
