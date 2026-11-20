// Consultas de leitura do painel de rotinas (FR-016, FR-017). Recebe `db`.

const LIMITE_EXECUCOES = 50;
const LIMITE_ITENS_FALHA = 100;

function formatarExecucao(e) {
  if (!e) return null;
  return {
    execucaoId: e._id,
    origem: e.origem,
    autorId: e.autorId ?? null,
    inicio: e.inicio,
    fim: e.fim,
    duracaoMs: e.fim && e.inicio ? new Date(e.fim).getTime() - new Date(e.inicio).getTime() : null,
    resultado: e.resultado,
    processados: e.processados ?? 0,
    ignorados: e.ignorados ?? 0,
    falhas: e.falhas ?? 0,
    pulados: e.pulados ?? 0,
    erro: e.erro ?? null,
  };
}

/** Resumo de cada rotina para a lista do painel. */
export async function resumirRotinas(db, rotinas) {
  const ids = rotinas.map((r) => r.id);
  const [ultimas, contagens] = await Promise.all([
    db
      .collection('rotinaExecucoes')
      .aggregate([
        { $match: { rotinaId: { $in: ids } } },
        { $sort: { inicio: -1 } },
        { $group: { _id: '$rotinaId', ultima: { $first: '$$ROOT' } } },
      ])
      .toArray(),
    db
      .collection('rotinaItens')
      .aggregate([
        { $match: { rotinaId: { $in: ids }, situacao: { $in: ['falha', 'falha_definitiva'] } } },
        { $group: { _id: { rotinaId: '$rotinaId', situacao: '$situacao' }, total: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const ultimaPorRotina = Object.fromEntries(ultimas.map((u) => [u._id, u.ultima]));
  const contar = (rotinaId, situacao) =>
    contagens.find((c) => c._id.rotinaId === rotinaId && c._id.situacao === situacao)?.total ?? 0;

  return rotinas.map((r) => ({
    id: r.id,
    descricao: r.descricao,
    ativa: r.ativa !== false,
    ultimaExecucao: formatarExecucao(ultimaPorRotina[r.id]),
    itensEmFalha: contar(r.id, 'falha'),
    itensFalhaDefinitiva: contar(r.id, 'falha_definitiva'),
  }));
}

/** Histórico de execuções e itens com falha de uma rotina. */
export async function detalharRotina(db, rotina) {
  const [execucoes, itensComFalha] = await Promise.all([
    db.collection('rotinaExecucoes').find({ rotinaId: rotina.id }).sort({ inicio: -1 }).limit(LIMITE_EXECUCOES).toArray(),
    db
      .collection('rotinaItens')
      .find(
        { rotinaId: rotina.id, situacao: { $in: ['falha', 'falha_definitiva'] } },
        { projection: { chave: 1, situacao: 1, tentativas: 1, ultimoErro: 1, atualizadoEm: 1 } }
      )
      .sort({ atualizadoEm: -1 })
      .limit(LIMITE_ITENS_FALHA)
      .toArray(),
  ]);

  return {
    id: rotina.id,
    descricao: rotina.descricao,
    ativa: rotina.ativa !== false,
    execucoes: execucoes.map(formatarExecucao),
    itensComFalha: itensComFalha.map(({ chave, situacao, tentativas, ultimoErro, atualizadoEm }) => ({
      chave,
      situacao,
      tentativas,
      ultimoErro,
      atualizadoEm,
    })),
  };
}
