// Rótulos e explicações das categorias de saldo (002-ledger-segmentado, US2).
// Sem dependências: pode ser importado por páginas (cliente) e pelo servidor.

export const ROTULOS_CATEGORIAS = Object.freeze({
  saqueEmAndamento: {
    rotulo: 'Saque em andamento',
    explicacao: 'Valor reservado para um saque que você pediu e o financeiro ainda vai pagar.',
  },
  caucao: {
    rotulo: 'Em caução',
    explicacao: 'Garantia da sua participação no grupo. Volta para o seu saldo quando a participação termina sem pendências.',
  },
  retido_entrada: {
    rotulo: 'Retido na entrada',
    explicacao: 'Valor de entrada ou de fila de um grupo, guardado até a sua vaga ser confirmada.',
  },
  recebivel_retido: {
    rotulo: 'A receber',
    explicacao: 'Valor que você vai receber de um grupo e que fica retido até o prazo de liberação.',
  },
  disputa: {
    rotulo: 'Em disputa',
    explicacao: 'Valor parado enquanto uma contestação do grupo é analisada.',
  },
});

/** Ordem de exibição das linhas de valores não disponíveis na carteira. */
export const ORDEM_CATEGORIAS_BLOQUEADAS = Object.freeze(['caucao', 'retido_entrada', 'recebivel_retido', 'disputa']);
