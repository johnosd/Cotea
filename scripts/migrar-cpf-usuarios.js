/**
 * Migração dos CPFs existentes para o cadastro financeiro
 * (feature 004-cadastro-financeiro, US6, FR-020, D-10).
 *
 * USO (de J:\Cotea):
 *   node --env-file=.env.local scripts/migrar-cpf-usuarios.js            # dry-run (padrão)
 *   node --env-file=.env.local scripts/migrar-cpf-usuarios.js --aplicar  # grava
 *
 * - CPF válido em texto puro → gravado cifrado (encryptCPF) + cpfHash.
 * - CPF válido já cifrado sem cpfHash (ou com hash divergente) → define cpfHash.
 * - CPF que não passa no dígito verificador → movido (cifrado) para
 *   cpfLegadoInvalido e removido de cpf/cpfHash: conta como ausente e o usuário
 *   informa um CPF válido no perfil.
 * - CPF repetido entre contas → só reportado; com qualquer conflito o modo
 *   --aplicar NÃO grava nada (sai com código 2) até o tratamento manual.
 * - Idempotente: reexecutar após aplicar mostra 0 ações.
 * - Uma entrada user.cpf_migrado em auditLogs por usuário alterado (sem CPF).
 * - Nunca imprime CPF nem valores de variáveis de ambiente.
 *
 * Ordem de implantação: dry-run → --aplicar → dry-run (0 ações) →
 * node database/setupDatabase.js (cria o índice único cpfHash_unico) → deploy.
 */

import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { planejarMigracaoCpf, somenteDigitosCpf } from '../lib/cadastro-financeiro.js';
import { decryptCPF, encryptCPF, hashCPF } from '../lib/encryption.js';

const aplicar = process.argv.includes('--aplicar');

const { MONGODB_URI, MONGODB_DB, ENCRYPTION_KEY } = process.env;
if (!MONGODB_URI || !MONGODB_DB || !ENCRYPTION_KEY) {
  console.error('Defina MONGODB_URI, MONGODB_DB e ENCRYPTION_KEY no .env.local');
  process.exit(1);
}

const ehCifrado = (valor) => String(valor || '').split(':').length === 3;

function cpfClaro(valor) {
  if (!valor) return '';
  const avisoOriginal = console.warn;
  console.warn = () => {}; // decryptCPF avisa sobre texto puro; o relatório já conta esses casos
  try {
    return somenteDigitosCpf(decryptCPF(valor) || '');
  } catch {
    return '';
  } finally {
    console.warn = avisoOriginal;
  }
}

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db(MONGODB_DB);
  const usuarios = db.collection('users');

  const docs = await usuarios.find({}, { projection: { cpf: 1, cpfHash: 1 } }).toArray();
  const entrada = docs.map((d) => ({ _id: d._id, cpfClaro: cpfClaro(d.cpf), cpfCifrado: ehCifrado(d.cpf), cpfHash: d.cpfHash }));
  const porId = new Map(docs.map((d) => [String(d._id), d]));
  const claroPorId = new Map(entrada.map((e) => [String(e._id), e.cpfClaro]));
  const plano = planejarMigracaoCpf(entrada, { hash: hashCPF });

  console.log(`Modo: ${aplicar ? 'APLICAR' : 'dry-run'}`);
  for (const acao of plano.acoes) console.log(`[${acao.tipo.toUpperCase()}] usuario ${acao._id}`);
  for (const conflito of plano.conflitos) console.log(`[CONFLITO] mesmo CPF nas contas: ${conflito.ids.join(', ')}`);
  console.log('Resumo:', JSON.stringify(plano.resumo));

  if (plano.conflitos.length > 0) {
    console.error('Ha CPFs repetidos entre contas. Trate manualmente antes de aplicar e antes de criar o indice cpfHash_unico.');
    process.exit(2);
  }
  if (!aplicar) {
    console.log('Dry-run concluido. Rode com --aplicar para gravar.');
    process.exit(0);
  }
  if (plano.acoes.length === 0) {
    console.log('Nada a migrar (0 acoes).');
    process.exit(0);
  }

  let alterados = 0;
  for (const acao of plano.acoes) {
    const id = String(acao._id);
    const claro = claroPorId.get(id);
    const original = porId.get(id).cpf;
    let update;
    if (acao.tipo === 'criptografar') {
      update = { $set: { cpf: encryptCPF(claro), cpfHash: hashCPF(claro) } };
    } else if (acao.tipo === 'definir_hash') {
      update = { $set: { cpfHash: hashCPF(claro) } };
    } else {
      update = {
        $set: { cpfLegadoInvalido: ehCifrado(original) ? original : encryptCPF(claro) },
        $unset: { cpf: '', cpfHash: '' },
      };
    }
    const resultado = await usuarios.updateOne({ _id: acao._id }, update);
    alterados += resultado.modifiedCount;
    // Mesmo formato de lib/audit.js; o script não importa lib/mongodb.js.
    await db.collection('auditLogs').insertOne({
      _id: randomUUID(),
      action: 'user.cpf_migrado',
      actorId: 'script:migrar-cpf-usuarios',
      actorEmail: null,
      targetId: id,
      targetCollection: 'users',
      details: { tipo: acao.tipo },
      ip: null,
      createdAt: new Date(),
    });
  }
  console.log(`Alterados: ${alterados} de ${plano.acoes.length}`);
} finally {
  await client.close();
}
