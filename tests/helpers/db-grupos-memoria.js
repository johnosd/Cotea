// Banco Mongo em memória mínimo para testar handlers de grupo/cobrança
// (003-preco-por-vaga; estendido em 005-aprovacao-grupos). Suporta só o que
// esses handlers usam: igualdade (ObjectId e Date inclusive), caminhos com ponto
// ('moderacao.envio'), $ne, $in, $nin, $exists, $lt, $lte, $gt, $gte; updates com
// $set, $unset, $inc e $push ($each/$slice); _id duplicado em insert lança
// { code: 11000 }, como o driver real. find() aceita sort/limit/project encadeados
// (sort/limit aplicados; projeção ignorada).
import { ObjectId } from 'mongodb';

const igual = (a, b) => {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
};

const ler = (doc, caminho) => caminho.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);

const gravar = (doc, caminho, valor) => {
  const partes = caminho.split('.');
  let alvo = doc;
  for (const k of partes.slice(0, -1)) {
    if (alvo[k] == null || typeof alvo[k] !== 'object') alvo[k] = {};
    alvo = alvo[k];
  }
  alvo[partes[partes.length - 1]] = valor;
};

const remover = (doc, caminho) => {
  const partes = caminho.split('.');
  const pai = partes.length > 1 ? ler(doc, partes.slice(0, -1).join('.')) : doc;
  if (pai && typeof pai === 'object') delete pai[partes[partes.length - 1]];
};

const num = (v) => (v instanceof Date ? v.getTime() : v);

const casaValor = (valor, condicao) => {
  if (condicao && typeof condicao === 'object' && !(condicao instanceof ObjectId) && !(condicao instanceof Date)) {
    return Object.entries(condicao).every(([op, alvo]) => {
      if (op === '$ne') return !igual(valor, alvo);
      if (op === '$in') return alvo.some((x) => igual(valor, x));
      if (op === '$nin') return !alvo.some((x) => igual(valor, x));
      if (op === '$exists') return (valor !== undefined) === Boolean(alvo);
      if (op === '$lt') return valor != null && num(valor) < num(alvo);
      if (op === '$lte') return valor != null && num(valor) <= num(alvo);
      if (op === '$gt') return valor != null && num(valor) > num(alvo);
      if (op === '$gte') return valor != null && num(valor) >= num(alvo);
      throw new Error(`operador nao suportado no fake: ${op}`);
    });
  }
  return igual(valor, condicao);
};

const casa = (doc, filtro = {}) => Object.entries(filtro).every(([campo, condicao]) => casaValor(ler(doc, campo), condicao));

// Cópia profunda que preserva ObjectId e Date (structuredClone perderia o protótipo do ObjectId).
const clonar = (v) => {
  if (v instanceof ObjectId || v instanceof Date) return v instanceof Date ? new Date(v.getTime()) : v;
  if (Array.isArray(v)) return v.map(clonar);
  // Só objetos simples são copiados; instâncias (Int32, Decimal128...) seguem como estão.
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clonar(x)]));
  return v;
};

const aplicarUpdate = (doc, update = {}) => {
  const ops = Object.keys(update);
  const desconhecido = ops.find((op) => !['$set', '$unset', '$inc', '$push'].includes(op));
  if (desconhecido) throw new Error(`operador de update nao suportado no fake: ${desconhecido}`);
  for (const [c, v] of Object.entries(update.$set || {})) gravar(doc, c, v);
  for (const c of Object.keys(update.$unset || {})) remover(doc, c);
  for (const [c, v] of Object.entries(update.$inc || {})) gravar(doc, c, (ler(doc, c) || 0) + v);
  for (const [c, v] of Object.entries(update.$push || {})) {
    const atual = Array.isArray(ler(doc, c)) ? ler(doc, c) : [];
    const novos = v && typeof v === 'object' && Array.isArray(v.$each) ? v.$each : [v];
    let lista = [...atual, ...novos];
    if (v && typeof v === 'object' && Number.isInteger(v.$slice)) {
      lista = v.$slice < 0 ? lista.slice(v.$slice) : lista.slice(0, v.$slice);
    }
    gravar(doc, c, lista);
  }
};

