import clientPromise from '../../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import { INVOICE_STATUS, getInvoiceById, markInvoiceRefunded } from '../../../../lib/invoices';
import { VAGAS_DONO } from '../../../../lib/preco';
import { motivoGrupoCheio, motivoGrupoIndisponivel } from '../../../../lib/grupo-entrada';
import { ensureWallet, normalizeAmount } from '../../../../lib/wallet';
import { obterLedger } from '../../../../lib/ledger/servidor';
import { CATEGORIAS } from '../../../../lib/ledger/categorias';
import { logAudit } from '../../../../lib/audit';

const parseObjectId = (valor) => {
  if (typeof valor === 'string' && ObjectId.isValid(valor)) return new ObjectId(valor);
  return null;
};

const parseNumero = (valor, padrao = NaN) => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : padrao;
};

// B-04: compensacao no servidor quando a fatura ja foi paga mas a entrada e
// impossivel (grupo indisponivel/cheio). Mesmo operacaoId do /api/assinaturas/refund,
// entao o estorno que a UI ainda dispara depois e idempotente. Nunca estorna
// fatura ja vinculada a uma entrada anterior. Falha aqui nao derruba a resposta:
// devolve false e a UI/refund seguem como rede de seguranca.
async function estornarFaturaSemVaga({ invoice, userId, motivo, req, session }) {
  if (invoice.vinculadoEm || invoice.membroId) return false;
  try {
    const valor = normalizeAmount(invoice.amount);
    if (!Number.isFinite(valor) || valor <= 0) return false;
    const invoiceId = String(invoice._id);
    const wallet = await ensureWallet(String(userId));
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
    const credito = operacao.lancamentos[0];
    if (!operacao.criada) {
      await markInvoiceRefunded({ invoiceId, walletId: wallet._id, ledgerId: credito._id });
    }
    await logAudit({
      action: 'assinatura.refunded',
      actorId: String(userId),
      actorEmail: session?.user?.email,
      targetId: invoiceId,
      targetCollection: 'invoices',
      details: { amount: valor, ledgerId: String(credito._id), walletId: String(wallet._id), origem: 'join_sem_vaga', motivo },
      ip: req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress,
    });
    return true;
  } catch (error) {
    console.error('Falha ao estornar fatura apos entrada impossivel:', error);
    return false;
  }
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID invalido' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);

    const grupoId = new ObjectId(id);
    const membrosCollection = db.collection('membrosGrupo');

    if (req.method === 'DELETE') {
      const deleteSession = await getServerSession(req, res, authOptions);
      const deleteSessionId = deleteSession?.user?.id || deleteSession?.user?._id || deleteSession?.user?.sub;
      if (!deleteSession || !deleteSessionId) {
        return res.status(401).json({ error: 'Nao autenticado' });
      }

      const { userId } = req.body || {};
      const userObjectId = parseObjectId(userId);
      if (!userObjectId) {
        return res.status(400).json({ error: 'userId obrigatorio e deve ser um ObjectId valido' });
      }

      const isStaffDelete = ['admin', 'support'].includes(deleteSession.user?.systemRole);
      if (!isStaffDelete && String(deleteSessionId) !== String(userId)) {
        return res.status(403).json({ error: 'Sem permissao para remover outro membro' });
      }

      const membro = await membrosCollection.findOne({ grupoId, userId: userObjectId });
      if (!membro) {
        return res.status(404).json({ error: 'Membro nao encontrado neste grupo' });
      }
      if (membro.papel === 'admin') {
        return res.status(403).json({ error: 'Administradores nao podem cancelar aqui' });
      }

      await membrosCollection.deleteOne({ _id: membro._id });
      const agora = new Date();
      await db.collection('grupos').updateOne({ _id: grupoId }, { $set: { updatedAt: agora } });

      // Notifica o admin que um membro saiu
      const adminMember = await membrosCollection.findOne({ grupoId, papel: 'admin' });
      const adminId = adminMember?.userId || null;
      if (adminId) {
        const grupo = await db.collection('grupos').findOne(
          { _id: grupoId },
          { projection: { nome: 1 } }
        );
        await db.collection('notificacoesUsuario').insertOne({
          userId: adminId,
          titulo: 'Membro cancelou participacao',
          mensagem: `Um membro saiu do grupo ${grupo?.nome || ''}. Revise as vagas e atualizacoes.`,
          tipo: 'grupo',
          acao: `/admin/grupos/${id}`,
          lido: false,
          data: agora,
          importante: false,
        });
      }

      return res.status(200).json({ message: 'Participacao cancelada' });
    }

    if (req.method === 'GET') {
      const userIdParam = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;
      const userObjectId = parseObjectId(userIdParam);

      if (!userObjectId) {
        return res.status(400).json({ error: 'userId obrigatorio e deve ser um ObjectId valido' });
      }

      const membro = await membrosCollection.findOne({
        grupoId,
        userId: userObjectId,
        status: { $ne: 'banido' },
      });

      return res.status(200).json({
        isMembro: Boolean(membro),
        status: membro?.status || null,
        papel: membro?.papel || null,
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ error: 'Metodo nao permitido' });
    }

    const session = await getServerSession(req, res, authOptions);
    const sessionUserId = session?.user?.id || session?.user?._id || session?.user?.sub;
    const userObjectId = parseObjectId(sessionUserId);

    if (!session || !userObjectId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }
    if (!session.user.contaValidada) {
      return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para entrar em grupos.' });
    }

    const invoiceIdRaw = String(req.body?.invoiceId || '').trim();
    if (!invoiceIdRaw) {
      return res.status(400).json({ error: 'invoiceId obrigatorio para entrar no grupo' });
    }
    const invoice = await getInvoiceById(invoiceIdRaw);
    if (!invoice || invoice.userId !== String(userObjectId) || invoice.grupoId !== String(id)) {
      return res.status(404).json({ error: 'Fatura nao encontrada para este usuario/grupo' });
    }
    if (invoice.status !== INVOICE_STATUS.PAGA) {
      return res.status(402).json({ error: 'Fatura nao esta paga', status: invoice.status });
    }

    const grupo = await db
      .collection('grupos')
      .findOne(
        { _id: grupoId },
        { projection: { capacidadeTotal: 1, acesso: 1, status: 1, statusDetalhado: 1, nome: 1 } }
      );

    if (!grupo) {
      return res.status(404).json({ error: 'Grupo nao encontrado' });
    }

    const membros = await membrosCollection.find({ grupoId, status: { $ne: 'banido' } }).toArray();

    const jaMembro = membros.find((m) => m.userId && m.userId.equals(userObjectId));
    if (jaMembro) {
      // Nao sobrescreve vinculo existente: reconciliacao so grava em fatura ainda livre.
      if (!invoice.vinculadoEm && !invoice.membroId) {
        await db.collection('invoices').updateOne(
          { _id: invoice._id },
          { $set: { vinculadoEm: new Date(), membroId: jaMembro._id } }
        );
      }
      return res.status(200).json({ message: 'Usuario ja e membro', membro: jaMembro, invoiceId: invoice._id });
    }

    // Uma fatura paga da direito a uma entrada: se ja foi vinculada a uma
    // participacao (mesmo encerrada, o DELETE apaga o membro mas o vinculo fica),
    // nao pode gerar outra. Nao estorna (a entrada anterior consumiu o pagamento).
    if (invoice.vinculadoEm || invoice.membroId) {
      return res.status(409).json({
        error: 'Esta fatura ja foi utilizada em uma entrada. Faca um novo pagamento para entrar novamente.',
        codigo: 'fatura_ja_utilizada',
        invoiceId: invoice._id,
        estornada: false,
      });
    }

    const impedimento = motivoGrupoIndisponivel(grupo) || motivoGrupoCheio(grupo, membros);
    if (impedimento) {
      const estornada = await estornarFaturaSemVaga({
        invoice, userId: userObjectId, motivo: impedimento.codigo, req, session,
      });
      return res.status(impedimento.http).json({
        error: impedimento.error,
        codigo: impedimento.codigo,
        invoiceId: invoice._id,
        estornada,
      });
    }

    const capacidadeNum = parseNumero(grupo.capacidadeTotal, NaN);
    const capacidade = Number.isFinite(capacidadeNum) && capacidadeNum > 0 ? capacidadeNum : Infinity;

    const agora = new Date();
    const novoMembro = {
      grupoId,
      userId: userObjectId,
      papel: 'membro',
      status: 'ativo',
      temCaucao: false,
      aguardandoEnvioAcesso: true,
      dataEntrada: agora,
      createdAt: agora,
      invoiceId: invoice._id,
      valorPago: invoice.amount,
      pagamentoStatus: invoice.status,
      pagamentoData: invoice.paidAt || agora,
    };

    let vagasDisponiveis = null;
    if (capacidade !== Infinity) {
      const reservadas = VAGAS_DONO; // vaga do dono, sempre 1 (003-preco-por-vaga, D-04)
      const membrosNaoAdmin = membros.filter((m) => m.papel !== 'admin').length + 1; // inclui o novo membro
      vagasDisponiveis = Math.max(capacidade - reservadas - membrosNaoAdmin, 0);
    }

    try {
      const insertResult = await membrosCollection.insertOne(novoMembro);

      // Corrida join x refund: se a fatura foi estornada entre a checagem acima e
      // o insert, desfaz a entrada (o dinheiro ja voltou) em vez de dar vaga gratis.
      const faturaAtual = await getInvoiceById(invoice._id);
      if (!faturaAtual || faturaAtual.status !== INVOICE_STATUS.PAGA) {
        await membrosCollection.deleteOne({ _id: insertResult.insertedId });
        return res.status(409).json({
          error: 'Pagamento estornado; entrada nao registrada',
          codigo: 'fatura_estornada',
          invoiceId: invoice._id,
        });
      }

      const totalMembros = membros.length + 1;
      const capacidadeNum = parseNumero(grupo.capacidadeTotal, NaN);
      const atingiuCapacidade = Number.isFinite(capacidadeNum) && capacidadeNum > 0 && totalMembros >= capacidadeNum;

      const updateGrupo = { $set: { updatedAt: agora } };
      if (grupo.acesso === 'apos_completar' && atingiuCapacidade) {
        updateGrupo.$set.statusDetalhado = 'ativo';
        updateGrupo.$set.status = 'ativo';
      }

      await db.collection('grupos').updateOne({ _id: grupoId }, updateGrupo);
      await db.collection('invoices').updateOne(
        { _id: invoice._id },
        { $set: { vinculadoEm: agora, membroId: insertResult.insertedId } }
      );

      // Notifica admin sobre novo membro
      const adminMemberNovo = await membrosCollection.findOne({ grupoId, papel: 'admin' });
      const adminIdNovo = adminMemberNovo?.userId;
      if (adminIdNovo) {
        await db.collection('notificacoesUsuario').insertOne({
          userId: adminIdNovo,
          titulo: 'Novo membro no grupo',
          mensagem: `Um novo membro entrou no grupo ${grupo.nome || ''}. Confira os detalhes e envie o acesso.`,
          tipo: 'grupo',
          acao: `/admin/grupos/${id}`,
          lido: false,
          data: agora,
          importante: false,
        });
      }

      if (grupo.acesso === 'apos_completar' && atingiuCapacidade) {
        const adminMember = await membrosCollection.findOne({ grupoId, papel: 'admin' });
        const adminId = adminMember?.userId;
        if (adminId) {
          await db.collection('notificacoesUsuario').insertOne({
            userId: adminId,
            titulo: 'Grupo formado',
            mensagem: `O grupo ${grupo.nome || ''} atingiu a capacidade e esta pronto para liberar acesso aos membros.`,
            tipo: 'grupo',
            acao: `/admin/grupos/${id}`,
            lido: false,
            data: agora,
            importante: true,
          });
        }
      }

      return res.status(200).json({ message: 'Membro adicionado', membroId: insertResult.insertedId, status: novoMembro.status });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(200).json({ message: 'Usuario ja e membro' });
      }
      throw error;
    }
  } catch (error) {
    console.error('Erro ao adicionar membro:', error);
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
}
