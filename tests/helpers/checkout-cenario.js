// Cenário compartilhado dos testes do checkout v2 (006-checkout-caucao). NÃO é travado.
// Usa o banco transacional em memória (travado) com o ledger real por cima. Cada arquivo de
// teste faz os próprios vi.mock (são içados) e passa o `estado` de vi.hoisted:
//
//   const estado = vi.hoisted(() => ({ banco: null, session: null }));
//   vi.mock('../../lib/mongodb', async () => (await import('../helpers/checkout-cenario.js')).mongoFalso(estado));
import { ObjectId } from 'mongodb';
import { criarRes } from './db-grupos-memoria.js';

export const mongoFalso = (estado) => ({
  default: Promise.resolve({
    db: () => estado.banco.db,
    startSession: () => estado.banco.client.startSession(),
  }),
  getDb: async () => estado.banco.db,
  getClient: async () => estado.banco.client,
  getWalletByUser: async (userId) => estado.banco.db.collection('wallets').findOne({ userId }),
  createWallet: async ({ userId }) => {
    const carteira = { _id: `w-${userId}`, userId, status: 'active' };
    await estado.banco.db.collection('wallets').insertOne(carteira);
    return carteira;
  },
});

export const sessao = (id, extra = {}) => ({
  user: { id: String(id), email: `${id}@teste`, systemRole: 'user', contaValidada: true, isBlocked: false, ...extra },
});

export const chamar = async (handler, req = {}) => {
  const res = criarRes();
  await handler({ method: 'POST', headers: {}, socket: {}, query: {}, body: {}, ...req }, res);
  return res;
};

/** Funções de semeadura e inspeção sobre `estado.banco`. `calcularResumo` é o do ledger real. */
export function criarCenario(estado, { calcularResumo }) {
  const docs = (nome) => estado.banco.db.collection(nome).docs;
  const donoId = new ObjectId();
  let semente = 0;
  let chaves = 0;

  const creditar = (userId, valor) => {
    semente += 1;
    docs('walletTransactions').push({
      _id: `semente-${semente}`, walletId: `w-${userId}`, type: 'credit', amount: valor, status: 'confirmed',
      source: 'pix', referenceId: null, categoria: 'pessoal', organizacaoId: null, grupoId: null,
      participacaoId: null, operacaoId: `semente:${semente}`, pernasTotal: 1, createdAt: new Date(),
    });
  };

  const semearUsuario = (saldo = 0, userId = new ObjectId()) => {
    docs('users').push({ _id: userId, nome: 'Pessoa', email: `${userId}@teste`, contaValidada: true });
    docs('wallets').push({ _id: `w-${userId}`, userId: String(userId), status: 'active' });
    if (saldo > 0) creditar(userId, saldo);
    return userId;
  };

  /** Grupo aprovado, mensalidade R$ 10,50. `comDono: false` omite o membro do dono. */
  const semearGrupo = ({ capacidade = 4, acesso = 'imediato', comDono = true, ...campos } = {}) => {
    const _id = new ObjectId();
    docs('grupos').push({
      _id, nome: 'Grupo', slug: `grupo-${_id}`, status: 'ativo', statusDetalhado: 'em_formacao', acesso,
      capacidadeTotal: capacidade, valorTotal: 10 * capacidade, valorPorVaga: 10.5, repassePorVaga: 10,
      taxaPorVaga: 0.5, precoValido: true, adminId: donoId, adminIdString: String(donoId),
      admin: { userId: donoId },
      moderacao: { envio: 1, enviadoEm: new Date('2026-11-20T13:00:00Z'), revisaoPendente: false, ultimaDecisao: null, historico: [] },
      ...campos,
    });
    if (comDono) {
      docs('membrosGrupo').push({
        _id: new ObjectId(), grupoId: _id, userId: donoId, papel: 'admin', status: 'ativo',
        temCaucao: false, aguardandoEnvioAcesso: false,
      });
    }
    return _id;
  };

  const semearMembro = (grupoId, campos = {}) => {
    const membro = {
      _id: new ObjectId(), grupoId, userId: new ObjectId(), papel: 'membro', status: 'ativo',
      temCaucao: false, aguardandoEnvioAcesso: true, ...campos,
    };
    docs('membrosGrupo').push(membro);
    return membro;
  };

  const carteira = (userId) => calcularResumo(docs('walletTransactions').filter((l) => l.walletId === `w-${userId}`));

  /** Corpo do pay montado a partir do GET de resumo, como a tela faz. */
  const corpoDeEntrada = async (handlerResumo, userId, grupoId) => {
    const r = await chamar(handlerResumo, { method: 'GET', query: { grupoId: String(grupoId) }, sessao: sessao(userId) });
    if (r.statusCode !== 200) throw new Error(`resumo ${r.statusCode}: ${JSON.stringify(r.body)}`);
    chaves += 1;
    const { resumo } = r.body;
    return {
      grupoId: String(grupoId), chave: `chave-teste-${chaves}`, vinculo: 'conhecido',
      aceiteRegras: { versao: resumo.regras.versao }, versaoResumo: resumo.versaoResumo,
      saldoVisto: resumo.saldoDisponivel,
    };
  };

  return {
    docs,
    donoId,
    creditar,
    semearUsuario,
    semearGrupo,
    semearMembro,
    carteira,
    corpoDeEntrada,
    participacao: (grupoId, userId) => docs('membrosGrupo')
      .find((m) => String(m.grupoId) === String(grupoId) && String(m.userId) === String(userId)),
    membrosNaoDono: (grupoId) => docs('membrosGrupo')
      .filter((m) => String(m.grupoId) === String(grupoId) && m.papel !== 'admin'),
    grupo: (grupoId) => docs('grupos').find((g) => String(g._id) === String(grupoId)),
    debitos: () => docs('walletTransactions').filter((l) => l.type === 'debit'),
  };
}
