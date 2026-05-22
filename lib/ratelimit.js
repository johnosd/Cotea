import { getDb } from './mongodb';

let indexEnsured = false;

async function ensureIndex(col) {
  if (indexEnsured) return;
  await col.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 });
  indexEnsured = true;
}

/**
 * Verifica rate limit usando MongoDB como store.
 * @param {object} opts
 * @param {string} opts.key    - chave única (ex: "sendCode:ip:1.2.3.4")
 * @param {number} opts.max    - máximo de requisições permitidas na janela
 * @param {number} opts.windowMs - tamanho da janela em milissegundos
 * @returns {{ allowed: boolean, count: number, max: number }}
 */
export async function checkRateLimit({ key, max, windowMs }) {
  const db = await getDb();
  const col = db.collection('rateLimits');

  await ensureIndex(col);

  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);

  const doc = await col.findOneAndUpdate(
    { key, resetAt: { $gt: now } },
    {
      $inc: { count: 1 },
      $setOnInsert: { key, resetAt },
    },
    { upsert: true, returnDocument: 'after' }
  );

  const count = doc?.count ?? 1;
  return { allowed: count <= max, count, max };
}

/**
 * Extrai o IP real do cliente respeitando proxies.
 */
export function getClientIp(req) {
  return (
    String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
