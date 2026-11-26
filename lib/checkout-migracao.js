/**
 * Migração única para o checkout v2 (006-checkout-caucao, logic §10 · D-08 / FR-030).
 * Recebe `db` e `ledger` por injeção (não importa lib/mongodb.js): usada por
 * scripts/migrar-checkout-v2.js e pelos testes. Reexecutável: o que já foi feito não muda.
 * Imports com extensão: o script roda em Node ESM.
 */
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { planejarMigracaoCheckout } from './checkout.js';

export const NOME_INDICE_REFERENCIA = 'referenceId_1_type_1_source_1';
const CHAVES_INDICE_REFERENCIA = { referenceId: 1, type: 1, source: 1 };
const OPCOES_INDICE_REFERENCIA = { partialFilterExpression: { referenceId: { $type: 'string' } } };
const ATOR = 'script:migrar-checkout-v2';

const mesmaChave = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * O que fazer com o índice por referência do ledger.
 * @param {Array<{ name: string, key: object, unique?: boolean }>} indices
 * @returns {'trocar'|'criar'|'ok'}
 * @throws se a idempotência por operacaoId (única) não existir: sem ela, tirar o índice
 *   antigo deixaria o ledger sem proteção contra repetição.
 */
export function planejarIndice(indices = []) {
  const porOperacao = indices.find((i) => mesmaChave(i.key, { operacaoId: 1, walletId: 1, categoria: 1, type: 1 }));
  if (!porOperacao?.unique) {
    throw new Error('Indice unico por operacaoId ausente em walletTransactions: migracao abortada.');
  }
  const atual = indices.find((i) => i.name === NOME_INDICE_REFERENCIA);
  if (!atual) return 'criar';
  return atual.unique ? 'trocar' : 'ok';
}

/** Torna o índice por referência parcial e NÃO único (D-08). */
export async function migrarIndice({ colecao, aplicar = false }) {
  const acao = planejarIndice(await colecao.indexes());
  if (aplicar && acao !== 'ok') {
    if (acao === 'trocar') await colecao.dropIndex(NOME_INDICE_REFERENCIA);
    await colecao.createIndex(CHAVES_INDICE_REFERENCIA, OPCOES_INDICE_REFERENCIA);
  }
  return acao;
}

const auditar = (db, action, fatura, details) => db.collection('auditLogs').insertOne({
  _id: randomUUID(),
  action,
  actorId: ATOR,
  actorEmail: null,
  targetId: String(fatura._id),
  targetCollection: 'invoices',
  details,
  ip: null,
  createdAt: new Date(),
});

/** Fatura aberta do checkout antigo: encerrada, nunca cobrada. */
async function cancelarFatura(db, fatura) {
  const r = await db.collection('invoices').updateOne(
    { _id: fatura._id, status: fatura.status },
    { $set: { status: 'cancelada', updatedAt: new Date() } }
  );
  if (r.matchedCount === 0) return false;
  await auditar(db, 'assinatura.cancelada_migracao', fatura, { statusAntes: fatura.status, amount: fatura.amount });
  return true;
}

/** Aviso interno da devolução (FR-031), com _id determinístico: repetir não duplica. */
async function avisarDevolucao(db, fatura) {
  if (!ObjectId.isValid(String(fatura.userId))) return;
  const valor = Number(fatura.amount).toFixed(2).replace('.', ',');
  try {
    await db.collection('notificacoesUsuario').insertOne({
      _id: `checkout:migracao:${fatura._id}`,
      userId: new ObjectId(String(fatura.userId)),
      titulo: 'Valor devolvido ao seu saldo',
      mensagem: `R$ ${valor} voltou para o seu saldo: um pagamento de assinatura que nao gerou participacao foi estornado.`,
      tipo: 'grupo',
      acao: '/wallet',
      lido: false,
      data: new Date(),
      importante: true,
    });
  } catch (erro) {
    if (erro?.code !== 11000) throw erro;
  }
}

/** Fatura paga sem participação: o valor volta ao saldo (mesmo operacaoId do estorno antigo). */
async function estornarFatura(db, ledger, fatura) {
  const wallet = await db.collection('wallets').findOne({ userId: String(fatura.userId) });
  if (!wallet) throw new Error(`carteira nao encontrada para a fatura ${fatura._id}`);
  const agora = new Date();
  const campos = (ledgerId) => ({
    $set: { status: 'estornada', walletId: wallet._id, ledgerId, refundedAt: agora, updatedAt: agora },
  });
  const operacao = await ledger.registrarOperacao({
    operacaoId: `estorno_assinatura:${fatura._id}`,
    source: 'estorno_assinatura',
    referenceId: String(fatura._id),
    descricao: `Estorno fatura ${fatura._id}`,
    pernas: [{
      walletId: wallet._id,
      type: 'credit',
      categoria: 'pessoal',
      valor: fatura.amount,
      grupoId: fatura.grupoId ? String(fatura.grupoId) : null,
      organizacaoId: null,
    }],
    extra: async ({ sessao, lancamentos }) => {
      const r = await db.collection('invoices').updateOne(
        { _id: fatura._id, status: 'paga' },
        campos(lancamentos[0]._id),
        { session: sessao }
      );
      // Alguém mudou a fatura: aborta o crédito junto.
      if (r.matchedCount === 0) throw new Error(`fatura ${fatura._id} mudou durante a migracao`);
    },
  });
  if (!operacao.criada) {
    // O crédito já existia: só alinha o status, sem novo lançamento.
    await db.collection('invoices').updateOne({ _id: fatura._id, status: 'paga' }, campos(operacao.lancamentos[0]._id));
  }
  await auditar(db, 'assinatura.refunded', fatura, {
    amount: fatura.amount, ledgerId: String(operacao.lancamentos[0]._id), origem: 'migracao_checkout_v2',
    creditoJaExistia: !operacao.criada,
  });
  await avisarDevolucao(db, fatura);
  return true;
}

/**
 * Planeja (e, com `aplicar`, executa) o tratamento das faturas do checkout antigo.
 * @returns {Promise<{ plano: Array<{ invoiceId: string, acao: string, motivo: string,
 *   status?: string, amount?: number, userId?: string, grupoId?: string }>,
 *   canceladas: number, estornadas: number, falhas: Array<{ invoiceId: string, erro: string }> }>}
 */
export async function migrarFaturas({ db, ledger, aplicar = false }) {
  const faturas = await db.collection('invoices').find({}).toArray();
  const membros = await db.collection('membrosGrupo').find({}).toArray();
  const porId = new Map(faturas.map((f) => [String(f._id), f]));
  const plano = planejarMigracaoCheckout({ faturas, membros }).map((item) => {
    const f = porId.get(item.invoiceId);
    return { ...item, status: f.status, amount: f.amount, userId: f.userId, grupoId: f.grupoId };
  });

  const resultado = { plano, canceladas: 0, estornadas: 0, falhas: [] };
  if (!aplicar) return resultado;

  for (const item of plano) {
    if (item.acao === 'manter') continue;
    const fatura = porId.get(item.invoiceId);
    try {
      if (item.acao === 'cancelar') {
        if (await cancelarFatura(db, fatura)) resultado.canceladas += 1;
      } else if (await estornarFatura(db, ledger, fatura)) {
        resultado.estornadas += 1;
      }
    } catch (erro) {
      resultado.falhas.push({ invoiceId: item.invoiceId, erro: String(erro?.message || erro) });
    }
  }
  return resultado;
}
