// Montagem do ledger com MongoDB — SÓ para rotas/scripts do servidor
// (importa lib/mongodb.js, que valida variáveis de ambiente no import).
// Ver sdd/specs/002-ledger-segmentado/logic/ledger.md §8.
import { getClient, getDb } from '../mongodb.js';
import { criarLedger } from './ledger.js';
import { criarRepositorioLedgerMongo } from './repositorio-mongo.js';
import { CONTA_PLATAFORMA_ID, CONTA_PLATAFORMA_USER_ID } from './categorias.js';

export async function obterLedger() {
  const client = await getClient();
  const db = await getDb();
  return criarLedger({ repo: criarRepositorioLedgerMongo({ client, db }) });
}

/** Garante o documento fixo da conta da plataforma (D-07). Idempotente. */
export async function garantirContaPlataforma(db) {
  const banco = db || (await getDb());
  await banco.collection('wallets').updateOne(
    { _id: CONTA_PLATAFORMA_ID },
    {
      $setOnInsert: {
        userId: CONTA_PLATAFORMA_USER_ID,
        tipo: 'plataforma',
        status: 'active',
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  return CONTA_PLATAFORMA_ID;
}
