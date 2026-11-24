// Categorias de saldo do ledger segmentado (feature 002-ledger-segmentado).
// Puro: não importa lib/mongodb.js. Ver sdd/specs/002-ledger-segmentado/data-model.md.

export const CATEGORIAS = Object.freeze({
  PESSOAL: 'pessoal',
  CAUCAO: 'caucao',
  RETIDO_ENTRADA: 'retido_entrada',
  RECEBIVEL_RETIDO: 'recebivel_retido',
  DISPUTA: 'disputa',
  RECEITA_TAXA: 'receita_taxa',
});

/** Categorias que nunca compõem o disponível e exigem grupo (FR-002, FR-005). */
export const CATEGORIAS_BLOQUEADAS = Object.freeze([
  CATEGORIAS.CAUCAO,
  CATEGORIAS.RETIDO_ENTRADA,
  CATEGORIAS.RECEBIVEL_RETIDO,
  CATEGORIAS.DISPUTA,
]);

export const TODAS_CATEGORIAS = Object.freeze(Object.values(CATEGORIAS));

/** Carteira única da plataforma (Cotea), separada das carteiras de usuário (FR-011). */
export const CONTA_PLATAFORMA_ID = 'plataforma';
export const CONTA_PLATAFORMA_USER_ID = 'cotea:plataforma';
