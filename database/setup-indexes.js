/**
 * Script de criação de índices do MongoDB.
 * Execute uma vez ao provisionar o banco ou após migrações estruturais:
 *
 *   node database/setup-indexes.js
 *
 * Fonte de verdade: database/setupDatabase.js. Este script é um espelho "só índices"
 * (sem validators/collMod): toda chave aqui DEVE existir lá com as MESMAS opções.
 * Garantido por tests/bugs/b09-setup-indexes-conflito.test.js.
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;

if (!MONGODB_URI || !MONGODB_DB) {
  console.error('MONGODB_URI e MONGODB_DB são obrigatórios');
  process.exit(1);
}

async function createIndexes() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  console.log('Criando índices...');

  // membrosGrupo — suporta o $match inicial em /api/meus-grupos
  await db.collection('membrosGrupo').createIndex({ userId: 1, status: 1 });

  // membrosGrupo — suporta o $lookup aninhado por grupoId em /api/meus-grupos
  await db.collection('membrosGrupo').createIndex({ grupoId: 1, status: 1 });

  // membrosGrupo — suporta busca de admin por papel em /api/grupos/[id] e /api/meus-grupos
  await db.collection('membrosGrupo').createIndex({ grupoId: 1, papel: 1 });

  // membrosGrupo — suporta autorização de escrita em /api/grupos/[id]
  await db.collection('membrosGrupo').createIndex({ grupoId: 1, userId: 1, papel: 1 });

  // grupos — suporta busca por slug em criação de grupo (evita duplicatas)
  await db.collection('grupos').createIndex({ slug: 1 }, { unique: true });

  // grupos — suporta filtros por categoria e status na listagem pública
  await db.collection('grupos').createIndex({ categoria: 1, status: 1 });

  // walletTransactions — suporta cálculo de saldo em calculateBalances
  await db.collection('walletTransactions').createIndex({ walletId: 1, type: 1, status: 1 });

  // walletTransactions — suporta busca de idempotência por referenceId+source.
  // Definição IDÊNTICA à de setupDatabase.js (fonte de verdade): único parcial. Com opções
  // diferentes o MongoDB aborta com IndexKeySpecsConflict (B-09).
  await db.collection('walletTransactions').createIndex(
    { referenceId: 1, type: 1, source: 1 },
    { unique: true, partialFilterExpression: { referenceId: { $type: 'string' } } }
  );

  // walletTransactions — idempotência por operação do ledger segmentado (002, D-05)
  await db.collection('walletTransactions').createIndex(
    { operacaoId: 1, walletId: 1, categoria: 1, type: 1 },
    { unique: true, partialFilterExpression: { operacaoId: { $type: 'string' } } }
  );

  // walletTransactions — saldo por categoria e rotina de consistência (002)
  await db.collection('walletTransactions').createIndex({ walletId: 1, categoria: 1, status: 1 });

  // wallets — suporta busca de carteira por userId
  await db.collection('wallets').createIndex({ userId: 1 }, { unique: true });

  // invoices — suporta busca de fatura por userId e grupoId
  await db.collection('invoices').createIndex({ userId: 1, grupoId: 1 });

  // rateLimits — TTL para expiração automática de janelas de rate limit
  await db.collection('rateLimits').createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 });

  // notificacoesUsuario — suporta listagem por userId e lido
  await db.collection('notificacoesUsuario').createIndex({ userId: 1, lido: 1 });

  // auditLogs — suporta listagem por data
  await db.collection('auditLogs').createIndex({ createdAt: -1 });

  // verificationCodes — TTL para expirar códigos automaticamente
  await db.collection('verificationCodes').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  // rotinaItens — idempotência das rotinas agendadas (rotinaId + chave únicos; nunca expira)
  await db.collection('rotinaItens').createIndex({ rotinaId: 1, chave: 1 }, { unique: true });

  // rotinaItens — painel de rotinas (itens em falha por rotina)
  await db.collection('rotinaItens').createIndex({ rotinaId: 1, situacao: 1, atualizadoEm: -1 });

  // rotinaExecucoes — última execução / histórico por rotina
  await db.collection('rotinaExecucoes').createIndex({ rotinaId: 1, inicio: -1 });

  // rotinaExecucoes — TTL de 90 dias para o histórico de execuções
  await db.collection('rotinaExecucoes').createIndex({ inicio: 1 }, { expireAfterSeconds: 7776000 });

  // rotinaSaudeSondas — TTL de 7 dias para sondas de teste da rotina de saúde
  await db.collection('rotinaSaudeSondas').createIndex({ criadoEm: 1 }, { expireAfterSeconds: 604800 });

  console.log('Índices criados com sucesso.');
  await client.close();
}

createIndexes().catch((err) => {
  console.error('Erro ao criar índices:', err);
  process.exit(1);
});
