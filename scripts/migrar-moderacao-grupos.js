/**
 * Migração única dos grupos existentes para a moderação (feature
 * 005-aprovacao-grupos, FR-029 / D-02 / D-13).
 *
 * USO (de J:\Cotea):
 *   node --env-file=.env.local scripts/migrar-moderacao-grupos.js            # dry-run (padrão)
 *   node --env-file=.env.local scripts/migrar-moderacao-grupos.js --aplicar  # grava
 *
 * - Só grupos SEM `moderacao` (idempotente: reexecutar não altera nada).
 * - `status: 'ativo'` → mantém; grava `moderacao` com aprovação `legado` e sem
 *   revisão pendente (nada muda para os membros).
 * - Sem `status` → tratado como `ativo` legado (mesmo critério de
 *   lib/grupo-entrada.js): grava `status: 'ativo'` explícito + o mesmo acima.
 * - `status: 'cancelado'` → mantém; grava `moderacao` com o cancelamento.
 * - Qualquer outro valor (ex.: `inativo`) → NÃO altera; fica fora do ar e é
 *   listado como "não classificado".
 * - Uma entrada grupo.moderacao.migrado em auditLogs por grupo alterado.
 * - Não toca membrosGrupo, invoices, payments nem walletTransactions.
 * - Não imprime valores de variáveis de ambiente.
 *
 * Ordem de implantação: migrar → deploy do código → migrar de novo (pega
 * grupos criados pelo código antigo na janela).
 */

import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { planejarMigracaoModeracao } from '../lib/moderacao.js';

const aplicar = process.argv.includes('--aplicar');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
if (!MONGODB_URI || !MONGODB_DB) {
  console.error('Defina MONGODB_URI e MONGODB_DB no .env.local');
  process.exit(1);
}

const ROTULO = {
  aprovado: 'APROVADO (legado)',
  aprovado_sem_status: 'APROVADO (legado, sem status → ativo)',
  cancelado: 'CANCELADO (mantido)',
  nao_classificado: 'NAO CLASSIFICADO (fora do ar, nao alterado)',
  ja_migrado: 'JA MIGRADO',
};

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db(MONGODB_DB);
  const colecao = db.collection('grupos');
  const agora = new Date();

  const grupos = await colecao.find({}, { projection: { nome: 1, status: 1, moderacao: 1 } }).toArray();
  const plano = grupos.map((g) => ({ grupo: g, ...planejarMigracaoModeracao(g, agora) }));

  console.log(`Modo: ${aplicar ? 'APLICAR' : 'dry-run'}`);
  console.log(`Grupos: ${grupos.length}`);
  for (const { grupo, classe } of plano) {
    if (classe === 'ja_migrado') continue;
    console.log(`[${ROTULO[classe]}] ${grupo.nome} (${grupo._id}) status=${grupo.status ?? '—'}`);
  }

  const contagem = (c) => plano.filter((p) => p.classe === c).length;
  const alterar = plano.filter((p) => p.set !== null);
  console.log(
    `Resumo: ${alterar.length} a alterar (${contagem('aprovado')} aprovados, ${contagem('aprovado_sem_status')} sem status, ` +
    `${contagem('cancelado')} cancelados), ${contagem('nao_classificado')} nao classificados, ${contagem('ja_migrado')} ja migrados.`
  );

  if (!aplicar) {
    console.log('Dry-run concluído. Rode com --aplicar para gravar.');
    process.exit(0);
  }
  if (alterar.length === 0) {
    console.log('Nada a migrar (0 alterados).');
    process.exit(0);
  }

  let alterados = 0;
  for (const { grupo, classe, set } of alterar) {
    // Filtro com `moderacao` ausente: se outro processo já migrou, não sobrescreve.
    const resultado = await colecao.updateOne(
      { _id: grupo._id, moderacao: null }, // casa ausente ou null
      { $set: { ...set, updatedAt: new Date() } }
    );
    if (resultado.modifiedCount === 0) continue;
    alterados += 1;
    // Mesmo formato de lib/audit.js; o script não importa lib/mongodb.js.
    await db.collection('auditLogs').insertOne({
      _id: randomUUID(),
      action: 'grupo.moderacao.migrado',
      actorId: 'script:migrar-moderacao-grupos',
      actorEmail: null,
      targetId: String(grupo._id),
      targetCollection: 'grupos',
      details: { classe, statusAntes: grupo.status ?? null, statusDepois: set.status ?? grupo.status ?? null },
      ip: null,
      createdAt: new Date(),
    });
  }
  console.log(`Alterados: ${alterados} de ${alterar.length}`);
} finally {
  await client.close();
}
