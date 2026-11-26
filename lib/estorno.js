// Regra pura de elegibilidade do estorno de fatura de assinatura (B-02).
// O estorno existe só como compensação: o usuário pagou, mas a entrada no
// grupo não aconteceu. Depois de entrar (ou de a fatura ter sido consumida
// por uma entrada), a devolução passa por cancelamento/disputa.
// Não importar lib/mongodb aqui (valida env no import).

export const MOTIVO_ESTORNO = {
  MEMBRO_DO_GRUPO: 'membro_do_grupo',
  FATURA_VINCULADA: 'fatura_vinculada_a_entrada',
};

/**
 * @param {{ invoice: object, membro: object|null }} p
 *   `membro` = registro de membrosGrupo do usuário no grupo da fatura (qualquer status).
 * @returns {{ permitido: true } | { permitido: false, motivo: string }}
 */
export function avaliarEstorno({ invoice, membro }) {
  if (membro) return { permitido: false, motivo: MOTIVO_ESTORNO.MEMBRO_DO_GRUPO };
  if (invoice?.membroId || invoice?.vinculadoEm) {
    return { permitido: false, motivo: MOTIVO_ESTORNO.FATURA_VINCULADA };
  }
  return { permitido: true };
}

export const MENSAGEM_ESTORNO_NEGADO =
  'Estorno indisponivel: voce ja entrou neste grupo. Para pedir devolucao, use o cancelamento da participacao ou abra uma disputa.';
