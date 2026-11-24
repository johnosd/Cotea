// Migração dos lançamentos legados para o ledger segmentado (002, D-10).
// Puro: não importa lib/mongodb.js. Usado por scripts/migrar-ledger-categorias.js.
import { CATEGORIAS } from './categorias.js';
import { calcularResumo } from './ledger.js';

/** operacaoId de um legado: <source>:<referenceId>, ou legado:<_id> sem referência. */
export function operacaoIdLegado(doc) {
  if (typeof doc.referenceId === 'string' && doc.referenceId && doc.source) {
    return `${doc.source}:${doc.referenceId}`;
  }
  return `legado:${doc._id}`;
}

/**
 * `$set` que leva um lançamento legado (sem categoria) ao formato novo.
 * Devolve null se o documento já tem categoria (nunca remigra).
 */
export function classificarLegado(doc, { pernasTotal = 1 } = {}) {
  if (!doc || doc.categoria) return null;
  return {
    categoria: CATEGORIAS.PESSOAL,
    organizacaoId: null,
    grupoId: null,
    participacaoId: null,
    operacaoId: operacaoIdLegado(doc),
    pernasTotal,
  };
}

/**
 * Plano de migração: um `$set` por legado; `pernasTotal` conta quantos legados
 * acabam com o mesmo operacaoId (para a rotina de consistência não acusar
 * operação incompleta).
 * @returns {Array<{ _id: any, walletId: string, set: object }>}
 */
export function planejarMigracao(legados) {
  const pendentes = legados.filter((d) => !d.categoria);
  const contagem = new Map();
  for (const d of pendentes) {
    const id = operacaoIdLegado(d);
    contagem.set(id, (contagem.get(id) || 0) + 1);
  }
  return pendentes.map((d) => ({
    _id: d._id,
    walletId: d.walletId,
    set: classificarLegado(d, { pernasTotal: contagem.get(operacaoIdLegado(d)) }),
  }));
}

/**
 * Resumo por carteira antes e depois de aplicar o plano (SC-001).
 * @param {Array<object>} lancamentos todos os lançamentos das carteiras afetadas
 * @param {ReturnType<typeof planejarMigracao>} plano
 * @returns {Array<{ walletId: string, documentos: number, migrados: number, antes: object, depois: object, igual: boolean }>}
 */
export function compararResumos(lancamentos, plano) {
  const setPorId = new Map(plano.map((p) => [String(p._id), p.set]));
  const porCarteira = new Map();
  for (const l of lancamentos) {
    if (!porCarteira.has(l.walletId)) porCarteira.set(l.walletId, []);
    porCarteira.get(l.walletId).push(l);
  }
  return [...porCarteira.entries()].map(([walletId, docs]) => {
    const depoisDocs = docs.map((d) => {
      const set = setPorId.get(String(d._id));
      return set ? { ...d, ...set } : d;
    });
    const antes = calcularResumo(docs);
    const depois = calcularResumo(depoisDocs);
    return {
      walletId,
      documentos: docs.length,
      migrados: docs.filter((d) => setPorId.has(String(d._id))).length,
      antes,
      depois,
      igual: JSON.stringify(antes) === JSON.stringify(depois),
    };
  });
}
