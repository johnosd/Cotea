// Banco Mongo em memória mínimo para testar handlers de grupo/cobrança
// (003-preco-por-vaga). Suporta só o que esses handlers usam: igualdade
// (ObjectId inclusive), $ne, $in, $exists, e $set em updates.
import { ObjectId } from 'mongodb';

const igual = (a, b) => {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  return a === b;
};

const casaValor = (valor, condicao) => {
  if (condicao && typeof condicao === 'object' && !(condicao instanceof ObjectId) && !(condicao instanceof Date)) {
    return Object.entries(condicao).every(([op, alvo]) => {
      if (op === '$ne') return !igual(valor, alvo);
      if (op === '$in') return alvo.some((x) => igual(valor, x));
      if (op === '$exists') return (valor !== undefined) === Boolean(alvo);
      throw new Error(`operador nao suportado no fake: ${op}`);
    });
  }
  return igual(valor, condicao);
};

const casa = (doc, filtro = {}) => Object.entries(filtro).every(([campo, condicao]) => casaValor(doc[campo], condicao));

function criarColecao(nome) {
  const docs = [];
  return {
    nome,
    docs,
    async findOne(filtro) {
      const doc = docs.find((d) => casa(d, filtro));
      return doc ? { ...doc } : null; // cópia, como o driver real
    },
    find(filtro) {
      return { toArray: async () => docs.filter((d) => casa(d, filtro)).map((d) => ({ ...d })) };
    },
    async insertOne(doc) {
      const comId = { _id: doc._id ?? new ObjectId(), ...doc };
      docs.push(comId);
      return { insertedId: comId._id };
    },
    async updateOne(filtro, update) {
      const doc = docs.find((d) => casa(d, filtro));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async findOneAndUpdate(filtro, update) {
      const doc = docs.find((d) => casa(d, filtro));
      if (!doc) return null;
      Object.assign(doc, update.$set || {});
      return { ...doc };
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
