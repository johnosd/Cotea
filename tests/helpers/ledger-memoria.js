// Repositório do ledger em memória — helper de teste da feature
// 002-ledger-segmentado, TRAVADO junto com os testes de contrato.
// Define a interface (porta) que lib/ledger/repositorio-mongo.js também DEVE
// seguir:
//
//   executarAtomico({ travar: string[] }, fn(tx)) -> resultado de fn
//     - Serializa operações que travam a MESMA carteira (no Mongo: transação +
//       $inc em wallets.versaoLedger, que gera WriteConflict e retentativa).
//     - Tudo que fn gravar via tx é confirmado junto; se fn lançar, nada fica.
//   tx.listarLancamentos(walletId)   -> lançamentos da carteira (inclui os já gravados nesta tx)
//   tx.buscarPorOperacao(operacaoId) -> lançamentos da operação (qualquer carteira)
//   tx.inserir(lancamentos[])        -> grava
//   tx.atualizarStatus({ operacaoId, de, para }) -> número de lançamentos alterados
//   tx.sessao                         -> sessão do driver (null aqui); repassada a efeitos extras
//
// As leituras cedem o event loop de propósito: sem trava, duas operações
// simultâneas leem o mesmo saldo antes de qualquer uma gravar.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export function criarRepositorioLedgerMemoria() {
  let lancamentos = [];
  const filas = new Map(); // walletId -> Promise (cauda da fila)

  async function adquirir(walletIds) {
    const liberadores = [];
    for (const id of [...new Set(walletIds)].sort()) {
      const anterior = filas.get(id) || Promise.resolve();
      let liberar;
      const atual = new Promise((resolve) => { liberar = resolve; });
      filas.set(id, anterior.then(() => atual));
      await anterior;
      liberadores.push(liberar);
    }
    return () => liberadores.forEach((l) => l());
  }

  return {
    async executarAtomico({ travar = [] } = {}, fn) {
      const liberar = await adquirir(travar);
      const novos = [];
      const mudancas = []; // { _id, status }
      const visao = () => {
        const alterados = new Map(mudancas.map((m) => [m._id, m.status]));
        return [...lancamentos, ...novos].map((l) => (alterados.has(l._id) ? { ...l, status: alterados.get(l._id) } : l));
      };
      const tx = {
        sessao: null,
        async listarLancamentos(walletId) {
          await tick();
          return visao().filter((l) => l.walletId === walletId).map((l) => ({ ...l }));
        },
        async buscarPorOperacao(operacaoId) {
          await tick();
          return visao().filter((l) => l.operacaoId === operacaoId).map((l) => ({ ...l }));
        },
        async inserir(docs) {
          await tick();
          for (const d of docs) novos.push({ ...d });
        },
        async atualizarStatus({ operacaoId, de, para }) {
          await tick();
          const alvo = visao().filter((l) => l.operacaoId === operacaoId && l.status === de);
          for (const l of alvo) mudancas.push({ _id: l._id, status: para });
          return alvo.length;
        },
      };
      try {
        const resultado = await fn(tx);
        const alterados = new Map(mudancas.map((m) => [m._id, m.status]));
        lancamentos = [...lancamentos, ...novos].map((l) => (alterados.has(l._id) ? { ...l, status: alterados.get(l._id) } : l));
        return resultado;
      } finally {
        liberar();
      }
    },

    // Inspeção/semeadura (só testes)
    _semear(docs) { lancamentos.push(...docs.map((d) => ({ ...d }))); },
    _lancamentos: () => lancamentos.map((l) => ({ ...l })),
  };
}
