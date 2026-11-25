/**
 * setupDatabase.js - cria/atualiza colecoes com validators e indexes.
 */
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "usaComigo";

async function loadSchema(schemaName) {
  const filepath = path.join(__dirname, "schemas", schemaName);
  const data = fs.readFileSync(filepath, "utf8");
  return JSON.parse(data);
}

async function run() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log("Conectado ao MongoDB");

    const db = client.db(dbName);

    async function createCollection(name, schema) {
      const exists = await db.listCollections({ name }).toArray();
      const options = {
        validator: { $jsonSchema: schema },
        validationLevel: "moderate",
      };

      if (exists.length === 0) {
        console.log("Criando colecao:", name);
        await db.createCollection(name, options);
      } else {
        console.log("Atualizando validator:", name);
        await db.command({
          collMod: name,
          validator: { $jsonSchema: schema },
          validationLevel: "moderate",
        });
      }
    }

    // 1) Grupos
    const gruposSchema = await loadSchema("grupos.schema.json");
    await createCollection("grupos", gruposSchema);
    await db.collection("grupos").createIndex({ slug: 1 }, { unique: true });
    await db.collection("grupos").createIndex({ adminId: 1 });
    await db.collection("grupos").createIndex({ status: 1 });
    await db.collection("grupos").createIndex({ categoria: 1, status: 1 });

    // 2) Users
    const usersSchema = await loadSchema("users.schema.json");
    await createCollection("users", usersSchema);
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
    await db.collection("users").createIndex({ username: 1 }, { unique: true, sparse: true });
    // 004-cadastro-financeiro (D-02): um CPF por conta, pela impressão digital HMAC (o CPF cifrado tem IV aleatório).
    // Criar depois da migração de CPFs (scripts/migrar-cpf-usuarios.js): CPFs repetidos impedem o índice.
    await db.collection("users").createIndex({ cpfHash: 1 }, { unique: true, partialFilterExpression: { cpfHash: { $type: "string" } }, name: "cpfHash_unico" });

    // 3) Membros do grupo
    const membrosSchema = await loadSchema("membrosGrupo.schema.json");
    await createCollection("membrosGrupo", membrosSchema);
    await db.collection("membrosGrupo").createIndex({ grupoId: 1 });
    await db.collection("membrosGrupo").createIndex({ userId: 1 });
    await db.collection("membrosGrupo").createIndex({ grupoId: 1, status: 1 });
    await db.collection("membrosGrupo").createIndex({ grupoId: 1, userId: 1 }, { unique: true });
    await db.collection("membrosGrupo").createIndex({ userId: 1, status: 1 });
    await db.collection("membrosGrupo").createIndex({ grupoId: 1, papel: 1 });
    await db.collection("membrosGrupo").createIndex({ grupoId: 1, userId: 1, papel: 1 });

    // 4) Logs de acesso do grupo
    const logsSchema = await loadSchema("logsAcessoGrupo.schema.json");
    await createCollection("logsAcessoGrupo", logsSchema);
    await db.collection("logsAcessoGrupo").createIndex({ grupoId: 1, dataEvento: -1 });
    await db.collection("logsAcessoGrupo").createIndex({ userId: 1, dataEvento: -1 });

    // 5) Transacoes
    const transacoesSchema = await loadSchema("transacoes.schema.json");
    await createCollection("transacoes", transacoesSchema);
    await db.collection("transacoes").createIndex({ userId: 1, dataCriacao: -1 });
    await db.collection("transacoes").createIndex({ grupoId: 1, dataCriacao: -1 });
    await db.collection("transacoes").createIndex({ status: 1 });

    // 6) Saques
    const saquesSchema = await loadSchema("saques.schema.json");
    await createCollection("saques", saquesSchema);
    await db.collection("saques").createIndex({ userId: 1, dataSolicitacao: -1 });
    await db.collection("saques").createIndex({ status: 1 });

    // 7) Codigos de verificacao (TTL)
    const verificationSchema = await loadSchema("verificationCodes.schema.json");
    await createCollection("verificationCodes", verificationSchema);
    await db.collection("verificationCodes").createIndex({ email: 1, tipo: 1, status: 1 });
    await db.collection("verificationCodes").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    // 8) Mensagens enviadas aos membros
    const mensagensSchema = await loadSchema("mensagens.schema.json");
    await createCollection("mensagens", mensagensSchema);
    await db.collection("mensagens").createIndex({ grupoId: 1, createdAt: -1 });
    await db.collection("mensagens").createIndex({ adminId: 1, createdAt: -1 });

    // 9) Wallets
    const walletsSchema = await loadSchema("wallets.schema.json");
    await createCollection("wallets", walletsSchema);
    await db.collection("wallets").createIndex({ userId: 1 }, { unique: true });
    await db.collection("wallets").createIndex({ status: 1 });
    // Conta da plataforma (002-ledger-segmentado, D-07): userId sintetico porque
    // wallets.userId tem indice unico nao esparso.
    await db.collection("wallets").updateOne(
      { _id: "plataforma" },
      {
        $setOnInsert: {
          userId: "cotea:plataforma",
          tipo: "plataforma",
          status: "active",
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    // 10) Payments (PIX / Mercado Pago)
    const paymentsSchema = await loadSchema("payments.schema.json");
    await createCollection("payments", paymentsSchema);
    await db.collection("payments").createIndex({ userId: 1, createdAt: -1 });
    await db.collection("payments").createIndex({ status: 1 });
    await db.collection("payments").createIndex(
      { gateway: 1, externalId: 1 },
      { unique: true, partialFilterExpression: { externalId: { $type: "string" } } }
    );

    // 11) Invoices (faturas de assinatura)
    const invoicesSchema = await loadSchema("invoices.schema.json");
    await createCollection("invoices", invoicesSchema);
    await db.collection("invoices").createIndex({ userId: 1, grupoId: 1, status: 1, createdAt: -1 });
    await db.collection("invoices").createIndex({ grupoId: 1, createdAt: -1 });
    await db.collection("invoices").createIndex({ userId: 1, grupoId: 1 });

    // 11) WalletTransactions (Ledger)
    const walletTxSchema = await loadSchema("walletTransactions.schema.json");
    await createCollection("walletTransactions", walletTxSchema);
    await db.collection("walletTransactions").createIndex({ walletId: 1, createdAt: -1 });
    await db.collection("walletTransactions").createIndex({ status: 1 });
    await db.collection("walletTransactions").createIndex({ walletId: 1, type: 1, status: 1 });
    await db.collection("walletTransactions").createIndex(
      { referenceId: 1, type: 1, source: 1 },
      { unique: true, partialFilterExpression: { referenceId: { $type: "string" } } }
    );
    // 002-ledger-segmentado: idempotencia por operacao (D-05) e saldo por categoria
    await db.collection("walletTransactions").createIndex(
      { operacaoId: 1, walletId: 1, categoria: 1, type: 1 },
      { unique: true, partialFilterExpression: { operacaoId: { $type: "string" } } }
    );
    await db.collection("walletTransactions").createIndex({ walletId: 1, categoria: 1, status: 1 });

    // 12) Withdrawals
    const withdrawalsSchema = await loadSchema("withdrawals.schema.json");
    await createCollection("withdrawals", withdrawalsSchema);
    await db.collection("withdrawals").createIndex({ userId: 1, createdAt: -1 });
    await db.collection("withdrawals").createIndex({ walletId: 1 });
    await db.collection("withdrawals").createIndex({ status: 1 });

    // 13) Rotinas agendadas — itens (chave de idempotencia; SEM TTL)
    const rotinaItensSchema = await loadSchema("rotinaItens.schema.json");
    await createCollection("rotinaItens", rotinaItensSchema);
    await db.collection("rotinaItens").createIndex({ rotinaId: 1, chave: 1 }, { unique: true });
    await db.collection("rotinaItens").createIndex({ rotinaId: 1, situacao: 1, atualizadoEm: -1 });

    // 14) Rotinas agendadas — execucoes (historico com TTL de 90 dias)
    const rotinaExecucoesSchema = await loadSchema("rotinaExecucoes.schema.json");
    await createCollection("rotinaExecucoes", rotinaExecucoesSchema);
    await db.collection("rotinaExecucoes").createIndex({ rotinaId: 1, inicio: -1 });
    await db.collection("rotinaExecucoes").createIndex({ inicio: 1 }, { expireAfterSeconds: 7776000 });

    // 15) Calendario — datas extras nao uteis (_id = 'YYYY-MM-DD')
    const calendarioSchema = await loadSchema("calendarioDatasExtras.schema.json");
    await createCollection("calendarioDatasExtras", calendarioSchema);

    // 16) Rotina de saude — sondas de teste (TTL de 7 dias)
    const sondasSchema = await loadSchema("rotinaSaudeSondas.schema.json");
    await createCollection("rotinaSaudeSondas", sondasSchema);
    await db.collection("rotinaSaudeSondas").createIndex({ criadoEm: 1 }, { expireAfterSeconds: 604800 });

    // 17) Indices de colecoes sem validator aqui (espelham setup-indexes.js; B-09).
    // rateLimits tambem e criada em runtime por lib/ratelimit.js (mesmas opcoes).
    await db.collection("rateLimits").createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection("notificacoesUsuario").createIndex({ userId: 1, lido: 1 });
    await db.collection("auditLogs").createIndex({ createdAt: -1 });

    console.log("\nBanco configurado com sucesso!");
  } catch (error) {
    console.error("Erro:", error);
  } finally {
    await client.close();
  }
}

run();
