// Testes de contrato da feature 002-ledger-segmentado.
// TRAVADOS pelo sdd-plan (contract-tests.lock): o sdd-execute só pode fazê-los
// passar, nunca editá-los. Interface pública: lib/ledger/ledger.js; repositório
// fake em tests/helpers/ledger-memoria.js.
import { describe, it, expect } from 'vitest';
import {
  criarLedger,
  calcularResumo,
  SaldoInsuficienteError,
  LancamentoInvalidoError,
  CATEGORIAS,
  CONTA_PLATAFORMA_ID,
} from '../../lib/ledger/ledger.js';
import { criarRepositorioLedgerMemoria } from '../helpers/ledger-memoria.js';

const W = 'wallet-usuario';
const G1 = '665f00000000000000000001';
const G2 = '665f00000000000000000002';
const PUBLICO = null;

let seq = 0;
const lanc = (campos) => ({
  _id: `seed-${++seq}`,
  walletId: W,
  status: 'confirmed',
  source: 'teste',
  referenceId: null,
  organizacaoId: PUBLICO,
  grupoId: null,
  participacaoId: null,
  createdAt: new Date('2026-11-24T12:00:00Z'),
  ...campos,
});

function montar() {
  const repo = criarRepositorioLedgerMemoria();
  const ledger = criarLedger({ repo, agora: () => new Date('2026-11-24T12:00:00Z') });
  return { repo, ledger };
}

async function creditar(ledger, { operacaoId, walletId = W, categoria = CATEGORIAS.PESSOAL, valor, grupoId = null, participacaoId = null }) {
  return ledger.registrarOperacao({
    operacaoId,
    source: 'teste',
    pernas: [{ walletId, type: 'credit', categoria, valor, grupoId, participacaoId, organizacaoId: PUBLICO }],
  });
}

const reservaSaque = (operacaoId, valor) => ({
  operacaoId,
  source: 'saque',
  pernas: [{ walletId: W, type: 'debit', categoria: CATEGORIAS.PESSOAL, valor, status: 'blocked', organizacaoId: PUBLICO }],
});

