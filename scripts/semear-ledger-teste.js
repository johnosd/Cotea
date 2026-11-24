/**
 * SÓ DESENVOLVIMENTO — grava lançamentos de teste por categoria pelo núcleo do
 * ledger (feature 002-ledger-segmentado, quickstart 2.6).
 *
 * USO (de J:\Cotea):
 *   node --env-file=.env.local scripts/semear-ledger-teste.js <walletId> <categoria> <grupoId> <valor>
 *   node --env-file=.env.local scripts/semear-ledger-teste.js --remover <walletId>
 *
 * - Grava um CRÉDITO na categoria (ex.: caucao) com source 'teste' e
 *   operacaoId teste:<uuid>; o disponível não muda.
 * - --remover apaga só os lançamentos source 'teste' da carteira.
 * - Não imprime valores de variáveis de ambiente.
 */

import { randomUUID } from 'crypto';
import { MongoClient } from 'mongodb';
import { criarLedger, TODAS_CATEGORIAS } from '../lib/ledger/ledger.js';
import { criarRepositorioLedgerMongo } from '../lib/ledger/repositorio-mongo.js';

const args = process.argv.slice(2);
const uso = () => {
  console.error('Uso: semear-ledger-teste.js <walletId> <categoria> <grupoId> <valor> | --remover <walletId>');
  process.exit(1);
};

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

  if (args[0] === '--remover') {
    const walletId = args[1];
    if (!walletId) uso();
    const r = await db.collection('walletTransactions').deleteMany({ walletId, source: 'teste' });
    console.log(`Lançamentos de teste removidos da carteira ${walletId}: ${r.deletedCount}`);
  } else {
    const [walletId, categoria, grupoId, valorTexto] = args;
    const valor = Number(valorTexto);
    if (!walletId || !categoria || !grupoId || !Number.isFinite(valor)) uso();
    if (!TODAS_CATEGORIAS.includes(categoria)) {
      console.error(`Categoria inválida. Use uma de: ${TODAS_CATEGORIAS.join(', ')}`);
      process.exit(1);
    }
    const carteira = await db.collection('wallets').findOne({ _id: walletId }, { projection: { _id: 1 } });
    if (!carteira) {
      console.error(`Carteira não encontrada: ${walletId}`);
      process.exit(1);
    }

    const ledger = criarLedger({ repo: criarRepositorioLedgerMongo({ client, db }) });
    const r = await ledger.registrarOperacao({
      operacaoId: `teste:${randomUUID()}`,
      source: 'teste',
      descricao: 'Lançamento de teste (semear-ledger-teste)',
      pernas: [{ walletId, type: 'credit', categoria, valor, grupoId, participacaoId: null, organizacaoId: null }],
    });
    console.log(`Gravado ${r.lancamentos.length} lançamento(s) de teste: ${categoria} ${valor} no grupo ${grupoId}`);
    const resumo = await ledger.resumo(walletId);
    console.log(`Resumo: total ${resumo.total} | disponível ${resumo.disponivel} | ${categoria} ${resumo.categorias[categoria]?.valor ?? resumo.receitaTaxa}`);
  }
} finally {
  await client.close();
}
