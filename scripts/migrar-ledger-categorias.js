/**
 * Migração dos lançamentos legados de walletTransactions para o ledger
 * segmentado (feature 002-ledger-segmentado, D-10).
 *
 * USO (de J:\Cotea):
 *   node --env-file=.env.local scripts/migrar-ledger-categorias.js            # dry-run (padrão)
 *   node --env-file=.env.local scripts/migrar-ledger-categorias.js --aplicar  # grava
 *
 * - Só toca documentos SEM `categoria` (reexecutar é seguro: 0 alterados).
 * - Legado vira `pessoal`, organizacaoId null, operacaoId <source>:<referenceId>
 *   (ou legado:<_id>), sem mudar nenhum saldo.
 * - Aborta, sem gravar, se o resumo de alguma carteira mudar.
 * - Não imprime valores de variáveis de ambiente.
 *
 * Ordem de implantação: migrar → deploy do código → migrar de novo →
 * database/setupDatabase.js (validator), este último só com autorização.
 */

import { MongoClient } from 'mongodb';
import { planejarMigracao, compararResumos } from '../lib/ledger/migracao.js';

const aplicar = process.argv.includes('--aplicar');

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
  const colecao = db.collection('walletTransactions');

  const legados = await colecao.find({ categoria: { $exists: false } }).toArray();
  console.log(`Modo: ${aplicar ? 'APLICAR' : 'dry-run'}`);
  console.log(`Lançamentos sem categoria: ${legados.length}`);

  if (legados.length === 0) {
    console.log('Nada a migrar (0 alterados).');
    process.exit(0);
  }

  const plano = planejarMigracao(legados);
  const carteiras = [...new Set(plano.map((p) => p.walletId))];
  const todos = await colecao.find({ walletId: { $in: carteiras } }).toArray();
  const comparacao = compararResumos(todos, plano);

  let divergiu = false;
  for (const c of comparacao) {
    const marca = c.igual ? 'OK ' : 'DIF';
    console.log(
      `[${marca}] carteira ${c.walletId}: ${c.migrados}/${c.documentos} a migrar | ` +
      `total ${c.antes.total} -> ${c.depois.total} | disponível ${c.antes.disponivel} -> ${c.depois.disponivel} | ` +
      `saque em andamento ${c.antes.saqueEmAndamento} -> ${c.depois.saqueEmAndamento}`
    );
    if (!c.igual) divergiu = true;
  }

  const porOperacao = plano.reduce((acc, p) => {
    const tipo = p.set.operacaoId.split(':')[0];
    acc[tipo] = (acc[tipo] || 0) + 1;
    return acc;
  }, {});
  console.log('Por prefixo de operacaoId:', porOperacao);

  if (divergiu) {
    console.error('ABORTADO: o resumo de alguma carteira mudaria. Nada foi gravado.');
    process.exit(2);
  }

  if (!aplicar) {
    console.log('Dry-run concluído. Rode com --aplicar para gravar.');
    process.exit(0);
  }

  const resultado = await colecao.bulkWrite(
    plano.map((p) => ({
      updateOne: {
        filter: { _id: p._id, categoria: { $exists: false } },
        update: { $set: p.set },
      },
    })),
    { ordered: true }
  );
  console.log(`Migrados: ${resultado.modifiedCount} de ${plano.length}`);

  const restantes = await colecao.countDocuments({
    $or: [{ categoria: { $exists: false } }, { organizacaoId: { $exists: false } }],
  });
  console.log(`Lançamentos ainda sem categoria/organizacaoId: ${restantes}`);
} finally {
  await client.close();
}
