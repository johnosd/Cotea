// Banco Mongo em memória COM transações (006-checkout-caucao), travado junto com os
// testes de contrato. Emula o que o checkout depende do MongoDB real:
//   - sessão com withTransaction: leituras sobre uma foto (snapshot) tirada na primeira
//     operação, escritas só visíveis após o commit, tudo descartado se o callback lançar;
//   - conflito de escrita (TransientTransactionError, com repetição automática) quando duas
//     transações escrevem o MESMO documento — transações que inserem documentos diferentes
//     NÃO conflitam (como no Mongo: sem trava explícita há write skew);
//   - escrita sem sessão espera a transação que detém o documento;
//   - índices únicos de UNICOS (E11000).
// Assim o ledger REAL (lib/ledger/servidor.js + repositorio-mongo.js) roda por cima dele.
//
// Consultas e updates usam o motor de db-grupos-memoria.js: igualdade, caminhos com ponto,
// $ne, $in, $nin, $exists, $lt, $lte, $gt, $gte; $set, $unset, $inc, $push. Sem $or,
// $and, upsert ou aggregate. findOneAndUpdate devolve sempre o documento atualizado.
import { ObjectId } from 'mongodb';
import { criarDbMemoria } from './db-grupos-memoria.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const UNICOS = {
  membrosGrupo: [['grupoId', 'userId']],
  wallets: [['userId']],
  walletTransactions: [['operacaoId', 'walletId', 'categoria', 'type']],
};

const MAX_TENTATIVAS = 200;

const clonar = (v) => {
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof ObjectId) return v;
  if (Array.isArray(v)) return v.map(clonar);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clonar(x)]));
  }
  return v;
};

const mesmoId = (a, b) => String(a) === String(b);

const conflito = () => Object.assign(new Error('WriteConflict'), {
  code: 112,
  hasErrorLabel: (rotulo) => rotulo === 'TransientTransactionError',
});

const duplicado = (nome) => Object.assign(new Error(`E11000 duplicate key error collection: ${nome}`), { code: 11000 });

