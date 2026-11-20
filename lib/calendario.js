// Calendário de prazos do Cotea (feature 001-rotinas-agendadas).
// Funções PURAS: não importar lib/mongodb.js aqui (o import valida env e
// quebraria os testes). Datas extras chegam por parâmetro; quem lê do banco
// é lib/calendario-dados.js.
//
// STUB criado pelo sdd-plan — implementação no sdd-execute.
// Regras: sdd/specs/001-rotinas-agendadas/logic/calendario.md

export const FUSO_BRASILIA = 'America/Sao_Paulo';

/** Datas 'YYYY-MM-DD' dos feriados nacionais do ano (fixos + Sexta-feira Santa). */
export function feriadosNacionais(ano) {
  throw new Error('not implemented');
}

/** 'YYYY-MM-DD' do instante `data` no horário de Brasília. */
export function dataLocalBrasilia(data) {
  throw new Error('not implemented');
}

/** true se a data local 'YYYY-MM-DD' é dia útil (não fim de semana, feriado nacional nem data extra). */
export function ehDiaUtil(dataISO, { datasExtras = [] } = {}) {
  throw new Error('not implemented');
}

/** Instante exato do evento + n × 24h. */
export function vencimentoDiasCorridos(evento, n) {
  throw new Error('not implemented');
}

/** Último milissegundo (23:59:59.999, Brasília) do n-ésimo dia útil após o dia do evento. */
export function vencimentoDiasUteis(evento, n, { datasExtras = [] } = {}) {
  throw new Error('not implemented');
}

/** true quando agora >= vencimento, calculado com o calendário recebido. */
export function prazoVencido({ evento, dias, tipo, agora, datasExtras = [] }) {
  throw new Error('not implemented');
}
