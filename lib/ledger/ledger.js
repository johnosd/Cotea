// Núcleo do ledger segmentado (feature 002-ledger-segmentado).
// Algoritmo em sdd/specs/002-ledger-segmentado/logic/ledger.md. Puro: recebe o
// repositório por injeção e NÃO importa lib/mongodb.js.
//
// A interface do repositório é a do fake travado em
// tests/helpers/ledger-memoria.js; lib/ledger/repositorio-mongo.js a replica.

import {
  CATEGORIAS,
  CATEGORIAS_BLOQUEADAS,
  TODAS_CATEGORIAS,
  CONTA_PLATAFORMA_ID,
} from './categorias.js';

export { CATEGORIAS, CATEGORIAS_BLOQUEADAS, TODAS_CATEGORIAS, CONTA_PLATAFORMA_ID } from './categorias.js';

/** Saldo insuficiente na categoria/carteira (FR-008). Nada é gravado. */
export class SaldoInsuficienteError extends Error {
  constructor({ walletId, categoria, disponivel, solicitado }) {
    super('Saldo insuficiente');
    this.name = 'SaldoInsuficienteError';
    this.code = 'SALDO_INSUFICIENTE';
    this.walletId = walletId;
    this.categoria = categoria;
    this.disponivel = disponivel;
    this.solicitado = solicitado;
  }
}

/** Lançamento inválido: categoria/contexto ausente, grupo obrigatório, valor etc. (FR-002, FR-021). */
export class LancamentoInvalidoError extends Error {
  constructor(motivo) {
    super(`Lancamento invalido: ${motivo}`);
    this.name = 'LancamentoInvalidoError';
    this.code = 'LANCAMENTO_INVALIDO';
    this.motivo = motivo;
  }
}

const STATUS_PERNA = ['confirmed', 'blocked', 'pending'];

/** Reais → centavos inteiros (D-02). */
export const centavos = (valor) => Math.round(Number(valor) * 100);
/** Centavos → reais; `|| 0` evita -0. */
const reais = (c) => c / 100 || 0;

// Lançamento legado sem categoria conta como pessoal (D-09: janela deploy × migração).
const categoriaDe = (l) => l.categoria || CATEGORIAS.PESSOAL;

/**
 * Resumo derivado de uma lista de lançamentos de UMA carteira (FR-003..FR-005, FR-020).
 * @param {Array<object>} lancamentos
 * @returns {{
 *   total: number, disponivel: number, sacavel: number, saqueEmAndamento: number,
 *   pessoal: number, receitaTaxa: number,
 *   categorias: Record<'caucao'|'retido_entrada'|'recebivel_retido'|'disputa',
 *     { valor: number, porGrupo: Array<{ grupoId: string, participacaoId: string|null, valor: number }> }>
 * }}
 */
export function calcularResumo(lancamentos = []) {
  const net = Object.fromEntries(TODAS_CATEGORIAS.map((c) => [c, 0]));
  const grupos = Object.fromEntries(CATEGORIAS_BLOQUEADAS.map((c) => [c, new Map()]));
  let saque = 0;

  for (const l of lancamentos) {
    const valor = centavos(l.amount);
    if (!Number.isFinite(valor)) continue;
    if (l.type === 'debit' && l.status === 'blocked') {
      saque += valor;
      continue;
    }
    if (l.status !== 'confirmed') continue;
    const cat = categoriaDe(l);
    if (!(cat in net)) continue;
    const assinado = l.type === 'credit' ? valor : -valor;
    net[cat] += assinado;
    if (grupos[cat]) {
      const grupoId = l.grupoId ?? null;
      const participacaoId = l.participacaoId ?? null;
      const chave = `${grupoId}\u0000${participacaoId}`;
      const atual = grupos[cat].get(chave) || { grupoId, participacaoId, valor: 0 };
      atual.valor += assinado;
      grupos[cat].set(chave, atual);
    }
  }

  const categorias = {};
  for (const cat of CATEGORIAS_BLOQUEADAS) {
    categorias[cat] = {
      valor: reais(net[cat]),
      porGrupo: [...grupos[cat].values()]
        .filter((g) => g.valor !== 0)
        .map((g) => ({ grupoId: g.grupoId, participacaoId: g.participacaoId, valor: reais(g.valor) })),
    };
  }

  const total = Object.values(net).reduce((s, v) => s + v, 0);
  const disponivel = net[CATEGORIAS.PESSOAL] - saque;
  return {
    total: reais(total),
    disponivel: reais(disponivel),
    sacavel: reais(disponivel),
    saqueEmAndamento: reais(saque),
    pessoal: reais(net[CATEGORIAS.PESSOAL]),
    receitaTaxa: reais(net[CATEGORIAS.RECEITA_TAXA]),
    categorias,
  };
}

