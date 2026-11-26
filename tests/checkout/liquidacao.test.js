// Devolução em toda saída (006-checkout-caucao, T023 — FR-021, FR-022, SC-004): exclusão,
// remoção pelo staff, encerramento pelo dono, falhas, rotina e concorrência.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarBancoTransacional } from '../helpers/db-transacional-memoria.js';
import { chamar, criarCenario, sessao } from '../helpers/checkout-cenario.js';

const estado = vi.hoisted(() => ({ banco: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async (req) => req?.sessao ?? estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/r2', () => ({ deleteFromR2: vi.fn(), hasR2Config: () => false }));
vi.mock('../../lib/mongodb', async () => (await import('../helpers/checkout-cenario.js')).mongoFalso(estado));
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({
  verificarCadastroFinanceiro: vi.fn(async () => ({ ok: true, cpf: '52998224725', usuario: {} })),
}));

const { calcularResumo } = await import('../../lib/ledger/ledger.js');
const { logAudit } = await import('../../lib/audit');
const { default: handlerPay } = await import('../../pages/api/assinaturas/pay.js');
const { default: handlerResumo } = await import('../../pages/api/assinaturas/resumo.js');
const { default: handlerJoin } = await import('../../pages/api/grupos/[id]/join.js');
const { default: handlerGrupo } = await import('../../pages/api/grupos/[id].js');
const { default: handlerDono } = await import('../../pages/api/grupos/[id]/moderacao.js');
const { default: handlerAdmin } = await import('../../pages/api/admin/grupos/[id]/moderacao.js');
const { listarRotinas } = await import('../../lib/rotinas/registro.js');
const { liquidarParticipacoesDoGrupo } = await import('../../lib/checkout-servidor.js');

const c = criarCenario(estado, { calcularResumo });
const adminSistema = new ObjectId();
const rotina = () => listarRotinas().find((r) => r.id === 'liquidacao-participacoes');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  logAudit.mockClear();
  estado.banco = criarBancoTransacional();
  estado.session = null;
});

const entrar = async (grupoId, userId = c.semearUsuario(30)) => {
  estado.session = sessao(userId);
  const res = await chamar(handlerPay, { body: await c.corpoDeEntrada(handlerResumo, userId, grupoId) });
  expect(res.statusCode).toBe(200);
  return userId;
};
const sair = (grupoId, userId, quem = sessao(userId)) => chamar(handlerJoin, {
  method: 'DELETE', query: { id: String(grupoId) }, body: { userId: String(userId) }, sessao: quem,
});
const excluir = (grupoId) => chamar(handlerGrupo, {
  method: 'DELETE', query: { id: String(grupoId) }, sessao: sessao(c.donoId),
});
const cancelarPeloCotea = (grupoId) => chamar(handlerAdmin, {
  query: { id: String(grupoId) }, body: { acao: 'cancelar', texto: 'Fraude' },
  sessao: sessao(adminSistema, { systemRole: 'admin' }),
});
const rodarRotina = async () => {
  const itens = await rotina().buscarVencidos({ contexto: { db: estado.banco.db } });
  const resultados = [];
  for (const item of itens) {
    resultados.push(await rotina().processarItem({ dados: item.dados, contexto: { db: estado.banco.db } }));
  }
  return { itens: itens.map((i) => i.chave), resultados };
};
const liquidacoes = () => c.docs('walletTransactions').filter((l) => l.source === 'liquidacao_participacao');
const semCaucaoPresa = (userId) => {
  expect(c.carteira(userId).categorias.caucao.valor).toBe(0);
};

/** Faz a gravação do ledger falhar enquanto `quando(docs)` for verdadeiro. */
const quebrarLedger = (quando) => {
  const colecao = estado.banco.db.collection.bind(estado.banco.db);
  return vi.spyOn(estado.banco.db, 'collection').mockImplementation((nome) => {
    const original = colecao(nome);
    if (nome !== 'walletTransactions') return original;
    return {
      ...original,
      get docs() { return original.docs; },
      insertMany: (docs, opcoes) => {
        if (quando(docs)) throw new Error('falha forcada no ledger');
        return original.insertMany(docs, opcoes);
      },
    };
  });
};