export function criarBancoTransacional() {
  const base = criarDbMemoria();
  const nomes = new Set();
  const versoes = new Map(); // chave do documento -> sequência do último commit
  const travas = new Map(); // chave do documento -> sessão que o escreveu e ainda não terminou
  let sequencia = 0;

  const colBase = (nome) => { nomes.add(nome); return base.collection(nome); };
  const chaveDe = (nome, id) => `${nome}\u0000${String(id)}`;

  const violaUnico = (nome, doc, listas) => (UNICOS[nome] || []).some((campos) =>
    campos.every((c) => doc[c] !== undefined && doc[c] !== null)
    && listas.some((lista) => lista.some((d) => !mesmoId(d._id, doc._id)
      && campos.every((c) => String(d[c]) === String(doc[c])))));

  const foto = (sessao) => {
    if (!sessao.foto) {
      sessao.foto = criarDbMemoria();
      sessao.inicio = sequencia;
      for (const nome of nomes) sessao.foto.collection(nome).docs.push(...clonar(colBase(nome).docs));
    }
    return sessao.foto;
  };

  const emTransacao = (opcoes) => (opcoes?.session?.ativa ? opcoes.session : null);
  const alvo = (nome, opcoes) => {
    const sessao = emTransacao(opcoes);
    if (!sessao) return colBase(nome);
    nomes.add(nome);
    return foto(sessao).collection(nome);
  };

  const marcar = (sessao, nome, id) => {
    const chave = chaveDe(nome, id);
    const dona = travas.get(chave);
    if ((dona && dona !== sessao) || (versoes.get(chave) || 0) > sessao.inicio) throw conflito();
    travas.set(chave, sessao);
    sessao.escritas.set(chave, { nome, id });
  };

  const avancar = (nome, id) => { sequencia += 1; versoes.set(chaveDe(nome, id), sequencia); };

  /** Escrita sobre documentos existentes: `varios` = todos que casam; senão só o primeiro. */
  async function escrever(nome, filtro, opcoes, varios, aplicar) {
    await tick();
    for (;;) {
      const colecao = alvo(nome, opcoes);
      const achados = await colecao.find(filtro).toArray();
      const ids = (varios ? achados : achados.slice(0, 1)).map((d) => d._id);
      const sessao = emTransacao(opcoes);
      if (sessao) {
        ids.forEach((id) => marcar(sessao, nome, id));
        return aplicar(colecao, ids);
      }
      if (ids.some((id) => travas.has(chaveDe(nome, id)))) {
        await tick();
        continue;
      }
      const resultado = await aplicar(colecao, ids);
      ids.forEach((id) => avancar(nome, id));
      return resultado;
    }
  }

  async function inserir(nome, doc, opcoes) {
    await tick();
    if (doc._id === undefined) doc._id = new ObjectId(); // o driver real muta o documento
    const copia = clonar(doc);
    const sessao = emTransacao(opcoes);
    if (!sessao) {
      if (violaUnico(nome, copia, [colBase(nome).docs])) throw duplicado(nome);
      const resultado = await colBase(nome).insertOne(copia);
      avancar(nome, copia._id);
      return resultado;
    }
    const colecao = alvo(nome, opcoes);
    const confirmados = colBase(nome).docs;
    if (confirmados.some((d) => mesmoId(d._id, copia._id))
      || violaUnico(nome, copia, [confirmados, colecao.docs])) throw duplicado(nome);
    marcar(sessao, nome, copia._id);
    return colecao.insertOne(copia);
  }

  const colecao = (nome) => ({
    get docs() { return colBase(nome).docs; },
    async findOne(filtro, opcoes) {
      await tick();
      return alvo(nome, opcoes).findOne(filtro);
    },
    find(filtro, opcoes) {
      const estado = { sort: null, limit: 0 };
      const cursor = {
        sort(s) { estado.sort = s; return cursor; },
        limit(n) { estado.limit = n; return cursor; },
        project() { return cursor; },
        async toArray() {
          await tick();
          const c = alvo(nome, opcoes).find(filtro);
          if (estado.sort) c.sort(estado.sort);
          if (estado.limit) c.limit(estado.limit);
          return c.toArray();
        },
      };
      return cursor;
    },
    async countDocuments(filtro, opcoes) {
      await tick();
      return alvo(nome, opcoes).countDocuments(filtro);
    },
    insertOne: (doc, opcoes) => inserir(nome, doc, opcoes),
    async insertMany(docs, opcoes) {
      const insertedIds = {};
      for (let i = 0; i < docs.length; i += 1) insertedIds[i] = (await inserir(nome, docs[i], opcoes)).insertedId;
      return { insertedCount: docs.length, insertedIds };
    },
    updateOne: (filtro, update, opcoes) =>
      escrever(nome, filtro, opcoes, false, (c) => c.updateOne(filtro, update)),
    updateMany: (filtro, update, opcoes) =>
      escrever(nome, filtro, opcoes, true, (c) => c.updateMany(filtro, update)),
    findOneAndUpdate: (filtro, update, opcoes) =>
      escrever(nome, filtro, opcoes, false, (c) => c.findOneAndUpdate(filtro, update)),
    deleteOne: (filtro, opcoes) =>
      escrever(nome, filtro, opcoes, false, (c) => c.deleteOne(filtro)),
    deleteMany: (filtro, opcoes) =>
      escrever(nome, filtro, opcoes, true, (c) => c.deleteMany(filtro)),
  });

  const liberar = (sessao) => {
    for (const chave of sessao.escritas.keys()) if (travas.get(chave) === sessao) travas.delete(chave);
    sessao.escritas = new Map();
    sessao.foto = null;
    sessao.ativa = false;
  };

  const confirmar = (sessao) => {
    const escritas = [...sessao.escritas.values()].map((e) => ({
      ...e, novo: sessao.foto.collection(e.nome).docs.find((d) => mesmoId(d._id, e.id)),
    }));
    for (const { nome, novo } of escritas) {
      if (novo && violaUnico(nome, novo, [colBase(nome).docs])) throw conflito();
    }
    for (const { nome, id, novo } of escritas) {
      const lista = colBase(nome).docs;
      const i = lista.findIndex((d) => mesmoId(d._id, id));
      if (novo && i >= 0) lista[i] = clonar(novo);
      else if (novo) lista.push(clonar(novo));
      else if (i >= 0) lista.splice(i, 1);
      avancar(nome, id);
    }
  };

  const startSession = () => {
    const sessao = {
      ativa: false,
      foto: null,
      inicio: 0,
      escritas: new Map(),
      async withTransaction(fn) {
        for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa += 1) {
          sessao.ativa = true;
          try {
            const resultado = await fn(sessao);
            if (sessao.foto) confirmar(sessao);
            liberar(sessao);
            return resultado;
          } catch (erro) {
            liberar(sessao);
            if (!erro?.hasErrorLabel?.('TransientTransactionError')) throw erro;
            for (let i = 0; i <= tentativa % 5; i += 1) await tick();
          }
        }
        throw new Error('transacao: conflitos demais no banco em memoria');
      },
      async endSession() {},
    };
    return sessao;
  };

  const db = { collection: colecao };
  return { db, client: { startSession, db: () => db } };
}