/** Saldo (centavos) que um débito de (categoria, grupoId) pode consumir — D-06. */
function saldoDaChave(lancamentos, categoria, grupoId) {
  if (categoria === CATEGORIAS.PESSOAL) {
    let pessoal = 0;
    let saque = 0;
    for (const l of lancamentos) {
      const v = centavos(l.amount);
      if (l.type === 'debit' && l.status === 'blocked') saque += v;
      else if (l.status === 'confirmed' && categoriaDe(l) === CATEGORIAS.PESSOAL) {
        pessoal += l.type === 'credit' ? v : -v;
      }
    }
    return pessoal - saque;
  }
  let saldo = 0;
  for (const l of lancamentos) {
    if (l.status !== 'confirmed' || categoriaDe(l) !== categoria) continue;
    if (CATEGORIAS_BLOQUEADAS.includes(categoria) && (l.grupoId ?? null) !== grupoId) continue;
    const v = centavos(l.amount);
    saldo += l.type === 'credit' ? v : -v;
  }
  return saldo;
}

function validarPerna(p, indice) {
  const onde = `perna ${indice}`;
  if (!p || typeof p !== 'object') throw new LancamentoInvalidoError(`${onde} ausente`);
  if (typeof p.walletId !== 'string' || !p.walletId) throw new LancamentoInvalidoError(`${onde} sem walletId`);
  if (p.type !== 'credit' && p.type !== 'debit') throw new LancamentoInvalidoError(`${onde} com type invalido`);
  if (!TODAS_CATEGORIAS.includes(p.categoria)) throw new LancamentoInvalidoError(`${onde} com categoria invalida`);
  // FR-021: o campo de contexto tem de estar presente; null = público.
  if (p.organizacaoId === undefined) throw new LancamentoInvalidoError(`${onde} sem organizacaoId`);
  if (p.organizacaoId !== null && typeof p.organizacaoId !== 'string') {
    throw new LancamentoInvalidoError(`${onde} com organizacaoId invalido`);
  }
  const valor = centavos(p.valor);
  if (!Number.isFinite(valor) || valor <= 0) throw new LancamentoInvalidoError(`${onde} com valor invalido`);

  const grupoId = p.grupoId ?? null;
  if (CATEGORIAS_BLOQUEADAS.includes(p.categoria) && !grupoId) {
    throw new LancamentoInvalidoError(`${onde}: categoria ${p.categoria} exige grupoId`);
  }
  const status = p.status ?? 'confirmed';
  if (!STATUS_PERNA.includes(status)) throw new LancamentoInvalidoError(`${onde} com status invalido`);
  if (status === 'blocked' && !(p.type === 'debit' && p.categoria === CATEGORIAS.PESSOAL)) {
    throw new LancamentoInvalidoError(`${onde}: status blocked so em debito de pessoal`);
  }
  const ehPlataforma = p.walletId === CONTA_PLATAFORMA_ID;
  const ehReceita = p.categoria === CATEGORIAS.RECEITA_TAXA;
  if (ehPlataforma !== ehReceita) {
    throw new LancamentoInvalidoError(`${onde}: receita_taxa so existe na conta da plataforma`);
  }

  return {
    walletId: p.walletId,
    type: p.type,
    categoria: p.categoria,
    centavos: valor,
    status,
    organizacaoId: p.organizacaoId,
    grupoId,
    participacaoId: p.participacaoId ?? null,
    descricao: p.descricao,
  };
}

const ehDuplicidade = (err) => err && (err.code === 11000 || err.code === 11001);

/**
 * @param {{ repo: object, agora?: () => Date, gerarId?: () => string }} deps
 */