describe('exclusão do grupo', () => {
  it('devolve a caução, remove os membros e registra o motivo', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    const antigo = c.semearMembro(grupoId);
    expect((await excluir(grupoId)).statusCode).toBe(200);
    expect(c.grupo(grupoId)).toBeUndefined();
    expect(c.carteira(a).disponivel).toBe(19.5);
    semCaucaoPresa(a);
    expect(c.membrosNaoDono(grupoId)).toHaveLength(0);
    expect(c.docs('membrosGrupo').some((m) => String(m._id) === String(antigo._id))).toBe(false);
    expect(c.docs('invoices')[0].encerramento).toMatchObject({ motivo: 'grupo_excluido', caucaoDevolvida: 10.5 });
  });

  it('grupo após completar que nunca lotou devolve tudo', async () => {
    const grupoId = c.semearGrupo({ acesso: 'apos_completar' });
    const a = await entrar(grupoId);
    await excluir(grupoId);
    expect(c.carteira(a).disponivel).toBe(30);
    expect(c.carteira(a).categorias.retido_entrada.valor).toBe(0);
  });

  it('grupo já lotado com retenção pendente: a mensalidade não volta', async () => {
    const grupoId = c.semearGrupo({ acesso: 'apos_completar' });
    const a = await entrar(grupoId);
    c.grupo(grupoId).lotadoEm = new Date(); // lotou e a liberação ainda não foi lançada
    await excluir(grupoId);
    expect(c.carteira(a).disponivel).toBe(19.5);
    expect(c.carteira(a).categorias.retido_entrada.valor).toBe(0);
  });

  it('falha na devolução: o membro com caução fica órfão e a rotina completa e remove', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    quebrarLedger(() => true);
    expect((await excluir(grupoId)).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(c.participacao(grupoId, a).caucao.situacao).toBe('bloqueada');
    expect((await rodarRotina()).resultados).toEqual(['concluido']);
    expect(c.carteira(a).disponivel).toBe(19.5);
    expect(c.participacao(grupoId, a)).toBeUndefined();
  });
});

