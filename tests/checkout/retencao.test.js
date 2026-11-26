// Mensalidade retida em grupo "após completar" (006-checkout-caucao, T033 — FR-025 a
// FR-028 e FR-020): lotação por redução de capacidade, envio de acesso, rotina e corridas.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarBancoTransacional } from '../helpers/db-transacional-memoria.js';
import { chamar, criarCenario, sessao } from '../helpers/checkout-cenario.js';

const estado = vi.hoisted(() => ({ banco: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async (req) => req?.sessao ?? estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/r2', () => ({ deleteFromR2: vi.fn(), hasR2Config: () => false }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: async () => ({}) }) } }));
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
const { default: handlerAcessos } = await import('../../pages/api/grupos/[id]/acessos.js');
const { listarRotinas } = await import('../../lib/rotinas/registro.js');

const c = criarCenario(estado, { calcularResumo });
const rotina = () => listarRotinas().find((r) => r.id === 'liquidacao-participacoes');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  logAudit.mockClear();
  estado.banco = criarBancoTransacional();
  estado.session = null;
});

const grupoRetem = (capacidade = 4) => c.semearGrupo({ capacidade, acesso: 'apos_completar', categoria: 'jogos' });
const pedir = async (grupoId, userId = c.semearUsuario(30)) => ({
  userId, body: await c.corpoDeEntrada(handlerResumo, userId, grupoId),
});
const pagar = ({ userId, body }) => chamar(handlerPay, { body, sessao: sessao(userId) });
const entrar = async (grupoId) => {
  const pedido = await pedir(grupoId);
  expect((await pagar(pedido)).statusCode).toBe(200);
  return pedido.userId;
};
const sair = (grupoId, userId) => chamar(handlerJoin, {
  method: 'DELETE', query: { id: String(grupoId) }, body: { userId: String(userId) }, sessao: sessao(userId),
});
const editar = (grupoId, capacidadeTotal) => chamar(handlerGrupo, {
  method: 'PUT',
  query: { id: String(grupoId) },
  body: { nome: 'Grupo', valorTotal: 10 * capacidadeTotal, capacidadeTotal, categoria: 'jogos', acesso: 'apos_completar' },
  sessao: sessao(c.donoId),
});
const retido = (userId) => c.carteira(userId).categorias.retido_entrada.valor;
const liberacoes = () => c.docs('walletTransactions').filter((l) => l.source === 'liberacao_retida');
const avisosDeLotacao = () => c.docs('notificacoesUsuario').filter((n) => String(n._id).startsWith('checkout:lotado:'));

describe('lotação', () => {
  it('entrada que completa libera as retenções, avisa dono e membros e audita', async () => {
    const grupoId = grupoRetem(3);
    const a = await entrar(grupoId);
    expect(avisosDeLotacao()).toHaveLength(0);
    const b = await entrar(grupoId);
    expect([retido(a), retido(b)]).toEqual([0, 0]);
    expect(liberacoes()).toHaveLength(1);
    expect(avisosDeLotacao().map((n) => String(n.userId)).sort())
      .toEqual([c.donoId, a, b].map(String).sort());
    expect(logAudit.mock.calls.map(([x]) => x.action)).toContain('mensalidade.liberada');
  });

  it('redução de capacidade que lota o grupo libera a retenção', async () => {
    const grupoId = grupoRetem(4);
    const a = await entrar(grupoId);
    expect(retido(a)).toBe(10.5);
    const res = await editar(grupoId, 2);
    expect(res.statusCode).toBe(200);
    expect(c.grupo(grupoId)).toMatchObject({ statusDetalhado: 'ativo', status: 'ativo' });
    expect(c.grupo(grupoId).lotadoEm).toBeInstanceOf(Date);
    expect(retido(a)).toBe(0);
    expect(c.participacao(grupoId, a).retencao.situacao).toBe('liberada');
    expect(avisosDeLotacao()).toHaveLength(2);
  });

  it('edição que não lota não mexe na retenção', async () => {
    const grupoId = grupoRetem(4);
    const a = await entrar(grupoId);
    expect((await editar(grupoId, 3)).statusCode).toBe(200);
    expect(c.grupo(grupoId).lotadoEm).toBeUndefined();
    expect(retido(a)).toBe(10.5);
  });

  it('edição concorrente com uma entrada (contagem velha): 409 e nada muda', async () => {
    const grupoId = grupoRetem(4);
    await entrar(grupoId);
    const colecao = estado.banco.db.collection.bind(estado.banco.db);
    vi.spyOn(estado.banco.db, 'collection').mockImplementation((nome) => {
      const original = colecao(nome);
      if (nome !== 'grupos') return original;
      return {
        ...original,
        get docs() { return original.docs; },
        updateOne: (filtro, update, opcoes) => {
          c.grupo(grupoId).versaoParticipacao += 1; // alguém entrou entre a contagem e a gravação
          return original.updateOne(filtro, update, opcoes);
        },
      };
    });
    const res = await editar(grupoId, 2);
    expect(res.statusCode).toBe(409);
    vi.restoreAllMocks();
    expect(c.grupo(grupoId).capacidadeTotal).toBe(4);
    expect(c.grupo(grupoId).lotadoEm).toBeUndefined();
  });
});

describe('envio de acesso', () => {
  it('quem recebeu o acesso deixa de ter mensalidade retida', async () => {
    const grupoId = grupoRetem(4);
    const a = await entrar(grupoId);
    // O banco em memória não tem aggregate: devolve os pendentes com e-mail.
    const colecao = estado.banco.db.collection.bind(estado.banco.db);
    vi.spyOn(estado.banco.db, 'collection').mockImplementation((nome) => {
      const original = colecao(nome);
      if (nome !== 'membrosGrupo') return original;
      return {
        ...original,
        get docs() { return original.docs; },
        aggregate: () => ({
          toArray: async () => original.docs
            .filter((m) => m.aguardandoEnvioAcesso && m.papel !== 'admin')
            .map((m) => ({ userId: m.userId, email: 'membro@exemplo.com' })),
        }),
      };
    });
    const res = await chamar(handlerAcessos, { query: { id: String(grupoId) }, sessao: sessao(c.donoId) });
    expect(res.body).toMatchObject({ enviados: 1, falha: 0 });
    vi.restoreAllMocks();
    expect(retido(a)).toBe(0);
    expect(c.carteira(a).disponivel).toBe(9);
    expect((await sair(grupoId, a)).body.devolvido).toEqual({ caucao: 10.5, mensalidade: 0, total: 10.5 });
  });
});

describe('rotina e concorrência', () => {
  it('liberação que falha na entrada é completada pela rotina, uma única vez', async () => {
    const grupoId = grupoRetem(3);
    const a = await entrar(grupoId);
    const pedido = await pedir(grupoId);
    const colecao = estado.banco.db.collection.bind(estado.banco.db);
    vi.spyOn(estado.banco.db, 'collection').mockImplementation((nome) => {
      const original = colecao(nome);
      if (nome !== 'walletTransactions') return original;
      return {
        ...original,
        get docs() { return original.docs; },
        insertMany: (docs, opcoes) => {
          if (docs[0].source === 'liberacao_retida') throw new Error('falha forcada');
          return original.insertMany(docs, opcoes);
        },
      };
    });
    expect((await pagar(pedido)).statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(retido(a)).toBe(10.5);

    const contexto = { db: estado.banco.db };
    const itens = await rotina().buscarVencidos({ contexto });
    expect(itens.map((i) => i.chave)).toEqual([`liberar:${c.participacao(grupoId, a)._id}`]);
    expect(await rotina().processarItem({ dados: itens[0].dados, contexto })).toBe('concluido');
    expect(await rotina().processarItem({ dados: itens[0].dados, contexto })).toBe('ignorado');
    expect(retido(a)).toBe(0);
    expect(liberacoes()).toHaveLength(1);
    expect(await rotina().buscarVencidos({ contexto })).toEqual([]);
  });

  it('rotina não libera retenção de grupo que ainda não lotou', async () => {
    await entrar(grupoRetem(4));
    expect(await rotina().buscarVencidos({ contexto: { db: estado.banco.db } })).toEqual([]);
  });

  it('saída concorrente com a entrada que lotaria: um só resultado, nunca os dois nem nenhum', async () => {
    for (let i = 0; i < 3; i += 1) {
      estado.banco = criarBancoTransacional();
      const grupoId = grupoRetem(3);
      const a = await entrar(grupoId);
      const pedido = await pedir(grupoId);
      // Varia a ordem de partida para exercitar os dois vencedores.
      const chamadas = i % 2 === 0
        ? [pagar(pedido), sair(grupoId, a)]
        : [sair(grupoId, a), pagar(pedido)];
      await Promise.all(chamadas);

      const { disponivel } = c.carteira(a);
      expect([19.5, 30]).toContain(disponivel); // saiu depois de lotar (caução) ou antes (tudo)
      expect(retido(a)).toBe(0);
      expect(c.carteira(a).categorias.caucao.valor).toBe(0);
      const lotou = Boolean(c.grupo(grupoId).lotadoEm);
      expect(disponivel).toBe(lotou ? 19.5 : 30);
      // Se a saída venceu, quem ia completar recebe o resumo novo e não é cobrado.
      const entrou = Boolean(c.participacao(grupoId, pedido.userId));
      expect(entrou).toBe(lotou);
      if (!entrou) expect(c.carteira(pedido.userId).disponivel).toBe(30);
    }
  });

  it('grupo excluído depois de lotar com retenção pendente não devolve a mensalidade', async () => {
    const grupoId = grupoRetem(4);
    const a = await entrar(grupoId);
    c.grupo(grupoId).lotadoEm = new Date();
    c.participacao(grupoId, a).retencao.situacao = 'a_liberar';
    const grupos = c.docs('grupos');
    grupos.splice(grupos.findIndex((g) => String(g._id) === String(grupoId)), 1);
    const contexto = { db: estado.banco.db };
    for (const item of await rotina().buscarVencidos({ contexto })) {
      await rotina().processarItem({ dados: item.dados, contexto });
    }
    expect(c.carteira(a).disponivel).toBe(19.5);
    expect(retido(a)).toBe(0);
    expect(c.participacao(grupoId, a)).toBeUndefined();
  });

  it('usuário inexistente na saída não afeta o grupo', async () => {
    const grupoId = grupoRetem(4);
    expect((await sair(grupoId, new ObjectId())).statusCode).toBe(404);
  });
});