export function criarLedger({ repo, agora = () => new Date(), gerarId = () => globalThis.crypto.randomUUID() } = {}) {
  if (!repo || typeof repo.executarAtomico !== 'function') {
    throw new Error('criarLedger exige um repositorio com executarAtomico');
  }

  const buscarExistentes = (operacaoId) =>
    repo.executarAtomico({ travar: [] }, (tx) => tx.buscarPorOperacao(operacaoId));

  async function registrarOperacao({ operacaoId, source, referenceId = null, descricao, pernas, extra } = {}) {
    if (typeof operacaoId !== 'string' || !operacaoId.trim()) throw new LancamentoInvalidoError('operacaoId vazio');
    if (typeof source !== 'string' || !source) throw new LancamentoInvalidoError('source vazio');
    if (!Array.isArray(pernas) || pernas.length === 0) throw new LancamentoInvalidoError('operacao sem pernas');
    const validas = pernas.map(validarPerna);

    // Só carteiras com débito travam (D-04): crédito nunca deixa saldo negativo.
    const travar = [...new Set(validas.filter((p) => p.type === 'debit').map((p) => p.walletId))];

    // Débitos que consomem saldo, agrupados por (carteira, categoria, grupo) — D-06.
    const exigencias = new Map();
    for (const p of validas) {
      if (p.type !== 'debit' || p.status === 'pending') continue;
      const grupoId = CATEGORIAS_BLOQUEADAS.includes(p.categoria) ? p.grupoId : null;
      const chave = `${p.walletId}\u0000${p.categoria}\u0000${grupoId}`;
      const atual = exigencias.get(chave) || { walletId: p.walletId, categoria: p.categoria, grupoId, centavos: 0 };
      atual.centavos += p.centavos;
      exigencias.set(chave, atual);
    }

    try {
      return await repo.executarAtomico({ travar }, async (tx) => {
        const existentes = await tx.buscarPorOperacao(operacaoId);
        // Idempotente: devolve o que já existe sem revalidar saldo (D-05).
        if (existentes.length > 0) return { criada: false, lancamentos: existentes };

        const porCarteira = new Map();
        for (const req of exigencias.values()) {
          if (!porCarteira.has(req.walletId)) porCarteira.set(req.walletId, await tx.listarLancamentos(req.walletId));
          const saldo = saldoDaChave(porCarteira.get(req.walletId), req.categoria, req.grupoId);
          if (saldo < req.centavos) {
            throw new SaldoInsuficienteError({
              walletId: req.walletId,
              categoria: req.categoria,
              disponivel: reais(Math.max(saldo, 0)),
              solicitado: reais(req.centavos),
            });
          }
        }

        const criadoEm = agora();
        const docs = validas.map((p) => {
          const desc = p.descricao ?? descricao;
          return {
            _id: gerarId(),
            walletId: p.walletId,
            type: p.type,
            amount: reais(p.centavos),
            source,
            referenceId: referenceId ?? null,
            status: p.status,
            categoria: p.categoria,
            organizacaoId: p.organizacaoId,
            grupoId: p.grupoId,
            participacaoId: p.participacaoId,
            operacaoId,
            pernasTotal: validas.length,
            ...(desc ? { description: desc } : {}),
            createdAt: criadoEm,
          };
        });

        // Efeito externo na MESMA transação (D-08): se lançar, nada fica.
        const resultadoExtra = extra ? await extra({ sessao: tx.sessao, lancamentos: docs }) : undefined;
        await tx.inserir(docs);
        return { criada: true, lancamentos: docs, resultadoExtra };
      });
    } catch (err) {
      // Corrida entre operações sem trava em comum (ex.: dois créditos PIX iguais):
      // o índice único de operacaoId recusa a segunda; ela vira repetição.
      if (ehDuplicidade(err)) {
        const existentes = await buscarExistentes(operacaoId);
        if (existentes.length > 0) return { criada: false, lancamentos: existentes };
      }
      throw err;
    }
  }

  async function mover({
    operacaoId,
    walletId,
    de,
    para,
    valor,
    grupoId = null,
    participacaoId = null,
    organizacaoId,
    source = 'movimentacao',
    referenceId = null,
    descricao,
    extra,
  } = {}) {
    if (de === para) throw new LancamentoInvalidoError('movimentacao com origem igual ao destino');
    const contexto = { walletId, valor, grupoId, participacaoId, organizacaoId };
    return registrarOperacao({
      operacaoId,
      source,
      referenceId,
      descricao,
      extra,
      pernas: [
        { ...contexto, type: 'debit', categoria: de },
        { ...contexto, type: 'credit', categoria: para },
      ],
    });
  }

  async function liquidarReserva({ operacaoId, acao, extra } = {}) {
    if (typeof operacaoId !== 'string' || !operacaoId) throw new LancamentoInvalidoError('operacaoId vazio');
    if (acao !== 'confirmar' && acao !== 'cancelar') throw new LancamentoInvalidoError('acao invalida');
    const para = acao === 'confirmar' ? 'confirmed' : 'cancelled';
    // Sem trava: confirmar ou liberar uma reserva nunca deixa saldo negativo.
    return repo.executarAtomico({ travar: [] }, async (tx) => {
      const alterados = await tx.atualizarStatus({ operacaoId, de: 'blocked', para });
      if (!extra) return { alterados };
      const resultadoExtra = await extra({ sessao: tx.sessao, alterados });
      return { alterados, resultadoExtra };
    });
  }

  async function resumo(walletId) {
    const lancamentos = await repo.executarAtomico({ travar: [] }, (tx) => tx.listarLancamentos(walletId));
    return calcularResumo(lancamentos);
  }

  return { registrarOperacao, mover, liquidarReserva, resumo };
}
