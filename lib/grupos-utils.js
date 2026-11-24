import { ObjectId, Double, Int32 } from 'mongodb';
import { VAGAS_DONO } from './preco.js';

export const CATEGORIAS_PERMITIDAS = ['jogos', 'aplicativos', 'assinaturas', 'cursos'];

export const parseNumero = (valor, padrao = 0) => {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return numero < 0 ? 0 : numero;
};

export const parseObjectId = (valor) => {
  if (!valor) return null;
  if (valor instanceof ObjectId) return valor;
  if (typeof valor === 'string' && ObjectId.isValid(valor)) return new ObjectId(valor);
  return null;
};

export const parseLista = (valor) => {
  if (Array.isArray(valor)) return valor.filter(Boolean).map((item) => (typeof item === 'string' ? item.trim() : item));
  if (typeof valor === 'string') {
    return valor
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

export const parseFaq = (valor) => {
  if (Array.isArray(valor)) {
    return valor
      .map((item) => {
        if (!item) return null;
        if (typeof item === 'object' && item.pergunta && item.resposta) return { pergunta: String(item.pergunta), resposta: String(item.resposta) };
        if (typeof item === 'string') {
          const [pergunta, resposta] = item.split('|').map((s) => s?.trim());
          if (pergunta && resposta) return { pergunta, resposta };
        }
        return null;
      })
      .filter(Boolean);
  }
  if (typeof valor === 'string') {
    return valor
      .split(/\r?\n/)
      .map((linha) => {
        const [pergunta, resposta] = linha.split('|').map((s) => s?.trim());
        if (pergunta && resposta) return { pergunta, resposta };
        return null;
      })
      .filter(Boolean);
  }
  return [];
};

export const parseFidelidade = (body = {}) => {
  const { fidelidadePeriodo, fidelidadeRenovacao, fidelidadeObservacoes, fidelidadeProximaRenovacao } = body;
  const periodoMatch = String(fidelidadePeriodo || '').match(/\d+/);
  const periodoMeses = periodoMatch ? Number(periodoMatch[0]) : null;
  const renovacaoAutomatica = fidelidadeRenovacao !== undefined ? Boolean(fidelidadeRenovacao) : true;
  const observacoes = (fidelidadeObservacoes || '').trim();
  const proxima = fidelidadeProximaRenovacao ? new Date(fidelidadeProximaRenovacao) : null;
  const proximaRenovacao = proxima && !Number.isNaN(proxima.getTime()) ? proxima : null;
  return { periodoMeses, renovacaoAutomatica, observacoes, proximaRenovacao };
};

export const normalizarPreco = (valor) => {
  if (valor === undefined || valor === null) return NaN;
  const str = String(valor).replace(',', '.').trim();
  const num = Number(str);
  return Number.isFinite(num) ? num : NaN;
};

export const slugify = (text) =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');

/**
 * Campos de preço a gravar no grupo a partir do resultado válido de
 * calcularPrecoVaga (lib/preco.js) — feature 003-preco-por-vaga, D-03/D-04.
 */
export const camposPrecoParaGravar = (preco) => ({
  valorTotal: new Double(preco.valorTotal),
  capacidadeTotal: new Int32(preco.capacidade),
  valorPorVaga: new Double(preco.valorPorVaga),
  repassePorVaga: new Double(preco.repasse),
  taxaPorVaga: new Double(preco.taxa),
  precoValido: true,
  vagasReservadasAdmin: new Int32(VAGAS_DONO),
});

/** Resumo do preço de um documento de grupo, para auditoria (antes/depois). */
export const resumoPrecoAuditoria = (grupo = {}) => ({
  valorTotal: grupo.valorTotal != null ? Number(grupo.valorTotal) : null,
  capacidade: grupo.capacidadeTotal != null ? Number(grupo.capacidadeTotal) : null,
  valorPorVaga: grupo.valorPorVaga != null ? Number(grupo.valorPorVaga) : null,
  repassePorVaga: grupo.repassePorVaga != null ? Number(grupo.repassePorVaga) : null,
  taxaPorVaga: grupo.taxaPorVaga != null ? Number(grupo.taxaPorVaga) : null,
});
