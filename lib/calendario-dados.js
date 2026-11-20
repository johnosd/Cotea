// Acesso a dados do calendário (feature 001-rotinas-agendadas).
// Recebe `db` por parâmetro e não importa lib/mongodb.js, para ser testável.
// Sem cache de módulo: cada disparo/requisição lê de novo (FR-014).

const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DESCRICAO_MAX = 100;

/** Datas extras não úteis cadastradas, como ['YYYY-MM-DD', ...] ordenadas. */
export async function carregarDatasExtras(db) {
  const docs = await db
    .collection('calendarioDatasExtras')
    .find({}, { projection: { _id: 1 } })
    .sort({ _id: 1 })
    .toArray();
  return docs.map((d) => d._id);
}

/** true se 'YYYY-MM-DD' é uma data real do calendário gregoriano. */
export function ehDataValida(data) {
  const m = FORMATO_DATA.exec(String(data || ''));
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * Valida a entrada do admin para uma data extra.
 * @returns {{ ok: true, data: string, descricao: string } | { ok: false, error: string }}
 */
export function validarDataExtra({ data, descricao } = {}) {
  const dataLimpa = String(data ?? '').trim();
  const descricaoLimpa = String(descricao ?? '').trim();
  if (!ehDataValida(dataLimpa)) return { ok: false, error: 'Data invalida. Use o formato AAAA-MM-DD.' };
  if (!descricaoLimpa) return { ok: false, error: 'Descricao obrigatoria' };
  if (descricaoLimpa.length > DESCRICAO_MAX) {
    return { ok: false, error: `Descricao deve ter no maximo ${DESCRICAO_MAX} caracteres` };
  }
  return { ok: true, data: dataLimpa, descricao: descricaoLimpa };
}
