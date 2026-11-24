// Apresentação do resumo do ledger (002-ledger-segmentado). Não importa
// lib/mongodb.js (o db é injetado). Usado por lib/wallet.js (compatibilidade)
// e pelas rotas. Páginas (cliente) importam lib/ledger/rotulos.js, não este.
import { ObjectId } from 'mongodb';
import { centavos, CATEGORIAS_BLOQUEADAS } from './ledger.js';

export { ROTULOS_CATEGORIAS, ORDEM_CATEGORIAS_BLOQUEADAS } from './rotulos.js';

const reais = (c) => c / 100 || 0;

/**
 * Acrescenta `grupoNome` a cada item de `porGrupo` (contrato api-carteira).
 * `grupos._id` é ObjectId e o `grupoId` do ledger é string: busca pelos dois.
 * Grupo inexistente → `grupoNome: null`.
 */
export async function enriquecerResumo(db, resumo) {
  const ids = new Set();
  for (const cat of CATEGORIAS_BLOQUEADAS) {
    for (const g of resumo.categorias?.[cat]?.porGrupo || []) if (g.grupoId) ids.add(String(g.grupoId));
  }
  const nomes = new Map();
  if (ids.size > 0) {
    const chaves = [...ids].flatMap((id) => (ObjectId.isValid(id) && id.length === 24 ? [new ObjectId(id), id] : [id]));
    const grupos = await db
      .collection('grupos')
      .find({ _id: { $in: chaves } }, { projection: { nome: 1 } })
      .toArray();
    for (const g of grupos) nomes.set(String(g._id), g.nome ?? null);
  }
  const categorias = {};
  for (const cat of CATEGORIAS_BLOQUEADAS) {
    const atual = resumo.categorias?.[cat] || { valor: 0, porGrupo: [] };
    categorias[cat] = {
      valor: atual.valor,
      porGrupo: atual.porGrupo.map((g) => ({
        grupoId: g.grupoId,
        grupoNome: nomes.get(String(g.grupoId)) ?? null,
        participacaoId: g.participacaoId,
        valor: g.valor,
      })),
    };
  }
  return { ...resumo, categorias };
}

/** Resumo exposto ao usuário e ao financeiro: sem `receitaTaxa` (contrato api-carteira). */
export function resumoPublico(resumo) {
  return {
    total: resumo.total,
    disponivel: resumo.disponivel,
    sacavel: resumo.sacavel,
    saqueEmAndamento: resumo.saqueEmAndamento,
    categorias: resumo.categorias,
  };
}

/**
 * Campos antigos de calculateBalances derivados do resumo (D-09), para que os
 * consumidores atuais (pages/wallet/index.js, pages/assinatura/pagamento.js)
 * não quebrem. Lançamento sem categoria conta como pessoal (já tratado em
 * calcularResumo).
 */
export function mapearSaldosLegados(resumo, lancamentos = []) {
  let confirmedCredits = 0;
  let confirmedDebits = 0;
  let pendingTotal = 0;
  let returnedTotal = 0;
  for (const l of lancamentos) {
    const v = centavos(l.amount);
    if (!Number.isFinite(v)) continue;
    if (l.status === 'confirmed') {
      if (l.type === 'credit') confirmedCredits += v;
      else if (l.type === 'debit') confirmedDebits += v;
    } else if (l.status === 'pending') {
      pendingTotal += v;
    } else if (l.status === 'cancelled' && l.type === 'debit') {
      // Débitos cancelados funcionam como valores devolvidos (como antes)
      returnedTotal += v;
    }
  }
  return {
    balance: resumo.total,
    available: resumo.disponivel,
    confirmedCredits: reais(confirmedCredits),
    confirmedDebits: reais(confirmedDebits),
    blockedDebits: resumo.saqueEmAndamento,
    pendingTotal: reais(pendingTotal),
    returnedTotal: reais(returnedTotal),
    resumo,
  };
}
