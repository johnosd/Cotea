// Testes de contrato da feature 004-cadastro-financeiro.
// TRAVADOS pelo sdd-plan (contract-tests.lock): o sdd-execute só pode fazê-los
// passar, nunca editá-los. Interface pública: lib/cadastro-financeiro.js (puro),
// lib/encryption.js (hashCPF/decryptCPF), GET/PUT /api/perfil/cadastro-financeiro
// e os handlers HTTP das ações financeiras. O gate de servidor
// (lib/cadastro-financeiro-servidor.js) é colaborador injetado nos testes dos handlers.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { criarDbMemoria, criarRes } from '../helpers/db-grupos-memoria.js';

const estado = vi.hoisted(() => {
  // Chave de teste fixa (64 hex); nunca a do .env.
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  return { db: null, session: null };
});

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('next-auth/next', () => ({ getServerSession: vi.fn(async () => estado.session) }));
vi.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('../../lib/mongodb', () => ({
  default: Promise.resolve({ db: () => estado.db }),
  getDb: vi.fn(async () => estado.db),
  getClient: vi.fn(),
  getWalletByUser: vi.fn(),
  createWallet: vi.fn(),
  insertPayment: vi.fn(async (doc) => ({ _id: 'pay-1', status: 'pending', ...doc })),
  insertLedgerEntry: vi.fn(),
  insertWithdrawal: vi.fn(async (doc) => ({ ...doc })),
}));
vi.mock('../../lib/wallet', async (importOriginal) => ({
  ...(await importOriginal()),
  ensureWallet: vi.fn(async () => ({ _id: 'wallet-1' })),
  calculateBalances: vi.fn(async () => ({ balance: 100, available: 100 })),
}));
vi.mock('../../lib/invoices', async (importOriginal) => ({
  ...(await importOriginal()),
  createInvoice: vi.fn(),
  markInvoicePaid: vi.fn(),
  markInvoiceAwaitingTopUp: vi.fn(),
}));
vi.mock('../../lib/ledger/servidor', () => ({ obterLedger: vi.fn() }));
vi.mock('../../lib/ratelimit', async (importOriginal) => ({
  ...(await importOriginal()),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('../../lib/cep', () => ({ consultarCep: vi.fn() }));
vi.mock('../../lib/cadastro-financeiro-servidor', () => ({ verificarCadastroFinanceiro: vi.fn() }));

const {
  validarCpf, avaliarCadastroFinanceiro, planejarCadastroFinanceiro,
  CODIGO_CADASTRO_INCOMPLETO, STATUS_CEP,
} = await import('../../lib/cadastro-financeiro.js');
const { hashCPF, decryptCPF, encryptCPF } = await import('../../lib/encryption.js');
const { verificarCadastroFinanceiro } = await import('../../lib/cadastro-financeiro-servidor');
const { consultarCep } = await import('../../lib/cep');
const mongo = await import('../../lib/mongodb');
const wallet = await import('../../lib/wallet');
const invoices = await import('../../lib/invoices');
const { obterLedger } = await import('../../lib/ledger/servidor');
const { logAudit } = await import('../../lib/audit');

const { default: handlerPay } = await import('../../pages/api/assinaturas/pay.js');
const { default: handlerPixCreate } = await import('../../pages/api/pix/simulated/create.js');
const { default: handlerSaque } = await import('../../pages/api/withdraw/create.js');
const { default: handlerUsoSaldo } = await import('../../pages/api/wallet/pay.js');
const { default: handlerGrupos } = await import('../../pages/api/grupos/index.js');
const { default: handlerCadastro } = await import('../../pages/api/perfil/cadastro-financeiro.js');

const CPF_PERFIL = '52998224725';
const CPF_OUTRO = '11144477735';
const ENDERECO_OK = { cep: '01001-000', uf: 'SP', cidade: 'Sao Paulo', bairro: 'Se', rua: 'Praca da Se', numero: '100', complemento: '' };
const CEP_SE = { status: STATUS_CEP.ENCONTRADO, uf: 'SP', cidade: 'São Paulo', bairro: 'Sé', rua: 'Praça da Sé' };

const userId = new ObjectId();
const sessao = () => ({ user: { id: String(userId), email: 'dono@teste', contaValidada: true, systemRole: 'user' } });
const chamar = async (handler, { method = 'POST', body = {}, query = {} } = {}) => {
  const res = criarRes();
  await handler({ method, body, query, headers: {}, socket: {} }, res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  estado.db = criarDbMemoria();
  estado.db.collection('users').docs.push({ _id: userId, nome: 'Dono', email: 'dono@teste', username: 'dono', contaValidada: true });
  estado.session = sessao();
});

describe('004-cadastro-financeiro — contrato', () => {
  // US1-AC1/AC3/AC4 · FR-001, FR-002, FR-005 — DV, CPF travado e estado derivado
  it('valida CPF pelo dígito verificador, trava o CPF salvo e deriva o cadastro completo', () => {
    expect(validarCpf(CPF_PERFIL)).toBe(true);
    expect(validarCpf('529.982.247-25')).toBe(true);
    for (const ruim of ['52998224726', '11111111111', '1234567890', '', null, undefined, 'abcdefghijk']) {
      expect(validarCpf(ruim), String(ruim)).toBe(false);
    }

    const semCpf = { cpf: '', endereco: null };
    const invalido = planejarCadastroFinanceiro({ atual: semCpf, enviado: { cpf: '52998224726' }, cep: null });
    expect(invalido.ok).toBe(false);
    expect(invalido.erros.cpf).toEqual(expect.any(String));
    expect(invalido.cpfParaGravar).toBeNull();

    const novo = planejarCadastroFinanceiro({ atual: semCpf, enviado: { cpf: '529.982.247-25' }, cep: null });
    expect(novo).toMatchObject({ ok: true, cpfParaGravar: CPF_PERFIL, enderecoParaGravar: null });

    const travado = { cpf: CPF_PERFIL, endereco: null };
    for (const cpf of [CPF_OUTRO, '', undefined]) {
      const r = planejarCadastroFinanceiro({ atual: travado, enviado: { cpf }, cep: null });
      expect(r.cpfParaGravar, `enviado=${cpf}`).toBeNull();
      expect(r.erros.cpf, `enviado=${cpf}`).toBeUndefined();
    }

    expect(avaliarCadastroFinanceiro({ cpf: '', endereco: null })).toEqual({ completo: false, pendencias: ['cpf', 'endereco'] });
    expect(avaliarCadastroFinanceiro({ cpf: '52998224726', endereco: { ...ENDERECO_OK, cepConfirmado: true } }))
      .toEqual({ completo: false, pendencias: ['cpf'] });
    expect(avaliarCadastroFinanceiro({ cpf: CPF_PERFIL, endereco: { ...ENDERECO_OK, rua: '' } }))
      .toEqual({ completo: false, pendencias: ['endereco'] });
    expect(avaliarCadastroFinanceiro({ cpf: CPF_PERFIL, endereco: { ...ENDERECO_OK, cepConfirmado: false } }))
      .toEqual({ completo: true, pendencias: [] });
  });

  // US1-AC5/AC6/AC7 · FR-006, FR-007, FR-009 · Edge: CEP indisponível, CEP geral, S/N
  it('valida o endereço com a consulta de CEP: confirma, recusa inexistente, aceita indisponível e não deixa voltar a incompleto', () => {
    const atual = { cpf: '', endereco: null };
    const plano = (endereco, cep, base = atual) => planejarCadastroFinanceiro({ atual: base, enviado: { endereco }, cep });

    const confirmado = plano(ENDERECO_OK, CEP_SE);
    expect(confirmado.ok).toBe(true);
    expect(confirmado.enderecoParaGravar).toMatchObject({ cep: '01001000', uf: 'SP', cidade: 'São Paulo', numero: '100', cepConfirmado: true });

    const naoEncontrado = plano(ENDERECO_OK, { status: STATUS_CEP.NAO_ENCONTRADO });
    expect(naoEncontrado.ok).toBe(false);
    expect(naoEncontrado.erros.endereco).toMatch(/CEP/i);
    expect(naoEncontrado.enderecoParaGravar).toBeNull();

    const offline = plano({ ...ENDERECO_OK, numero: 's/n' }, { status: STATUS_CEP.INDISPONIVEL });
    expect(offline.ok).toBe(true);
    expect(offline.enderecoParaGravar).toMatchObject({ uf: 'SP', cidade: 'Sao Paulo', numero: 'S/N', cepConfirmado: false });
    expect(plano({ ...ENDERECO_OK, uf: 'XX' }, { status: STATUS_CEP.INDISPONIVEL }).ok).toBe(false);

    const cepGeral = { status: STATUS_CEP.ENCONTRADO, uf: 'MG', cidade: 'Serra do Salitre', bairro: '', rua: '' };
    expect(plano({ cep: '38760000', uf: '', cidade: '', bairro: '', rua: '', numero: '10' }, cepGeral).ok).toBe(false);
    expect(plano({ cep: '38760000', uf: 'SP', cidade: 'X', bairro: 'Centro', rua: 'Rua A', numero: '10' }, cepGeral).enderecoParaGravar)
      .toMatchObject({ uf: 'MG', cidade: 'Serra do Salitre', bairro: 'Centro', rua: 'Rua A', cepConfirmado: true });

    const completo = { cpf: CPF_PERFIL, endereco: { ...ENDERECO_OK, cep: '01001000', cepConfirmado: true } };
    const apagou = plano({ ...ENDERECO_OK, rua: '' }, CEP_SE, completo);
    expect(apagou.ok).toBe(false);
    expect(apagou.enderecoParaGravar).toBeNull();
    const vazio = plano({ cep: '', uf: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' }, null, completo);
    expect(vazio.ok).toBe(false);
    expect(vazio.enderecoParaGravar).toBeNull();
  });

  // US2-AC1..AC4 · FR-011, FR-012, FR-013 · SC-001 — recusa antes de qualquer efeito, nas ações financeiras
  it('pagamento, depósito PIX, saque, uso de saldo e criação de grupo recusam cadastro incompleto sem nenhum efeito', async () => {
    const recusa = {
      ok: false,
      http: 409,
      body: { error: 'Complete seu cadastro financeiro (CPF e endereco) para continuar.', codigo: CODIGO_CADASTRO_INCOMPLETO, pendencias: ['cpf', 'endereco'] },
    };
    vi.mocked(verificarCadastroFinanceiro).mockResolvedValue(recusa);

    const acoes = [
      ['pay', handlerPay, { grupoId: String(new ObjectId()) }],
      ['pix', handlerPixCreate, { amount: 20, cpf: CPF_OUTRO }],
      ['saque', handlerSaque, { amount: 10, cpfPixKey: CPF_OUTRO }],
      ['uso de saldo', handlerUsoSaldo, { amount: 5, description: 'x' }],
      ['criar grupo', handlerGrupos, { nome: 'Grupo 004', categoria: 'jogos', valorTotal: 40, capacidadeTotal: 4 }],
    ];
    for (const [nome, handler, body] of acoes) {
      vi.mocked(verificarCadastroFinanceiro).mockClear();
      const res = await chamar(handler, { body });
      expect(res.statusCode, nome).toBe(409);
      expect(res.body, nome).toMatchObject({ codigo: CODIGO_CADASTRO_INCOMPLETO, pendencias: ['cpf', 'endereco'] });
      expect(res.body.error, nome).toEqual(expect.any(String));
      expect(verificarCadastroFinanceiro, nome).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(verificarCadastroFinanceiro).mock.calls[0][0]), nome).toBe(String(userId));
    }
    for (const spy of [mongo.insertPayment, mongo.insertWithdrawal, wallet.ensureWallet, obterLedger, invoices.createInvoice, logAudit]) {
      expect(spy).not.toHaveBeenCalled();
    }
    for (const colecao of ['grupos', 'membrosGrupo', 'invoices', 'payments', 'withdrawals', 'walletTransactions']) {
      expect(estado.db.collection(colecao).docs, colecao).toHaveLength(0);
    }
  });

  // US1-AC2/AC3/AC4 · FR-003, FR-004, FR-005, FR-010 · SC-003, SC-005 · Constitution I (CPF cifrado e mascarado)
  it('PUT/GET do cadastro: CPF único sem revelar a outra conta, gravado cifrado com hash, travado e nunca devolvido completo', async () => {
    const { verificarCadastroFinanceiro: real } = await vi.importActual('../../lib/cadastro-financeiro-servidor');
    vi.mocked(verificarCadastroFinanceiro).mockImplementation(real);
    vi.mocked(consultarCep).mockResolvedValue(CEP_SE);
    const outroId = new ObjectId();
    estado.db.collection('users').docs.push({
      _id: outroId, nome: 'Outra', email: 'outra-conta@teste', username: 'outra',
      cpf: encryptCPF(CPF_OUTRO), cpfHash: hashCPF(CPF_OUTRO),
    });
    const dono = () => estado.db.collection('users').docs.find((u) => String(u._id) === String(userId));

    const duplicado = await chamar(handlerCadastro, { method: 'PUT', body: { cpf: '111.444.777-35', endereco: ENDERECO_OK } });
    expect(duplicado.statusCode).toBe(409);
    expect(duplicado.body.codigo).toBe('cpf_indisponivel');
    const textoDuplicado = JSON.stringify(duplicado.body);
    expect(textoDuplicado).not.toContain(String(outroId));
    expect(textoDuplicado).not.toContain('outra-conta@teste');
    expect(dono().cpf ?? '').toBe('');

    const salvo = await chamar(handlerCadastro, { method: 'PUT', body: { cpf: CPF_PERFIL, endereco: ENDERECO_OK } });
    expect(salvo.statusCode).toBe(200);
    expect(salvo.body).toMatchObject({ completo: true, pendencias: [], cpfTravado: true, cpfMascarado: '***.982.247-**', cepConfirmado: true });
    expect(dono().cpf).not.toContain(CPF_PERFIL);
    expect(decryptCPF(dono().cpf)).toBe(CPF_PERFIL);
    expect(dono().cpfHash).toBe(hashCPF('529.982.247-25'));
    expect(hashCPF(CPF_PERFIL)).not.toBe(hashCPF(CPF_OUTRO));

    for (const cpf of [CPF_OUTRO, '', '12345678909']) {
      const reenvio = await chamar(handlerCadastro, { method: 'PUT', body: { cpf, endereco: ENDERECO_OK } });
      expect(reenvio.statusCode, `cpf=${cpf}`).toBe(200);
      expect(decryptCPF(dono().cpf), `cpf=${cpf}`).toBe(CPF_PERFIL);
    }

    const lido = await chamar(handlerCadastro, { method: 'GET' });
    expect(lido.statusCode).toBe(200);
    expect(lido.body).toMatchObject({ completo: true, cpfTravado: true, cpfMascarado: '***.982.247-**' });
    for (const resposta of [salvo, lido]) {
      const texto = JSON.stringify(resposta.body);
      expect(texto).not.toContain(CPF_PERFIL);
      expect(texto).not.toContain('529.982.247-25');
    }
  });

  // US4-AC1/AC2/AC3 · FR-015, FR-016 — PIX e saque usam o CPF do perfil e ignoram o do cliente
  it('depósito PIX e saque gravam o CPF do perfil, ignorando o CPF/chave enviados, e o saque dispensa a chave', async () => {
    vi.mocked(verificarCadastroFinanceiro).mockResolvedValue({ ok: true, cpf: CPF_PERFIL, usuario: { _id: userId } });
    vi.mocked(obterLedger).mockResolvedValue({
      registrarOperacao: vi.fn(async (op) => ({
        resultadoExtra: await op.extra({ sessao: null, lancamentos: [] }),
        lancamentos: [{ _id: 'lanc-1' }],
      })),
    });

    const pix = await chamar(handlerPixCreate, { body: { amount: 20, cpf: CPF_OUTRO } });
    expect(pix.statusCode).toBe(201);
    expect(mongo.insertPayment).toHaveBeenCalledTimes(1);
    expect(decryptCPF(vi.mocked(mongo.insertPayment).mock.calls[0][0].pixCpf)).toBe(CPF_PERFIL);

    const comChave = await chamar(handlerSaque, { body: { amount: 10, cpfPixKey: CPF_OUTRO } });
    expect(comChave.statusCode).toBe(201);
    const semChave = await chamar(handlerSaque, { body: { amount: 10 } });
    expect(semChave.statusCode).toBe(201);
    expect(mongo.insertWithdrawal).toHaveBeenCalledTimes(2);
    for (const [doc] of vi.mocked(mongo.insertWithdrawal).mock.calls) {
      expect(decryptCPF(doc.pixKeyCpf)).toBe(CPF_PERFIL);
    }
  });
});
