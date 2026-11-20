// Executor de rotinas agendadas (feature 001-rotinas-agendadas).
// PURO em relação ao banco: recebe o repositório por injeção (`repo`), para
// rodar com Mongo em produção (lib/rotinas/repositorio-mongo.js) e com o fake
// em memória nos testes (tests/helpers/repositorio-rotinas-memoria.js).
//
// STUB criado pelo sdd-plan — implementação no sdd-execute.
// Regras: sdd/specs/001-rotinas-agendadas/logic/executor.md

export const MAX_TENTATIVAS = 5;
export const LEASE_PADRAO_MS = 10 * 60 * 1000;

export const SITUACAO = Object.freeze({
  PROCESSANDO: 'processando',
  CONCLUIDO: 'concluido',
  IGNORADO: 'ignorado',
  FALHA: 'falha',
  FALHA_DEFINITIVA: 'falha_definitiva',
});

/**
 * Executa uma passada da rotina.
 * @param {{ id: string, descricao: string,
 *   buscarVencidos: (ctx: { agora: Date, contexto: object }) => Promise<Array<{ chave: string, dados?: object }>>,
 *   processarItem: (ctx: { chave: string, dados: object, agora: Date, contexto: object }) => Promise<'concluido'|'ignorado'> }} rotina
 * @param {{ repo: object, agora?: Date, origem?: 'automatica'|'manual', autorId?: string|null,
 *   alertar?: (falha: { rotinaId: string, chave: string, erro: string, tentativas: number }) => Promise<void>,
 *   contexto?: object, limite?: number, leaseMs?: number, maxTentativas?: number }} opcoes
 * @returns {Promise<{ execucaoId: string, resultado: 'sucesso'|'parcial'|'erro',
 *   processados: number, ignorados: number, falhas: number, pulados: number }>}
 */
export async function executarRotina(rotina, opcoes) {
  throw new Error('not implemented');
}

/**
 * Reexecução manual de um item (normalmente em falha definitiva): reabre o
 * item (zera tentativas) e o processa com os `dados` gravados, respeitando a
 * idempotência (item concluído/ignorado não é reprocessado).
 */
export async function reexecutarItem(rotina, chave, opcoes) {
  throw new Error('not implemented');
}