describe('outros caminhos de saída', () => {
  it('remoção pelo staff devolve e registra quem removeu', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    const suporte = new ObjectId();
    const res = await sair(grupoId, a, sessao(suporte, { systemRole: 'support' }));
    expect(res.body.devolvido.total).toBe(10.5);
    expect(c.docs('invoices')[0].encerramento).toMatchObject({ motivo: 'removido_staff', porId: String(suporte) });
    expect(logAudit.mock.calls.map(([x]) => x.action)).toEqual(expect.arrayContaining(['caucao.devolvida', 'grupo.saida']));
    const saida = logAudit.mock.calls.map(([x]) => x).find((x) => x.action === 'grupo.saida');
    expect(saida.details).toMatchObject({ grupoId: String(grupoId), userId: String(a), motivo: 'removido_staff' });
  });

  it('outro usuário não remove ninguém (403), e nada se move', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    expect((await sair(grupoId, a, sessao(new ObjectId()))).statusCode).toBe(403);
    expect(liquidacoes()).toHaveLength(0);
  });

  it('encerramento pelo dono devolve a todos e mantém os registros', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    const b = await entrar(grupoId);
    const res = await chamar(handlerDono, { query: { id: String(grupoId) }, body: { acao: 'encerrar' }, sessao: sessao(c.donoId) });
    expect(res.statusCode).toBe(200);
    for (const id of [a, b]) {
      expect(c.carteira(id).disponivel).toBe(19.5);
      expect(c.participacao(grupoId, id)).toMatchObject({ temCaucao: false, caucao: { situacao: 'devolvida' } });
    }
    expect(c.docs('invoices').map((f) => f.encerramento.motivo)).toEqual(['grupo_encerrado', 'grupo_encerrado']);
  });

  it('falha ao devolver um membro não impede o cancelamento nem os outros; a rotina completa', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    const b = await entrar(grupoId);
    quebrarLedger((docs) => docs[0].walletId === `w-${a}`);
    expect((await cancelarPeloCotea(grupoId)).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(c.carteira(a).categorias.caucao.valor).toBe(10.5);
    semCaucaoPresa(b);

    const primeira = await rodarRotina();
    expect(primeira.itens).toEqual([`liquidar:${c.participacao(grupoId, a)._id}`]);
    semCaucaoPresa(a);
    expect((await rodarRotina()).itens).toEqual([]);
    expect(liquidacoes().filter((l) => l.type === 'credit')).toHaveLength(2);
  });

  it('liquidação que falha mantém o membro no grupo (500)', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    quebrarLedger(() => true);
    expect((await sair(grupoId, a)).statusCode).toBe(500);
    vi.restoreAllMocks();
    expect(c.participacao(grupoId, a).caucao.situacao).toBe('bloqueada');
    expect(c.carteira(a).disponivel).toBe(9);
  });

  it('duas saídas simultâneas devolvem uma vez só', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    const respostas = await Promise.all([sair(grupoId, a), sair(grupoId, a)]);
    expect(respostas.every((r) => [200, 404].includes(r.statusCode))).toBe(true);
    expect(c.carteira(a).disponivel).toBe(19.5);
    expect(liquidacoes().filter((l) => l.type === 'credit')).toHaveLength(1);
    expect(c.participacao(grupoId, a)).toBeUndefined();
  });

  it('saída ao mesmo tempo que o cancelamento: um só crédito', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    await Promise.all([sair(grupoId, a), cancelarPeloCotea(grupoId)]);
    expect(c.carteira(a).disponivel).toBe(19.5);
    expect(liquidacoes().filter((l) => l.type === 'credit')).toHaveLength(1);
  });

  it('o limite por requisição deixa o resto para a próxima passada', async () => {
    const grupoId = c.semearGrupo({ capacidade: 5 });
    for (let i = 0; i < 3; i += 1) await entrar(grupoId);
    c.grupo(grupoId).status = 'cancelado';
    expect(await liquidarParticipacoesDoGrupo({ db: estado.banco.db, grupoId, motivo: 'grupo_cancelado', limite: 2 }))
      .toEqual({ total: 2, falhas: 0 });
    expect((await rodarRotina()).itens).toHaveLength(1);
  });
});

describe('banidos', () => {
  it('a rotina devolve a caução do banido e mantém o registro que barra a volta', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    c.participacao(grupoId, a).status = 'banido';
    expect((await rodarRotina()).resultados).toEqual(['concluido']);
    expect(c.carteira(a).disponivel).toBe(19.5);
    expect(c.participacao(grupoId, a).status).toBe('banido');
    estado.session = sessao(a);
    const volta = await chamar(handlerResumo, { method: 'GET', query: { grupoId: String(grupoId) } });
    expect(volta.body.codigo).toBe('membro_banido');
  });

  it('banido que "cancela" recebe a caução, mas não apaga o próprio registro', async () => {
    const grupoId = c.semearGrupo();
    const a = await entrar(grupoId);
    c.participacao(grupoId, a).status = 'banido';
    const res = await sair(grupoId, a);
    expect(res.body.devolvido.total).toBe(10.5);
    expect(c.participacao(grupoId, a).status).toBe('banido');
  });

  it('rotina sem pendências não toca em participações vivas', async () => {
    const grupoId = c.semearGrupo();
    await entrar(grupoId);
    expect((await rodarRotina()).itens).toEqual([]);
    expect(liquidacoes()).toHaveLength(0);
  });
});
