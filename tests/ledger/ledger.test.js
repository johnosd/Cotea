// Testes adicionais do núcleo do ledger (002-ledger-segmentado, T017).
import { describe, it, expect } from 'vitest';
import {
  criarLedger,
  LancamentoInvalidoError,
  SaldoInsuficienteError,
  CATEGORIAS,
  CONTA_PLATAFORMA_ID,
} from '../../lib/ledger/ledger.js';
import { criarRepositorioLedgerMemoria } from '../helpers/ledger-memoria.js';

const W = 'w1';
const G1 = '665f00000000000000000001';

function montar() {
  const repo = criarRepositorioLedgerMemoria();
  let n = 0;
  const ledger = criarLedger({ repo, agora: () => new Date('2026-11-24T12:00:00Z'), gerarId: () => `id-${++n}` });
  return { repo, ledger };
}

const credito = (operacaoId, valor, extras = {}) => ({
  operacaoId,
  source: 'teste',
  pernas: [{ walletId: W, type: 'credit', categoria: CATEGORIAS.PESSOAL, valor, organizacaoId: null, ...extras }],
});

describe('núcleo do ledger — regras adicionais', () => {
  it('receita_taxa só na conta da plataforma, e a plataforma só aceita receita_taxa', async () => {
    const { ledger, repo } = montar();
    await expect(
      ledger.registrarOperacao(credito('a', 1, { categoria: CATEGORIAS.RECEITA_TAXA }))
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
    await expect(
      ledger.registrarOperacao(credito('b', 1, { walletId: CONTA_PLATAFORMA_ID }))
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
    expect(repo._lancamentos()).toHaveLength(0);
  });

  it('mover com origem igual ao destino é recusado', async () => {
    const { ledger } = montar();
    await expect(
      ledger.mover({ operacaoId: 'm', walletId: W, de: 'pessoal', para: 'pessoal', valor: 1, organizacaoId: null })
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
  });

  it('operação repetida devolve os lançamentos existentes sem revalidar saldo', async () => {
    const { ledger } = montar();
    await ledger.registrarOperacao(credito('pix:1', 50));
    const debito = {
      operacaoId: 'uso:1',
      source: 'uso_saldo',
      pernas: [{ walletId: W, type: 'debit', categoria: 'pessoal', valor: 50, organizacaoId: null }],
    };
    const primeira = await ledger.registrarOperacao(debito);
    expect(primeira.criada).toBe(true);
    // Saldo agora é 0: revalidar faria falhar; a repetição tem de ser idempotente.
    const repetida = await ledger.registrarOperacao(debito);
    expect(repetida.criada).toBe(false);
    expect(repetida.lancamentos.map((l) => l._id)).toEqual(primeira.lancamentos.map((l) => l._id));
  });

  it('status blocked fora de débito pessoal é recusado', async () => {
    const { ledger } = montar();
    await expect(
      ledger.registrarOperacao(credito('c', 1, { status: 'blocked' }))
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
    await expect(
      ledger.registrarOperacao({
        operacaoId: 'd',
        source: 'teste',
        pernas: [{ walletId: W, type: 'debit', categoria: 'caucao', grupoId: G1, valor: 1, status: 'blocked', organizacaoId: null }],
      })
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
  });

  it('extra recebe a sessão e os lançamentos já com _id, operacaoId e pernasTotal', async () => {
    const { ledger, repo } = montar();
    let visto;
    const r = await ledger.registrarOperacao({
      ...credito('pix:9', 12.345),
      extra: async (ctx) => { visto = ctx; return 'ok'; },
    });
    expect(r.resultadoExtra).toBe('ok');
    expect(visto.sessao).toBeNull();
    expect(visto.lancamentos).toHaveLength(1);
    expect(visto.lancamentos[0]).toMatchObject({
      _id: 'id-1', operacaoId: 'pix:9', pernasTotal: 1, amount: 12.35, status: 'confirmed', categoria: 'pessoal',
    });
    expect(repo._lancamentos()[0]._id).toBe('id-1');
  });

  it('liquidarReserva repassa alterados ao extra e falha do extra desfaz a mudança', async () => {
    const { ledger } = montar();
    await ledger.registrarOperacao(credito('pix:1', 100));
    await ledger.registrarOperacao({
      operacaoId: 'saque:1',
      source: 'saque',
      pernas: [{ walletId: W, type: 'debit', categoria: 'pessoal', valor: 30, status: 'blocked', organizacaoId: null }],
    });
    await expect(
      ledger.liquidarReserva({ operacaoId: 'saque:1', acao: 'cancelar', extra: async () => { throw new Error('x'); } })
    ).rejects.toThrow('x');
    expect(await ledger.resumo(W)).toMatchObject({ disponivel: 70, saqueEmAndamento: 30 });

    let recebido;
    const r = await ledger.liquidarReserva({
      operacaoId: 'saque:1', acao: 'confirmar', extra: async ({ alterados }) => { recebido = alterados; return 'pago'; },
    });
    expect(recebido).toBe(1);
    expect(r).toEqual({ alterados: 1, resultadoExtra: 'pago' });
    expect(await ledger.resumo(W)).toMatchObject({ total: 70, disponivel: 70, saqueEmAndamento: 0 });
  });

  it('SaldoInsuficienteError informa disponível e solicitado em reais', async () => {
    const { ledger } = montar();
    await ledger.registrarOperacao(credito('pix:1', 10.5));
    const err = await ledger
      .registrarOperacao({
        operacaoId: 'uso:x',
        source: 'uso_saldo',
        pernas: [{ walletId: W, type: 'debit', categoria: 'pessoal', valor: 20, organizacaoId: null }],
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(SaldoInsuficienteError);
    expect(err).toMatchObject({ walletId: W, categoria: 'pessoal', disponivel: 10.5, solicitado: 20 });
  });

  it('duplicidade no índice de operacaoId vira repetição (corrida entre carteiras sem trava comum)', async () => {
    const existentes = [{ _id: 'x', operacaoId: 'pix:dup', walletId: W }];
    let chamadas = 0;
    const repo = {
      async executarAtomico(_opts, fn) {
        chamadas += 1;
        if (chamadas === 1) throw Object.assign(new Error('E11000'), { code: 11000 });
        return fn({ buscarPorOperacao: async () => existentes });
      },
    };
    const ledger = criarLedger({ repo });
    const r = await ledger.registrarOperacao(credito('pix:dup', 5));
    expect(r).toEqual({ criada: false, lancamentos: existentes });
  });
});
