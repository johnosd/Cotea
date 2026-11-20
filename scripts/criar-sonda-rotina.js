/**
 * Cria uma sonda de teste para a rotina de saúde (feature 001-rotinas-agendadas).
 *
 * USO:
 *   node --env-file=.env.local scripts/criar-sonda-rotina.js <minutosRelativos> [--falhar] [--quantidade=N]
 *
 * Exemplos:
 *   ... criar-sonda-rotina.js -5              # venceu há 5 minutos
 *   ... criar-sonda-rotina.js 60              # vence em 60 minutos
 *   ... criar-sonda-rotina.js -1 --falhar     # vencida e sempre falha (testa retentativa/alerta)
 *   ... criar-sonda-rotina.js -1440 --quantidade=10
 *
 * Sondas expiram sozinhas em 7 dias (TTL). Use apenas em desenvolvimento.
 */

import { randomUUID } from 'crypto';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const minutos = Number(args.find((a) => !a.startsWith('--')));
const falhar = args.includes('--falhar');
const quantidadeArg = args.find((a) => a.startsWith('--quantidade='));
const quantidade = quantidadeArg ? Number(quantidadeArg.split('=')[1]) : 1;

if (!Number.isFinite(minutos) || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 1000) {
  console.error('Uso: node --env-file=.env.local scripts/criar-sonda-rotina.js <minutosRelativos> [--falhar] [--quantidade=N]');
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;

if (!MONGODB_URI || !MONGODB_DB) {
  console.error('Defina MONGODB_URI e MONGODB_DB no .env.local');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db(MONGODB_DB);
  const agora = new Date();
  const venceEm = new Date(agora.getTime() + minutos * 60 * 1000);
  const sondas = Array.from({ length: quantidade }, () => ({ _id: randomUUID(), venceEm, falhar, criadoEm: agora }));

  await db.collection('rotinaSaudeSondas').insertMany(sondas);
  console.log(`${quantidade} sonda(s) criada(s), vence(m) em ${venceEm.toISOString()}${falhar ? ' (falhar)' : ''}:`);
  for (const s of sondas) console.log(`  sonda:${s._id}`);
} catch (err) {
  console.error('Erro ao criar sonda:', err.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