describe('002-ledger-segmentado — contrato', () => {
  // US1-AC1 · FR-003, FR-004, FR-005, FR-020
  it('calcula total, disponível e caução por grupo, ignora pending/cancelled e não gera centavos fantasmas', () => {
    const resumo = calcularResumo([
      lanc({ type: 'credit', categoria: 'pessoal', amount: 99.7 }),
      lanc({ type: 'credit', categoria: 'pessoal', amount: 0.1 }),
      lanc({ type: 'credit', categoria: 'pessoal', amount: 0.2 }),
      lanc({ type: 'credit', categoria: 'caucao', amount: 20, grupoId: G1, participacaoId: 'p1' }),
      lanc({ type: 'credit', categoria: 'caucao', amount: 10, grupoId: G2, participacaoId: 'p2' }),
      lanc({ type: 'credit', categoria: 'pessoal', amount: 500, status: 'pending' }),
      lanc({ type: 'debit', categoria: 'pessoal', amount: 50, status: 'cancelled' }),
    ]);

    expect(resumo.total).toBe(130);
    expect(resumo.disponivel).toBe(100);
    expect(resumo.sacavel).toBe(100);
    expect(resumo.saqueEmAndamento).toBe(0);
    expect(resumo.categorias.caucao.valor).toBe(30);
    expect(resumo.categorias.caucao.porGrupo).toEqual(
      expect.arrayContaining([
        { grupoId: G1, participacaoId: 'p1', valor: 20 },
        { grupoId: G2, participacaoId: 'p2', valor: 10 },
      ])
    );
    expect(resumo.categorias.recebivel_retido.valor).toBe(0);
    expect(resumo.categorias.retido_entrada.valor).toBe(0);
    expect(resumo.categorias.disputa.valor).toBe(0);

    // Caso real do banco de desenvolvimento: 247.68 - 247 somava 0.6799999999999997.
    const real = calcularResumo([
      lanc({ type: 'credit', categoria: 'pessoal', amount: 247.68 }),
      lanc({ type: 'debit', categoria: 'pessoal', amount: 247 }),
    ]);
    expect(real.disponivel).toBe(0.68);
    expect(calcularResumo([]).total).toBe(0);
  });

  // US1-AC2 · FR-002, FR-008, FR-021 · SC-003
  it('recusa sem gravar nada saque, pagamento ou movimentação acima do saldo da categoria e lançamentos inválidos', async () => {
    const { repo, ledger } = montar();
    await creditar(ledger, { operacaoId: 'pix:1', valor: 100 });
    await creditar(ledger, { operacaoId: 'checkout:1', categoria: CATEGORIAS.CAUCAO, valor: 30, grupoId: G1, participacaoId: 'p1' });
    const antes = repo._lancamentos().length;

    await expect(ledger.registrarOperacao(reservaSaque('saque:1', 120))).rejects.toBeInstanceOf(SaldoInsuficienteError);
    await expect(
      ledger.registrarOperacao({
        operacaoId: 'uso:1',
        source: 'uso_saldo',
        pernas: [{ walletId: W, type: 'debit', categoria: CATEGORIAS.PESSOAL, valor: 100.01, organizacaoId: PUBLICO }],
      })
    ).rejects.toBeInstanceOf(SaldoInsuficienteError);
    await expect(
      ledger.mover({ operacaoId: 'dev:1', walletId: W, de: CATEGORIAS.CAUCAO, para: CATEGORIAS.PESSOAL, valor: 40, grupoId: G1, participacaoId: 'p1', organizacaoId: PUBLICO, source: 'teste' })
    ).rejects.toBeInstanceOf(SaldoInsuficienteError);
    await expect(
      ledger.mover({ operacaoId: 'dev:2', walletId: W, de: CATEGORIAS.CAUCAO, para: CATEGORIAS.PESSOAL, valor: 10, grupoId: G2, participacaoId: 'p9', organizacaoId: PUBLICO, source: 'teste' })
    ).rejects.toBeInstanceOf(SaldoInsuficienteError);

    await expect(creditar(ledger, { operacaoId: 'inv:1', categoria: CATEGORIAS.CAUCAO, valor: 5 })).rejects.toBeInstanceOf(LancamentoInvalidoError);
    await expect(
      ledger.registrarOperacao({ operacaoId: 'inv:2', source: 'teste', pernas: [{ walletId: W, type: 'credit', categoria: CATEGORIAS.PESSOAL, valor: 5 }] })
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
    await expect(
      ledger.registrarOperacao({ operacaoId: 'inv:3', source: 'teste', pernas: [{ walletId: W, type: 'credit', categoria: 'inventada', valor: 5, organizacaoId: PUBLICO }] })
    ).rejects.toBeInstanceOf(LancamentoInvalidoError);
    await expect(creditar(ledger, { operacaoId: 'inv:4', valor: 0 })).rejects.toBeInstanceOf(LancamentoInvalidoError);

    expect(repo._lancamentos()).toHaveLength(antes);
    const resumo = await ledger.resumo(W);
    expect(resumo).toMatchObject({ total: 130, disponivel: 100 });
  });

  // US1-AC3 · FR-008 · SC-002 (requisições simultâneas na mesma carteira)
  it('duas reservas de saque simultâneas acima do disponível: só uma passa e o disponível nunca fica negativo', async () => {
    const { ledger } = montar();
    await creditar(ledger, { operacaoId: 'pix:1', valor: 100 });

    const resultados = await Promise.allSettled([
      ledger.registrarOperacao(reservaSaque('saque:a', 80)),
      ledger.registrarOperacao(reservaSaque('saque:b', 80)),
    ]);

    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const falhas = resultados.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(falhas[0].reason).toBeInstanceOf(SaldoInsuficienteError);

    const resumo = await ledger.resumo(W);
    expect(resumo).toMatchObject({ total: 100, disponivel: 20, saqueEmAndamento: 80 });
  });

  // US1-AC4 · FR-010, FR-014
  it('reserva de saque reduz o disponível; rejeitar devolve, aprovar baixa do total; repetir não duplica', async () => {
    const { repo, ledger } = montar();
    await creditar(ledger, { operacaoId: 'pix:1', valor: 100 });

    const r1 = await ledger.registrarOperacao(reservaSaque('saque:w1', 40));
    expect(r1.criada).toBe(true);
    expect(await ledger.resumo(W)).toMatchObject({ total: 100, disponivel: 60, saqueEmAndamento: 40 });

    const qtd = repo._lancamentos().length;
    const repetida = await ledger.registrarOperacao(reservaSaque('saque:w1', 40));
    expect(repetida.criada).toBe(false);
    expect(repo._lancamentos()).toHaveLength(qtd);

    expect(await ledger.liquidarReserva({ operacaoId: 'saque:w1', acao: 'cancelar' })).toEqual({ alterados: 1 });
    expect(await ledger.resumo(W)).toMatchObject({ total: 100, disponivel: 100, saqueEmAndamento: 0 });
    expect(await ledger.liquidarReserva({ operacaoId: 'saque:w1', acao: 'confirmar' })).toEqual({ alterados: 0 });

    await ledger.registrarOperacao(reservaSaque('saque:w2', 40));
    expect(await ledger.liquidarReserva({ operacaoId: 'saque:w2', acao: 'confirmar' })).toEqual({ alterados: 1 });
    expect(await ledger.liquidarReserva({ operacaoId: 'saque:w2', acao: 'confirmar' })).toEqual({ alterados: 0 });
    expect(await ledger.liquidarReserva({ operacaoId: 'saque:w2', acao: 'cancelar' })).toEqual({ alterados: 0 });
    expect(await ledger.resumo(W)).toMatchObject({ total: 60, disponivel: 60, saqueEmAndamento: 0 });
  });

  // US1-AC6 · FR-006, FR-007, FR-009, FR-011
  it('libera recebível retido para o disponível mantendo a origem e grava operação com várias carteiras tudo ou nada', async () => {
    const { repo, ledger } = montar();
    await creditar(ledger, { operacaoId: 'recebivel:p1:2026-11', categoria: CATEGORIAS.RECEBIVEL_RETIDO, valor: 50, grupoId: G1, participacaoId: 'p1' });

    await expect(ledger.registrarOperacao(reservaSaque('saque:x', 10))).rejects.toBeInstanceOf(SaldoInsuficienteError);

    const mov = await ledger.mover({
      operacaoId: 'liberacao:p1:2026-11', walletId: W, de: CATEGORIAS.RECEBIVEL_RETIDO, para: CATEGORIAS.PESSOAL,
      valor: 50, grupoId: G1, participacaoId: 'p1', organizacaoId: PUBLICO, source: 'liberacao_recebivel',
    });
    expect(mov.criada).toBe(true);
    const daOperacao = repo._lancamentos().filter((l) => l.operacaoId === 'liberacao:p1:2026-11');
    expect(daOperacao).toHaveLength(2);
    expect(daOperacao.map((l) => [l.type, l.categoria]).sort()).toEqual([['credit', 'pessoal'], ['debit', 'recebivel_retido']]);
    expect(daOperacao.every((l) => l.grupoId === G1 && l.participacaoId === 'p1' && l.organizacaoId === null)).toBe(true);

    const resumo = await ledger.resumo(W);
    expect(resumo).toMatchObject({ total: 50, disponivel: 50 });
    expect(resumo.categorias.recebivel_retido.valor).toBe(0);

    // Operação composta: débito no usuário + receita na plataforma. Débito acima do saldo → nada em nenhuma carteira.
    await expect(
      ledger.registrarOperacao({
        operacaoId: 'assinatura:inv1',
        source: 'assinatura_grupo',
        pernas: [
          { walletId: W, type: 'debit', categoria: CATEGORIAS.PESSOAL, valor: 60, organizacaoId: PUBLICO },
          { walletId: CONTA_PLATAFORMA_ID, type: 'credit', categoria: CATEGORIAS.RECEITA_TAXA, valor: 3, organizacaoId: PUBLICO },
        ],
      })
    ).rejects.toBeInstanceOf(SaldoInsuficienteError);
    // Efeito externo que falha dentro da mesma operação também desfaz tudo.
    await expect(
      ledger.registrarOperacao({
        operacaoId: 'assinatura:inv2',
        source: 'assinatura_grupo',
        pernas: [
          { walletId: W, type: 'debit', categoria: CATEGORIAS.PESSOAL, valor: 20, organizacaoId: PUBLICO },
          { walletId: CONTA_PLATAFORMA_ID, type: 'credit', categoria: CATEGORIAS.RECEITA_TAXA, valor: 1, organizacaoId: PUBLICO },
        ],
        extra: async () => { throw new Error('falha ao marcar fatura'); },
      })
    ).rejects.toThrow('falha ao marcar fatura');
    expect(repo._lancamentos().filter((l) => l.walletId === CONTA_PLATAFORMA_ID)).toHaveLength(0);
    expect(await ledger.resumo(W)).toMatchObject({ total: 50, disponivel: 50 });

    const ok = await ledger.registrarOperacao({
      operacaoId: 'assinatura:inv3',
      source: 'assinatura_grupo',
      pernas: [
        { walletId: W, type: 'debit', categoria: CATEGORIAS.PESSOAL, valor: 20, organizacaoId: PUBLICO },
        { walletId: CONTA_PLATAFORMA_ID, type: 'credit', categoria: CATEGORIAS.RECEITA_TAXA, valor: 1, organizacaoId: PUBLICO },
      ],
      extra: async () => 'fatura-paga',
    });
    expect(ok).toMatchObject({ criada: true, resultadoExtra: 'fatura-paga' });
    expect((await ledger.resumo(CONTA_PLATAFORMA_ID)).receitaTaxa).toBe(1);
    expect(await ledger.resumo(W)).toMatchObject({ disponivel: 30 });
  });
});
