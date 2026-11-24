// Registro das rotinas agendadas. Features de negócio adicionam a própria
// rotina aqui (ver sdd/specs/001-rotinas-agendadas/logic/executor.md).
import { rotinaSaude } from './saude';
import { rotinaLedgerConsistencia } from './ledger-consistencia';

const ROTINAS = [rotinaSaude, rotinaLedgerConsistencia];

/** Rotinas registradas; por padrão só as ativas (disparo automático). */
export function listarRotinas({ incluirInativas = false } = {}) {
  return incluirInativas ? [...ROTINAS] : ROTINAS.filter((r) => r.ativa !== false);
}

/** Rotina pelo id (ativa ou não), ou null. */
export function obterRotina(id) {
  return ROTINAS.find((r) => r.id === id) || null;
}
