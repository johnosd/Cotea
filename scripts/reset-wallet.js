/**
 * Script local para resetar a carteira de um usuário nos testes.
 *
 * USO:
 *   node --env-file=.env.local scripts/reset-wallet.js <userId>
 *
 * ATENÇÃO: apaga permanentemente payments, walletTransactions e withdrawals.
 *          Use apenas em ambiente de desenvolvimento.
 */

import { MongoClient, ObjectId } from 'mongodb';

const userId = process.argv[2];
if (!userId) {
  console.error('Uso: node --env-file=.env.local scripts/reset-wallet.js <userId>');
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

  const wallet = await db.collection('wallets').findOne({ userId });
  if (!wallet) {
    console.error(`Carteira nao encontrada para userId: ${userId}`);
    process.exit(1);
  }

  const payments = await db.collection('payments').deleteMany({ userId });
  const ledger = await db.collection('walletTransactions').deleteMany({ walletId: wallet._id });
  const withdrawals = await db.collection('withdrawals').deleteMany({ walletId: wallet._id });

  console.log(`Carteira resetada:`);
  console.log(`  walletId:          ${wallet._id}`);
  console.log(`  payments deletados:     ${payments.deletedCount}`);
  console.log(`  transações deletadas:   ${ledger.deletedCount}`);
  console.log(`  saques deletados:       ${withdrawals.deletedCount}`);
} finally {
  await client.close();
}