const ordenar = (lista, sort) => {
  if (!sort) return lista;
  const chaves = Object.entries(sort);
  return [...lista].sort((a, b) => {
    for (const [c, dir] of chaves) {
      const va = num(ler(a, c));
      const vb = num(ler(b, c));
      if (va === vb) continue;
      if (va == null) return -dir;
      if (vb == null) return dir;
      return va < vb ? -dir : dir;
    }
    return 0;
  });
};

function criarColecao(nome) {
  const docs = [];
  const duplicado = (id) => docs.some((d) => igual(d._id, id));
  const erroDuplicado = () => Object.assign(new Error(`E11000 duplicate key error collection: ${nome}`), { code: 11000 });

  return {
    nome,
    docs,
    async findOne(filtro) {
      const doc = docs.find((d) => casa(d, filtro));
      return doc ? clonar(doc) : null; // cópia, como o driver real
    },
    find(filtro) {
      const estado = { sort: null, limit: 0 };
      const cursor = {
        sort(s) { estado.sort = s; return cursor; },
        limit(n) { estado.limit = n; return cursor; },
        project() { return cursor; },
        async toArray() {
          let lista = ordenar(docs.filter((d) => casa(d, filtro)), estado.sort);
          if (estado.limit > 0) lista = lista.slice(0, estado.limit);
          return lista.map(clonar);
        },
      };
      return cursor;
    },
    async insertOne(doc) {
      const comId = { _id: doc._id ?? new ObjectId(), ...doc };
      if (duplicado(comId._id)) throw erroDuplicado();
      docs.push(comId);
      return { insertedId: comId._id };
    },
    async insertMany(lista, { ordered = true } = {}) {
      const insertedIds = {};
      let erro = null;
      lista.forEach((doc, i) => {
        if (erro && ordered) return;
        const comId = { _id: doc._id ?? new ObjectId(), ...doc };
        if (duplicado(comId._id)) { erro = erro || erroDuplicado(); return; }
        docs.push(comId);
        insertedIds[i] = comId._id;
      });
      if (erro) throw erro;
      return { insertedCount: Object.keys(insertedIds).length, insertedIds };
    },
    async updateOne(filtro, update) {
      const doc = docs.find((d) => casa(d, filtro));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      aplicarUpdate(doc, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(filtro, update) {
      const alvo = docs.filter((d) => casa(d, filtro));
      alvo.forEach((d) => aplicarUpdate(d, update));
      return { matchedCount: alvo.length, modifiedCount: alvo.length };
    },
    async findOneAndUpdate(filtro, update) {
      const doc = docs.find((d) => casa(d, filtro));
      if (!doc) return null;
      aplicarUpdate(doc, update);
      return clonar(doc); // driver v6: devolve o documento (returnDocument 'after' assumido)
    },
    async countDocuments(filtro) {
      return docs.filter((d) => casa(d, filtro)).length;
    },
    async deleteOne(filtro) {
      const i = docs.findIndex((d) => casa(d, filtro));
      if (i < 0) return { deletedCount: 0 };
      docs.splice(i, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(filtro) {
      let n = 0;
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        if (casa(docs[i], filtro)) { docs.splice(i, 1); n += 1; }
      }
      return { deletedCount: n };
    },
  };
}

export function criarDbMemoria() {
  const colecoes = new Map();
  return {
    collection(nome) {
      if (!colecoes.has(nome)) colecoes.set(nome, criarColecao(nome));
      return colecoes.get(nome);
    },
  };
}

/** Resposta Next.js fake: guarda status e corpo JSON. */
export function criarRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(codigo) { res.statusCode = codigo; return res; },
    json(corpo) { res.body = corpo; return res; },
    end(corpo) { res.body = corpo; return res; },
    setHeader(nome, valor) { res.headers[nome] = valor; },
  };
  return res;
}
