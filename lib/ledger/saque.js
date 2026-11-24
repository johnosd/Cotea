// Finalização de saque pelo núcleo do ledger (002-ledger-segmentado, T015).
// Só servidor: recebe db e ledger já montados (lib/ledger/servidor.js).
//
// A reserva (débito blocked de pessoal, operacaoId saque:<id>) muda de status
// na MESMA transação que o documento de withdrawals (D-08). Só `blocked` muda:
// aprovar depois de rejeitar (ou o contrário) devolve alterados: 0.

const STATUS_FINAL = { confirmar: 'paid', cancelar: 'rejected' };

/**
 * @returns {Promise<
 *   { ok: true, withdrawal: object, ledgerId: string } |
 *   { ok: false, status: number, error: string }
 * >}
 */
export async function finalizarSaque({ db, ledger, withdrawal, acao, adminId }) {
  const withdrawalId = String(withdrawal._id);
  const lancamento = await db
    .collection('walletTransactions')
    .findOne({ referenceId: withdrawalId, walletId: withdrawal.walletId, source: 'saque' });
  if (!lancamento) {
    return { ok: false, status: 404, error: 'Lancamento do saque nao encontrado' };
  }
  if (!lancamento.operacaoId) {
    // Legado ainda não migrado (R-005): rodar scripts/migrar-ledger-categorias.js.
    return { ok: false, status: 409, error: 'Lancamento do saque sem migracao' };
  }

  const novoStatus = STATUS_FINAL[acao];
  const { alterados, resultadoExtra } = await ledger.liquidarReserva({
    operacaoId: lancamento.operacaoId,
    acao,
    extra: async ({ sessao, alterados: n }) => {
      if (n === 0) return null;
      // Driver 6: findOneAndUpdate devolve o documento direto (sem .value).
      const atualizado = await db.collection('withdrawals').findOneAndUpdate(
        { _id: withdrawalId, status: { $nin: ['paid', 'rejected'] } },
        { $set: { status: novoStatus, adminId } },
        { returnDocument: 'after', session: sessao }
      );
      if (!atualizado) {
        // Saque finalizado por outra requisição: desfaz a mudança do lançamento.
        throw Object.assign(new Error('Saque ja finalizado'), { saqueFinalizado: true });
      }
      return atualizado;
    },
  }).catch((err) => {
    if (err?.saqueFinalizado) return { alterados: 0 };
    throw err;
  });

  if (alterados === 0) {
    return { ok: false, status: 400, error: 'Saque ja finalizado' };
  }
  return { ok: true, withdrawal: resultadoExtra, ledgerId: lancamento._id };
}
