// Elegibilidade de entrada em grupo (B-04). Funcoes puras, sem I/O: usadas por
// /api/assinaturas/pay (antes de cobrar) e /api/grupos/[id]/join (antes de
// registrar o membro), para as duas etapas nao divergirem.

export const STATUS_GRUPO_ABERTO = 'ativo';

export const MOTIVOS_ENTRADA = {
  GRUPO_INDISPONIVEL: 'grupo_indisponivel',
  GRUPO_CHEIO: 'grupo_cheio',
  DONO_DO_GRUPO: 'dono_do_grupo',
  JA_MEMBRO: 'ja_membro',
  MEMBRO_BANIDO: 'membro_banido',
};

const resposta = (http, codigo, error) => ({ http, codigo, error });

/** Grupo sem `status` conta como ativo (legado); qualquer outro valor bloqueia. */
export function motivoGrupoIndisponivel(grupo) {
  const status = grupo?.status ?? STATUS_GRUPO_ABERTO;
  if (status === STATUS_GRUPO_ABERTO) return null;
  return resposta(409, MOTIVOS_ENTRADA.GRUPO_INDISPONIVEL, 'Grupo indisponivel para novas entradas');
}

/** `membros` = membros do grupo (qualquer status); banidos nao ocupam vaga. */
export function motivoGrupoCheio(grupo, membros = []) {
  const capacidade = Number(grupo?.capacidadeTotal);
  if (!Number.isFinite(capacidade) || capacidade <= 0) return null;
  const ocupados = membros.filter((m) => m?.status !== 'banido').length;
  if (ocupados < capacidade) return null;
  return resposta(409, MOTIVOS_ENTRADA.GRUPO_CHEIO, 'Grupo sem vagas disponiveis');
}

/**
 * Avalia se `userId` pode comecar a pagar/entrar no grupo. Retorna `null` se
 * pode, ou `{ http, codigo, error }` com o primeiro impedimento.
 */
export function avaliarEntradaNoGrupo({ grupo, userId, membros = [] }) {
  const uid = String(userId);
  const meus = membros.filter((m) => m?.userId && String(m.userId) === uid);

  const ehDono = (grupo?.adminId && String(grupo.adminId) === uid)
    || meus.some((m) => m.papel === 'admin' && m.status !== 'banido');
  if (ehDono) {
    return resposta(409, MOTIVOS_ENTRADA.DONO_DO_GRUPO, 'Voce e dono deste grupo e nao precisa assina-lo');
  }
  if (meus.some((m) => m.status !== 'banido')) {
    return resposta(409, MOTIVOS_ENTRADA.JA_MEMBRO, 'Voce ja participa deste grupo');
  }
  if (meus.length > 0) {
    return resposta(403, MOTIVOS_ENTRADA.MEMBRO_BANIDO, 'Voce nao pode entrar neste grupo');
  }
  return motivoGrupoIndisponivel(grupo) || motivoGrupoCheio(grupo, membros);
}
