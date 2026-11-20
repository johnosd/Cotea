// Calendário de prazos do Cotea (feature 001-rotinas-agendadas).
// Funções PURAS: não importar lib/mongodb.js aqui (o import valida env e
// quebraria os testes). Datas extras chegam por parâmetro; quem lê do banco
// é lib/calendario-dados.js.
// Regras: sdd/specs/001-rotinas-agendadas/logic/calendario.md
//
// Representação: "dia local" = string 'YYYY-MM-DD' no horário de Brasília.
// A aritmética de dias é feita sobre a string (Date.UTC), nunca somando 24h a
// um instante, para o fuso do servidor não interferir.

export const FUSO_BRASILIA = 'America/Sao_Paulo';
const DIA_MS = 86_400_000;
const FERIADOS_FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

const formatadorData = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_BRASILIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatadorPartes = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_BRASILIA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const cacheFeriados = new Map();

function exigirData(valor, nome) {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new TypeError(`${nome} deve ser uma data valida`);
  }
}

function exigirDias(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Quantidade de dias deve ser um inteiro maior ou igual a 1');
}

const pad = (n) => String(n).padStart(2, '0');

function partesDoDia(dia) {
  const [ano, mes, d] = dia.split('-').map(Number);
  return { ano, mes, d };
}

function diaDeUTC(ms) {
  const data = new Date(ms);
  return `${data.getUTCFullYear()}-${pad(data.getUTCMonth() + 1)}-${pad(data.getUTCDate())}`;
}

function proximoDia(dia) {
  const { ano, mes, d } = partesDoDia(dia);
  return diaDeUTC(Date.UTC(ano, mes - 1, d + 1));
}

/** Domingo de Páscoa (algoritmo anônimo gregoriano — Meeus/Jones/Butcher). */
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}

function feriadosDoAno(ano) {
  if (!cacheFeriados.has(ano)) {
    const datas = FERIADOS_FIXOS.map((md) => `${ano}-${md}`);
    datas.push(diaDeUTC(pascoa(ano) - 2 * DIA_MS)); // Sexta-feira Santa
    cacheFeriados.set(ano, Object.freeze(datas.sort()));
  }
  return cacheFeriados.get(ano);
}

/** Datas 'YYYY-MM-DD' dos feriados nacionais do ano (fixos + Sexta-feira Santa). */
export function feriadosNacionais(ano) {
  if (!Number.isInteger(ano)) throw new RangeError('Ano deve ser inteiro');
  return [...feriadosDoAno(ano)];
}

/** 'YYYY-MM-DD' do instante `data` no horário de Brasília. */
export function dataLocalBrasilia(data) {
  exigirData(data, 'data');
  return formatadorData.format(data);
}

/** true se a data local 'YYYY-MM-DD' é dia útil (não fim de semana, feriado nacional nem data extra). */
export function ehDiaUtil(dataISO, { datasExtras = [] } = {}) {
  const { ano, mes, d } = partesDoDia(String(dataISO));
  const diaSemana = new Date(Date.UTC(ano, mes - 1, d)).getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) return false;
  if (feriadosDoAno(ano).includes(dataISO)) return false;
  return !datasExtras.includes(dataISO);
}

/** Diferença (ms) entre o relógio de parede de Brasília e UTC no instante `ms`. */
function offsetBrasilia(ms) {
  const p = Object.fromEntries(formatadorPartes.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const parede = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return parede - Math.floor(ms / 1000) * 1000;
}

/** Instante de 23:59:59.999 do dia local em Brasília, sem fixar -03:00. */
function fimDoDiaBrasilia(dia) {
  const { ano, mes, d } = partesDoDia(dia);
  const palpite = Date.UTC(ano, mes - 1, d, 23, 59, 59, 999);
  return new Date(palpite - offsetBrasilia(palpite));
}

/** Instante exato do evento + n × 24h. */
export function vencimentoDiasCorridos(evento, n) {
  exigirData(evento, 'evento');
  exigirDias(n);
  return new Date(evento.getTime() + n * DIA_MS);
}

/** Último milissegundo (23:59:59.999, Brasília) do n-ésimo dia útil após o dia do evento. */
export function vencimentoDiasUteis(evento, n, { datasExtras = [] } = {}) {
  exigirData(evento, 'evento');
  exigirDias(n);
  let dia = dataLocalBrasilia(evento); // o dia do evento nunca conta
  let contados = 0;
  while (contados < n) {
    dia = proximoDia(dia);
    if (ehDiaUtil(dia, { datasExtras })) contados += 1;
  }
  return fimDoDiaBrasilia(dia);
}

/** true quando agora >= vencimento, calculado com o calendário recebido. */
export function prazoVencido({ evento, dias, tipo, agora, datasExtras = [] }) {
  exigirData(agora, 'agora');
  let vencimento;
  if (tipo === 'corridos') vencimento = vencimentoDiasCorridos(evento, dias);
  else if (tipo === 'uteis') vencimento = vencimentoDiasUteis(evento, dias, { datasExtras });
  else throw new RangeError("Tipo de prazo deve ser 'corridos' ou 'uteis'");
  return agora.getTime() >= vencimento.getTime();
}
