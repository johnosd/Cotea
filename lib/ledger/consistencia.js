// Verificação pura de consistência do ledger (002-ledger-segmentado, US4 · FR-019).
// Não importa lib/mongodb.js. Só ACHA problemas: nunca corrige (D-13).
// Ver sdd/specs/002-ledger-segmentado/logic/ledger.md §9.
import { CATEGORIAS, CATEGORIAS_BLOQUEADAS, TODAS_CATEGORIAS, CONTA_PLATAFORMA_ID } from './categorias.js';

export const TIPOS_ACHADO = Object.freeze({
  CATEGORIA_NEGATIVA: 'categoria_negativa',
  DISPONIVEL_NEGATIVO: 'disponivel_negativo',
  SEM_CATEGORIA: 'sem_categoria',
  SEM_CONTEXTO: 'sem_contexto',
  OPERACAO_INCOMPLETA: 'operacao_incompleta',
  CATEGORIA_FORA_DA_CONTA: 'categoria_fora_da_conta',
});

const reais = (c) => c / 100 || 0;

/**
 * @param {{
 *   agregados?: Array<{ walletId: string, categoria: string|null, grupoId: string|null, type: string, status: string, centavos: number }>,
 *   semCampos?: Array<{ walletId: string, semCategoria: number, semOrganizacao: number, bloqueadaSemGrupo: number }>,
 *   operacoesIncompletas?: Array<{ operacaoId: string, quantidade: number, pernasTotal: number, walletIds?: string[] }>,
 * }} entrada
 * @returns {Array<{ tipo: string, walletId?: string, categoria?: string, grupoId?: string|null, valor?: number, detalhe?: string, operacaoId?: string }>}
 */
export function verificarConsistencia({ agregados = [], semCampos = [], operacoesIncompletas = [] } = {}) {
  const achados = [];
  const net = new Map(); // walletId|categoria|grupoId -> centavos
  const pessoal = new Map(); // walletId -> { net, saque }
  const foraDaConta = new Set();

  for (const a of agregados) {
    const categoria = a.categoria || CATEGORIAS.PESSOAL; // sem categoria lê como pessoal (D-09)
    const c = Math.round(Number(a.centavos) || 0);

    if (a.categoria && !TODAS_CATEGORIAS.includes(a.categoria)) {
      foraDaConta.add(`${a.walletId}\u0000${a.categoria}`);
      continue;
    }
    const ehPlataforma = a.walletId === CONTA_PLATAFORMA_ID;
    if (ehPlataforma !== (categoria === CATEGORIAS.RECEITA_TAXA)) {
      foraDaConta.add(`${a.walletId}\u0000${categoria}`);
    }

    if (categoria === CATEGORIAS.PESSOAL) {
      const p = pessoal.get(a.walletId) || { net: 0, saque: 0 };
      if (a.type === 'debit' && a.status === 'blocked') p.saque += c;
      else if (a.status === 'confirmed') p.net += a.type === 'credit' ? c : -c;
      pessoal.set(a.walletId, p);
      continue;
    }
    if (a.status !== 'confirmed') continue;
    const grupoId = CATEGORIAS_BLOQUEADAS.includes(categoria) ? a.grupoId ?? null : null;
    const chave = `${a.walletId}\u0000${categoria}\u0000${grupoId}`;
    net.set(chave, (net.get(chave) || 0) + (a.type === 'credit' ? c : -c));
  }

  for (const [chave, valor] of net) {
    if (valor >= 0) continue;
    const [walletId, categoria, grupoTexto] = chave.split('\u0000');
    achados.push({
      tipo: TIPOS_ACHADO.CATEGORIA_NEGATIVA,
      walletId,
      categoria,
      grupoId: grupoTexto === 'null' ? null : grupoTexto,
      valor: reais(valor),
    });
  }

  for (const [walletId, p] of pessoal) {
    if (p.net < 0) {
      achados.push({ tipo: TIPOS_ACHADO.CATEGORIA_NEGATIVA, walletId, categoria: CATEGORIAS.PESSOAL, grupoId: null, valor: reais(p.net) });
    }
    const disponivel = p.net - p.saque;
    if (disponivel < 0) {
      achados.push({ tipo: TIPOS_ACHADO.DISPONIVEL_NEGATIVO, walletId, categoria: CATEGORIAS.PESSOAL, valor: reais(disponivel) });
    }
  }

  for (const chave of foraDaConta) {
    const [walletId, categoria] = chave.split('\u0000');
    achados.push({ tipo: TIPOS_ACHADO.CATEGORIA_FORA_DA_CONTA, walletId, categoria });
  }

  for (const s of semCampos) {
    if (s.semCategoria > 0) {
      achados.push({ tipo: TIPOS_ACHADO.SEM_CATEGORIA, walletId: s.walletId, detalhe: `${s.semCategoria} lançamento(s) sem categoria` });
    }
    if (s.semOrganizacao > 0) {
      achados.push({ tipo: TIPOS_ACHADO.SEM_CONTEXTO, walletId: s.walletId, detalhe: `${s.semOrganizacao} lançamento(s) sem organizacaoId` });
    }
    if (s.bloqueadaSemGrupo > 0) {
      achados.push({ tipo: TIPOS_ACHADO.SEM_CONTEXTO, walletId: s.walletId, detalhe: `${s.bloqueadaSemGrupo} lançamento(s) bloqueado(s) sem grupoId` });
    }
  }

  for (const o of operacoesIncompletas) {
    if (o.quantidade === o.pernasTotal) continue;
    achados.push({
      tipo: TIPOS_ACHADO.OPERACAO_INCOMPLETA,
      operacaoId: o.operacaoId,
      walletId: o.walletIds?.[0],
      detalhe: `${o.quantidade} de ${o.pernasTotal} lançamento(s) gravado(s)`,
    });
  }

  return achados;
}

/** Texto curto de um achado, para a notificação ao admin. */
export function descreverAchado(a) {
  const onde = [a.walletId && `carteira ${a.walletId}`, a.categoria, a.grupoId && `grupo ${a.grupoId}`, a.operacaoId && `operação ${a.operacaoId}`]
    .filter(Boolean)
    .join(', ');
  const extra = a.valor !== undefined ? ` (${a.valor})` : a.detalhe ? ` (${a.detalhe})` : '';
  return `${a.tipo}: ${onde}${extra}`;
}
