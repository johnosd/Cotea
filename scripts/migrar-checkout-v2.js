/**
 * Migração única para o checkout v2 (feature 006-checkout-caucao, D-08 / FR-030).
 *
 * USO (de J:\Cotea):
 *   node --env-file=.env.local scripts/migrar-checkout-v2.js            # dry-run (padrão)
 *   node --env-file=.env.local scripts/migrar-checkout-v2.js --aplicar  # grava
 *
 * 1. Índice walletTransactions { referenceId, type, source }: deixa de ser único (a entrada
 *    com retenção e a devolução gravam duas pernas com a mesma referência). Aborta se o
 *    índice único por operacaoId não existir.
 * 2. Faturas do checkout antigo: abertas viram `cancelada`; pagas sem participação têm o
 *    valor devolvido ao saldo pelo ledger e viram `estornada`. As demais não mudam.
 * - Reexecutável. Uma entrada em auditLogs por fatura alterada.
 * - Não imprime valores de variáveis de ambiente.
 *
 * Ordem de implantação: migrar (--aplicar) ANTES de publicar o código → deploy → migrar de
 * novo (pega faturas criadas pelo código antigo na janela) → database/setup-indexes.js.
 */

import { MongoClient } from 'mongodb';
import { migrarFaturas, migrarIndice } from '../lib/checkout-migracao.js';
import { criarLedger } from '../lib/ledger/ledger.js';
import { criarRepositorioLedgerMongo } from '../lib/ledger/repositorio-mongo.js';

const aplicar = process.argv.includes('--aplicar');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
if (!MONGODB_URI || !MONGODB_DB) {
  console.error('Defina MONGODB_URI e MONGODB_DB no .env.local');
  process.exit(1);
}

const ROTULO_INDICE = {
  trocar: 'trocar o índice único por um não único',
  criar: 'criar o índice não único (não existe)',
  ok: 'já está não único',
};

const reais = (valor) => `R$ ${Number(valor || 0).toFixed(2)}`;
const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db(MONGODB_DB);
  console.log(`Modo: ${aplicar ? 'APLICAR' : 'dry-run'} | banco: ${MONGODB_DB}`);

  const acaoIndice = await migrarIndice({ colecao: db.collection('walletTransactions'), aplicar });
  console.log(`Índice referenceId_1_type_1_source_1: ${ROTULO_INDICE[acaoIndice]}${aplicar && acaoIndice !== 'ok' ? ' — feito' : ''}`);

  const ledger = criarLedger({ repo: criarRepositorioLedgerMongo({ client, db }) });
  const { plano, canceladas, estornadas, falhas } = await migrarFaturas({ db, ledger, aplicar });

  console.log(`Faturas: ${plano.length}`);
  for (const f of plano) {
    console.log(`  [${f.acao.toUpperCase().padEnd(8)}] ${f.invoiceId} status=${f.status ?? '—'} ${reais(f.amount)} usuario=${f.userId} grupo=${f.grupoId} (${f.motivo})`);
  }
  const de = (acao) => plano.filter((p) => p.acao === acao);
  const total = de('estornar').reduce((soma, p) => soma + Math.round(Number(p.amount) * 100), 0) / 100;
  console.log(
    `Resumo: ${de('estornar').length} a estornar (${reais(total)}), ${de('cancelar').length} a cancelar, ${de('manter').length} mantidas.`
  );

  if (!aplicar) {
    console.log('Dry-run concluído. Rode com --aplicar para gravar.');
  } else {
    console.log(`Aplicado: ${estornadas} estornadas, ${canceladas} canceladas, ${falhas.length} falhas.`);
    for (const f of falhas) console.log(`  FALHA ${f.invoiceId}: ${f.erro}`);
    if (falhas.length) process.exitCode = 1;
  }
} catch (erro) {
  console.error(`Migração interrompida: ${erro?.message || erro}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
