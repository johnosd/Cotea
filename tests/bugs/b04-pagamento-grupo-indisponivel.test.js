// Regressão B-04: nada fica cobrado quando a entrada é impossível. Reescrito na
// 006-checkout-caucao (T014): cobrança e entrada viraram uma única operação, então a
// compensação por estorno deu lugar a "recusa sem efeito" — antes e DENTRO da transação.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarBancoTransacional } from '../helpers/db-transacional-memoria.js';
import { chamar, criarCenario, sessao } from '../helpers/checkout-cenario.js';

const estado = vi.hoisted(() => ({ banco: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async (req) => req?.sessao ?? estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/mongodb', async () => (await import('../helpers/checkout-cenario.js')).mongoFalso(estado));
// 004-cadastro-financeiro: o gate é testado em tests/cadastro e no contrato 004.
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({
  verificarCadastroFinanceiro: vi.fn(async () => ({ ok: true, cpf: '52998224725', usuario: {} })),
}));

const { calcularResumo } = await import('../../lib/ledger/ledger.js');
const { default: handlerPay } = await import('../../pages/api/assinaturas/pay.js');
const { default: handlerResumo } = await import('../../pages/api/assinaturas/resumo.js');

const c = criarCenario(estado, { calcularResumo });
let membroId;

beforeEach(() => {
  estado.banco = criarBancoTransacional();
  membroId = c.semearUsuario(100);
  estado.session = sessao(membroId);
});

const pagar = (body) => chamar(handlerPay, { body });
const corpo = (grupoId) => c.corpoDeEntrada(handlerResumo, membroId, grupoId);
const semNadaCobrado = () => {
  expect(c.docs('invoices')).toHaveLength(0);
  expect(c.debitos()).toHaveLength(0);
};

describe('POST /api/assinaturas/pay — não cobra quando a entrada é impossível (B-04)', () => {
  it.each(['inativo', 'cancelado', 'em_aprovacao'])('grupo %s: 409 grupo_indisponivel, sem fatura nem débito', async (status) => {
    const grupoId = c.semearGrupo({ status });
    const res = await pagar({ grupoId: String(grupoId), invoiceId: 'fatura-antiga' });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('grupo_indisponivel');
    semNadaCobrado();
  });

  it('grupo cheio: 409 grupo_cheio, sem fatura nem débito', async () => {
    const grupoId = c.semearGrupo({ capacidade: 3 });
    c.semearMembro(grupoId);
    c.semearMembro(grupoId);
    const res = await pagar({ grupoId: String(grupoId) });
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe('grupo_cheio');
    semNadaCobrado();
  });

  it('banidos não ocupam vaga: grupo com banido ainda aceita a entrada', async () => {
    const grupoId = c.semearGrupo({ capacidade: 2 });
    c.semearMembro(grupoId, { status: 'banido' });
    const res = await pagar(await corpo(grupoId));
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('paga');
  });

  it('dono do grupo: 409 dono_do_grupo (por adminId ou pelo papel admin)', async () => {
    const proprio = c.semearGrupo({ adminId: membroId });
    expect((await pagar({ grupoId: String(proprio) })).body.codigo).toBe('dono_do_grupo');
    const porPapel = c.semearGrupo({ adminId: undefined, comDono: false });
    c.semearMembro(porPapel, { userId: membroId, papel: 'admin' });
    expect((await pagar({ grupoId: String(porPapel) })).body.codigo).toBe('dono_do_grupo');
    semNadaCobrado();
  });

  it('já membro: 409 ja_membro; banido: 403 membro_banido', async () => {
    const meu = c.semearGrupo();
    c.semearMembro(meu, { userId: membroId });
    const ja = await pagar({ grupoId: String(meu) });
    expect([ja.statusCode, ja.body.codigo]).toEqual([409, 'ja_membro']);
    const banido = c.semearGrupo();
    c.semearMembro(banido, { userId: membroId, status: 'banido' });
    const res = await pagar({ grupoId: String(banido) });
    expect([res.statusCode, res.body.codigo]).toEqual([403, 'membro_banido']);
    semNadaCobrado();
  });

  it('grupo inexistente: 404; status ausente (legado) aceita a entrada', async () => {
    expect((await pagar({ grupoId: String(new ObjectId()) })).statusCode).toBe(404);
    const legado = c.semearGrupo({ status: undefined });
    expect((await pagar(await corpo(legado))).statusCode).toBe(200);
  });

  // A checagem que vale é a de dentro da transação: o grupo muda depois da pré-checagem.
  it.each([
    ['cancelado', (grupoId) => { c.grupo(grupoId).status = 'cancelado'; }, 'grupo_indisponivel'],
    ['lotado', (grupoId) => { c.semearMembro(grupoId); }, 'grupo_cheio'],
    ['com preço novo', (grupoId) => { Object.assign(c.grupo(grupoId), { valorPorVaga: 21, repassePorVaga: 20, taxaPorVaga: 1 }); }, 'resumo_desatualizado'],
  ])('grupo %s entre a pré-checagem e a transação: recusa e nada é cobrado', async (_rotulo, mudar, codigo) => {
    const grupoId = c.semearGrupo({ capacidade: 2 });
    const pedido = await corpo(grupoId);
    const colecao = estado.banco.db.collection.bind(estado.banco.db);
    let mudou = false;
    vi.spyOn(estado.banco.db, 'collection').mockImplementation((nome) => {
      const original = colecao(nome);
      if (nome !== 'wallets') return original;
      // A trava da carteira é a primeira operação da transação do ledger.
      return {
        ...original,
        get docs() { return original.docs; },
        findOne: original.findOne,
        updateOne: (...args) => {
          if (!mudou) { mudou = true; mudar(grupoId); }
          return original.updateOne(...args);
        },
      };
    });

    const res = await pagar(pedido);
    expect(mudou).toBe(true);
    expect(res.statusCode).toBe(409);
    expect(res.body.codigo).toBe(codigo);
    semNadaCobrado();
    expect(c.participacao(grupoId, membroId)).toBeUndefined();
  });
});
