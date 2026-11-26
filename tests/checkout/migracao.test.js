// Execução da migração do checkout v2 (006, T038 — logic §10) sobre o banco em memória
// com o ledger real.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarBancoTransacional } from '../helpers/db-transacional-memoria.js';
import { migrarFaturas, migrarIndice, planejarIndice, NOME_INDICE_REFERENCIA } from '../../lib/checkout-migracao.js';
import { criarLedger, calcularResumo } from '../../lib/ledger/ledger.js';
import { criarRepositorioLedgerMongo } from '../../lib/ledger/repositorio-mongo.js';

const USUARIO = '692a1ecaf4d96d827f27a271';
const POR_OPERACAO = { name: 'op', key: { operacaoId: 1, walletId: 1, categoria: 1, type: 1 }, unique: true };
const referencia = (unique) => ({ name: NOME_INDICE_REFERENCIA, key: { referenceId: 1, type: 1, source: 1 }, ...(unique ? { unique } : {}) });

describe('índice por referência', () => {
  const colecao = (indices) => ({ indexes: async () => indices, dropIndex: vi.fn(), createIndex: vi.fn() });

  it('planeja trocar, criar ou nada', () => {
    expect(planejarIndice([POR_OPERACAO, referencia(true)])).toBe('trocar');
    expect(planejarIndice([POR_OPERACAO])).toBe('criar');
    expect(planejarIndice([POR_OPERACAO, referencia(false)])).toBe('ok');
  });

  it('aborta sem o índice único por operacaoId, sem apagar nada', async () => {
    const c = colecao([referencia(true)]);
    await expect(migrarIndice({ colecao: c, aplicar: true })).rejects.toThrow('operacaoId');
    expect(c.dropIndex).not.toHaveBeenCalled();
  });

  it('dry-run não toca; aplicar troca por um parcial não único', async () => {
    const c = colecao([POR_OPERACAO, referencia(true)]);
    expect(await migrarIndice({ colecao: c })).toBe('trocar');
    expect(c.dropIndex).not.toHaveBeenCalled();
    await migrarIndice({ colecao: c, aplicar: true });
    expect(c.dropIndex).toHaveBeenCalledWith(NOME_INDICE_REFERENCIA);
    expect(c.createIndex).toHaveBeenCalledWith(
      { referenceId: 1, type: 1, source: 1 },
      { partialFilterExpression: { referenceId: { $type: 'string' } } }
    );
  });
});

describe('faturas', () => {
  let banco;
  let ledger;
  const docs = (n) => banco.db.collection(n).docs;
  const saldo = () => calcularResumo(docs('walletTransactions')).disponivel;

  beforeEach(() => {
    banco = criarBancoTransacional();
    ledger = criarLedger({ repo: criarRepositorioLedgerMongo(banco) });
    docs('wallets').push({ _id: 'w', userId: USUARIO });
    const fatura = (_id, extra) => ({ _id, userId: USUARIO, grupoId: 'g1', amount: 42.5, status: 'paga', ...extra });
    docs('invoices').push(
      fatura('orfa-1'), fatura('orfa-2'),
      fatura('vinculada', { grupoId: 'g2', vinculadoEm: new Date() }),
      fatura('aberta', { status: 'aguardando_recarga' }),
    );
  });

  it('dry-run só planeja', async () => {
    const r = await migrarFaturas({ db: banco.db, ledger });
    expect(r.plano.map((p) => [p.invoiceId, p.acao])).toEqual([
      ['orfa-1', 'estornar'], ['orfa-2', 'estornar'], ['vinculada', 'manter'], ['aberta', 'cancelar'],
    ]);
    expect(docs('walletTransactions')).toHaveLength(0);
    expect(docs('invoices').map((f) => f.status)).toEqual(['paga', 'paga', 'paga', 'aguardando_recarga']);
  });

  it('aplicar credita cada órfã uma vez, cancela a aberta, audita e é reexecutável', async () => {
    const r = await migrarFaturas({ db: banco.db, ledger, aplicar: true });
    expect(r).toMatchObject({ estornadas: 2, canceladas: 1, falhas: [] });
    expect(saldo()).toBe(85);
    expect(docs('invoices').map((f) => f.status)).toEqual(['estornada', 'estornada', 'paga', 'cancelada']);
    expect(docs('auditLogs')).toHaveLength(3);
    // FR-031: um aviso por devolução, com o valor.
    expect(docs('notificacoesUsuario').map((n) => [String(n.userId), n.mensagem.includes('42,50')]))
      .toEqual([[USUARIO, true], [USUARIO, true]]);

    const de_novo = await migrarFaturas({ db: banco.db, ledger, aplicar: true });
    expect(de_novo).toMatchObject({ estornadas: 0, canceladas: 0, falhas: [] });
    expect(saldo()).toBe(85);
    expect(docs('auditLogs')).toHaveLength(3);
    expect(docs('notificacoesUsuario')).toHaveLength(2);
  });

  it('crédito que já existia: só alinha a fatura, sem creditar de novo', async () => {
    docs('walletTransactions').push({
      _id: 'l', walletId: 'w', type: 'credit', amount: 42.5, status: 'confirmed', categoria: 'pessoal',
      organizacaoId: null, operacaoId: 'estorno_assinatura:orfa-1', source: 'estorno_assinatura',
    });
    await migrarFaturas({ db: banco.db, ledger, aplicar: true });
    expect(saldo()).toBe(85);
    expect(docs('invoices')[0].status).toBe('estornada');
  });

  it('fatura sem carteira vira falha relatada e não impede as outras', async () => {
    docs('invoices').push({ _id: 'sem-carteira', userId: 'u9', grupoId: 'g1', amount: 5, status: 'paga' });
    const r = await migrarFaturas({ db: banco.db, ledger, aplicar: true });
    expect(r.estornadas).toBe(2);
    expect(r.falhas).toEqual([{ invoiceId: 'sem-carteira', erro: expect.stringContaining('carteira') }]);
  });
});
