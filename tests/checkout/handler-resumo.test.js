// GET /api/assinaturas/resumo e recusas da entrada (006-checkout-caucao, T015).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarBancoTransacional } from '../helpers/db-transacional-memoria.js';
import { chamar, criarCenario, sessao } from '../helpers/checkout-cenario.js';

const estado = vi.hoisted(() => ({ banco: null, session: null }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async (req) => req?.sessao ?? estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/mongodb', async () => (await import('../helpers/checkout-cenario.js')).mongoFalso(estado));
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({
  verificarCadastroFinanceiro: vi.fn(async () => ({ ok: true, cpf: '52998224725', usuario: {} })),
}));

const { calcularResumo } = await import('../../lib/ledger/ledger.js');
const { logAudit } = await import('../../lib/audit');
const { default: handlerPay } = await import('../../pages/api/assinaturas/pay.js');
const { default: handlerResumo } = await import('../../pages/api/assinaturas/resumo.js');

const c = criarCenario(estado, { calcularResumo });
let membroId;

beforeEach(() => {
  logAudit.mockClear();
  estado.banco = criarBancoTransacional();
  membroId = c.semearUsuario(30);
  estado.session = sessao(membroId);
});

const ver = (grupoId, extra = {}) => chamar(handlerResumo, { method: 'GET', query: { grupoId: String(grupoId) }, ...extra });

describe('GET /api/assinaturas/resumo', () => {
  it('devolve valores, divisão e regras, sem expor repasse/taxa do Cotea nem gravar nada', async () => {
    const grupoId = c.semearGrupo();
    const res = await ver(grupoId);
    expect(res.statusCode).toBe(200);
    expect(res.body.grupo).toEqual({ _id: String(grupoId), nome: 'Grupo' });
    expect(res.body.resumo).toMatchObject({ total: 21, valorSaldo: 21, valorPix: 0, saldoDisponivel: 30 });
    expect(res.body.resumo).not.toHaveProperty('repasse');
    expect(res.body.resumo).not.toHaveProperty('taxaCotea');
    expect(c.docs('invoices')).toHaveLength(0);
    expect(c.debitos()).toHaveLength(0);
  });

  it('cria a carteira vazia de quem ainda não tem', async () => {
    const novato = new ObjectId();
    const res = await ver(c.semearGrupo(), { sessao: sessao(novato) });
    expect(res.body.resumo).toMatchObject({ saldoDisponivel: 0, valorPix: 21 });
    expect(c.docs('wallets').some((w) => w.userId === String(novato))).toBe(true);
  });

  it('método, sessão, conta não verificada, id e grupo inexistente', async () => {
    const grupoId = c.semearGrupo();
    expect((await ver(grupoId, { method: 'POST' })).statusCode).toBe(405);
    estado.session = null;
    expect((await ver(grupoId)).statusCode).toBe(401);
    estado.session = sessao(membroId, { contaValidada: false });
    expect((await ver(grupoId)).statusCode).toBe(403);
    estado.session = sessao(membroId);
    expect((await ver('nao-e-id')).statusCode).toBe(400);
    expect((await ver(new ObjectId())).statusCode).toBe(404);
  });

  it('recusas de elegibilidade e de preço não carregam dados do grupo', async () => {
    const casos = [
      [c.semearGrupo({ status: 'em_aprovacao' }), 409, 'grupo_indisponivel'],
      [c.semearGrupo({ adminId: membroId }), 409, 'dono_do_grupo'],
      [c.semearGrupo({ precoValido: false }), 409, 'preco_indisponivel'],
    ];
    for (const [grupoId, status, codigo] of casos) {
      const res = await ver(grupoId);
      expect([res.statusCode, res.body.codigo], codigo).toEqual([status, codigo]);
      expect(Object.keys(res.body).sort()).toEqual(['codigo', 'error']);
    }
  });
});

describe('POST /api/assinaturas/pay — elegibilidade e corpo', () => {
  it('usuário bloqueado entra normalmente (US1/AC5)', async () => {
    estado.session = sessao(membroId, { isBlocked: true });
    const grupoId = c.semearGrupo();
    const res = await chamar(handlerPay, { body: await c.corpoDeEntrada(handlerResumo, membroId, grupoId) });
    expect(res.statusCode).toBe(200);
  });

  it('chave ausente ou mal formada: 400 chave_invalida, sem efeito', async () => {
    const grupoId = c.semearGrupo();
    const pedido = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
    for (const chave of [undefined, '', 'curta', { $ne: null }]) {
      const res = await chamar(handlerPay, { body: { ...pedido, chave } });
      expect([res.statusCode, res.body.codigo]).toEqual([400, 'chave_invalida']);
    }
    expect(c.debitos()).toHaveLength(0);
  });

  it('saldoVisto ausente: pede nova confirmação em vez de cobrar', async () => {
    const grupoId = c.semearGrupo();
    const pedido = await c.corpoDeEntrada(handlerResumo, membroId, grupoId);
    const res = await chamar(handlerPay, { body: { ...pedido, saldoVisto: undefined } });
    expect(res.body.codigo).toBe('resumo_desatualizado');
    expect(c.debitos()).toHaveLength(0);
  });

  it('entrada audita assinatura.paid e registra a fidelidade do momento', async () => {
    const grupoId = c.semearGrupo({ fidelidade: { periodoMeses: 6 } });
    await chamar(handlerPay, { body: await c.corpoDeEntrada(handlerResumo, membroId, grupoId) });
    expect(c.participacao(grupoId, membroId).fidelidade).toEqual({ periodoMeses: 6 });
    expect(c.docs('invoices')[0].entrada).toMatchObject({ fidelidadeMeses: 6, retida: false, mensalidade: 10.5 });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'assinatura.paid' }));
    expect(c.grupo(grupoId).status).toBe('ativo');
  });
});
