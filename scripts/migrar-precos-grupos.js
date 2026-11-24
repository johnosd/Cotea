/**
 * Migração única dos preços dos grupos para a regra única de preço por vaga
 * (feature 003-preco-por-vaga, D-10 / FR-015).
 *
 * USO (de J:\Cotea):
 *   node --env-file=.env.local scripts/migrar-precos-grupos.js            # dry-run (padrão)
 *   node --env-file=.env.local scripts/migrar-precos-grupos.js --aplicar  # grava
 *
 * - Recalcula valorPorVaga, repassePorVaga e taxaPorVaga a partir de valorTotal
 *   e capacidadeTotal (lib/preco.js) e marca precoValido: true.
 * - Grupos que não permitem aplicar a regra (capacidade < 2, valor total
 *   inválido, repasse < R$ 0,01) ficam com precoValido: false; nenhum valor é
 *   inventado. Aparecem no relatório com o motivo.
 * - vagasReservadasAdmin vira 1 (vaga do dono) em todos.
 * - Idempotente: reexecutar não altera nada (0 alterados).
 * - Não toca invoices, payments, membrosGrupo nem walletTransactions.
 * - Uma entrada grupo.preco_migrado em auditLogs por grupo alterado.
 * - Não imprime valores de variáveis de ambiente.
 *
 * Ordem de implantação: migrar → deploy do código → migrar de novo (pega
 * grupos criados pelo código antigo na janela).
 */

import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { planejarMigracaoPrecos } from '../lib/preco.js';

const aplicar = process.argv.includes('--aplicar');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;
if (!MONGODB_URI || !MONGODB_DB) {
  console.error('Defina MONGODB_URI e MONGODB_DB no .env.local');
  process.exit(1);
}

const CAMPOS = ['valorTotal', 'capacidadeTotal', 'valorPorVaga', 'repassePorVaga', 'taxaPorVaga', 'precoValido', 'vagasReservadasAdmin'];
const resumo = (doc) => Object.fromEntries(CAMPOS.map((c) => [c, doc[c] ?? null]));
const reais = (v) => (v == null ? '—' : Number(v).toFixed(2));

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db(MONGODB_DB);
  const colecao = db.collection('grupos');

  const grupos = await colecao
    .find({}, { projection: { nome: 1, ...Object.fromEntries(CAMPOS.map((c) => [c, 1])) } })
    .toArray();
  const plano = planejarMigracaoPrecos(grupos);
  const porId = new Map(grupos.map((g) => [String(g._id), g]));

  console.log(`Modo: ${aplicar ? 'APLICAR' : 'dry-run'}`);
  console.log(`Grupos: ${grupos.length}`);

  const alterar = plano.filter((p) => p.set !== null);
  const inalterados = plano.filter((p) => p.acao === 'inalterado').length;
  const invalidos = plano.filter((p) => p.acao === 'invalido');

  for (const item of plano) {
    const g = porId.get(String(item._id));
    if (item.acao === 'atualizar') {
      console.log(
        `[ATUALIZAR] ${g.nome} (${item._id}): T=${reais(g.valorTotal)} C=${g.capacidadeTotal} | ` +
        `valorPorVaga ${reais(g.valorPorVaga)} -> ${reais(item.set.valorPorVaga)} | ` +
        `repasse ${reais(g.repassePorVaga)} -> ${reais(item.set.repassePorVaga)} | ` +
        `taxa ${reais(g.taxaPorVaga)} -> ${reais(item.set.taxaPorVaga)}` +
        (Number(g.vagasReservadasAdmin) !== 1 ? ` | reservadas ${g.vagasReservadasAdmin ?? '—'} -> 1` : '')
      );
    } else if (item.acao === 'invalido') {
      console.log(
        `[INVALIDO] ${g.nome} (${item._id}): T=${reais(g.valorTotal)} C=${g.capacidadeTotal ?? '—'} | motivo: ${item.motivo}` +
        (item.set ? ' | sera marcado precoValido=false' : ' | ja marcado')
      );
    }
  }
  console.log(`Resumo: ${alterar.length} a alterar, ${inalterados} inalterados, ${invalidos.length} invalidos.`);

  if (!aplicar) {
    console.log('Dry-run concluído. Rode com --aplicar para gravar.');
    process.exit(0);
  }

  if (alterar.length === 0) {
    console.log('Nada a migrar (0 alterados).');
    process.exit(0);
  }

  let alterados = 0;
  for (const item of alterar) {
    const antes = porId.get(String(item._id));
    const resultado = await colecao.updateOne({ _id: item._id }, { $set: { ...item.set, updatedAt: new Date() } });
    alterados += resultado.modifiedCount;
    // Mesmo formato de lib/audit.js; o script não importa lib/mongodb.js.
    await db.collection('auditLogs').insertOne({
      _id: randomUUID(),
      action: 'grupo.preco_migrado',
      actorId: 'script:migrar-precos-grupos',
      actorEmail: null,
      targetId: String(item._id),
      targetCollection: 'grupos',
      details: { acao: item.acao, antes: resumo(antes), depois: { ...resumo(antes), ...item.set } },
      ip: null,
      createdAt: new Date(),
    });
  }
  console.log(`Alterados: ${alterados} de ${alterar.length}`);
} finally {
  await client.close();
}
