// Repositório do ledger sobre transações MongoDB (002-ledger-segmentado).
// Replica a porta de tests/helpers/ledger-memoria.js (travado):
//   executarAtomico({ travar }, fn(tx)) e tx.{ sessao, listarLancamentos,
//   buscarPorOperacao, inserir, atualizarStatus }.
// Ver sdd/specs/002-ledger-segmentado/logic/ledger.md §7.
//
// Trava por carteira (D-04): o $inc em wallets.versaoLedger é a primeira
// escrita da transação. Duas transações que travam a mesma carteira geram
// WriteConflict e o withTransaction repete a perdedora depois do commit da
// vencedora, já enxergando o débito dela.
//
// Não importa lib/mongodb.js: client e db são injetados (lib/ledger/servidor.js).

const OPCOES_TRANSACAO = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

export function criarRepositorioLedgerMongo({ client, db }) {
  if (!client || !db) throw new Error('criarRepositorioLedgerMongo exige client e db');
  const lancamentos = () => db.collection('walletTransactions');

  return {
    async executarAtomico({ travar = [] } = {}, fn) {
      const session = client.startSession();
      try {
        let resultado;
        // withTransaction pode chamar o callback mais de uma vez (erro
        // transitório/WriteConflict): o resultado vale o da última tentativa.
        await session.withTransaction(async () => {
          for (const walletId of [...new Set(travar)].sort()) {
            const r = await db
              .collection('wallets')
              .updateOne({ _id: walletId }, { $inc: { versaoLedger: 1 } }, { session });
            if (r.matchedCount === 0) throw new Error(`carteira inexistente: ${walletId}`);
          }
          resultado = await fn({
            sessao: session,
            listarLancamentos: (walletId) => lancamentos().find({ walletId }, { session }).toArray(),
            buscarPorOperacao: (operacaoId) => lancamentos().find({ operacaoId }, { session }).toArray(),
            inserir: async (docs) => {
              if (docs.length) await lancamentos().insertMany(docs, { session });
            },
            atualizarStatus: async ({ operacaoId, de, para }) => {
              const r = await lancamentos().updateMany(
                { operacaoId, status: de },
                { $set: { status: para } },
                { session }
              );
              return r.modifiedCount;
            },
          });
        }, OPCOES_TRANSACAO);
        return resultado;
      } finally {
        await session.endSession();
      }
    },
  };
}
