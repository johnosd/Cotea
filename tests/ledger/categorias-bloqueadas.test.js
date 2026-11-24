// SC-003 (002-ledger-segmentado, T038): nenhum valor em categoria não disponível
// pode ser sacado ou usado para pagar — verificado para TODAS as categorias
// bloqueadas, não só caução.
import { describe, it, expect } from 'vitest';
import {
  criarLedger,
  SaldoInsuficienteError,
  CATEGORIAS,
  CATEGORIAS_BLOQUEADAS,
} from '../../lib/ledger/ledger.js';
import { criarRepositorioLedgerMemoria } from '../helpers/ledger-memoria.js';

const W = 'w1';
const G1 = '665f00000000000000000001';
const G2 = '665f00000000000000000002';

function montar() {
  const repo = criarRepositorioLedgerMemoria();
  let n = 0;
  const ledger = criarLedger({ repo, agora: () => new Date('2026-11-24T12:00:00Z'), gerarId: () => `id-${++n}` });
  return { repo, ledger };
}

const perna = (campos) => ({ walletId: W, organizacaoId: null, ...campos });

describe('categorias bloqueadas não são sacáveis nem pagam (SC-003, FR-004, FR-008)', () => {
  it('a lista cobre caução, retido de entrada, recebível retido e disputa', () => {
    expect([...CATEGORIAS_BLOQUEADAS].sort()).toEqual(
      [CATEGORIAS.CAUCAO, CATEGORIAS.RETIDO_ENTRADA, CATEGORIAS.RECEBIVEL_RETIDO, CATEGORIAS.DISPUTA].sort()
    );
  });

  describe.each(CATEGORIAS_BLOQUEADAS)('%s', (categoria) => {
    async function cenario() {
      const { repo, ledger } = montar();
      await ledger.registrarOperacao({
        operacaoId: 'pix:1', source: 'teste',
        pernas: [perna({ type: 'credit', categoria: CATEGORIAS.PESSOAL, valor: 10 })],
      });
      await ledger.registrarOperacao({
        operacaoId: `entrada:${categoria}`, source: 'teste',
        pernas: [perna({ type: 'credit', categoria, valor: 90, grupoId: G1, participacaoId: 'p1' })],
      });
      return { repo, ledger };
    }

    it('crédito na categoria entra no total mas não no disponível', async () => {
      const { ledger } = await cenario();
      const r = await ledger.resumo(W);
      expect(r).toMatchObject({ total: 100, disponivel: 10, sacavel: 10 });
      expect(r.categorias[categoria].valor).toBe(90);
    });

    it('saque e uso de saldo acima do pessoal são recusados sem gravar nada', async () => {
      const { repo, ledger } = await cenario();
      const antes = repo._lancamentos().length;

      await expect(ledger.registrarOperacao({
        operacaoId: 'saque:1', source: 'saque',
        pernas: [perna({ type: 'debit', categoria: CATEGORIAS.PESSOAL, valor: 10.01, status: 'blocked' })],
      })).rejects.toBeInstanceOf(SaldoInsuficienteError);
      await expect(ledger.registrarOperacao({
        operacaoId: 'uso_saldo:1', source: 'uso_saldo',
        pernas: [perna({ type: 'debit', categoria: CATEGORIAS.PESSOAL, valor: 50 })],
      })).rejects.toBeInstanceOf(SaldoInsuficienteError);

      expect(repo._lancamentos()).toHaveLength(antes);
      expect(await ledger.resumo(W)).toMatchObject({ total: 100, disponivel: 10 });
    });

    it('o saldo de um grupo não cobre débito de outro grupo', async () => {
      const { repo, ledger } = await cenario();
      const antes = repo._lancamentos().length;

      await expect(ledger.mover({
        operacaoId: 'mov:g2', walletId: W, de: categoria, para: CATEGORIAS.PESSOAL,
        valor: 1, grupoId: G2, participacaoId: 'p1', organizacaoId: null, source: 'teste',
      })).rejects.toBeInstanceOf(SaldoInsuficienteError);
      expect(repo._lancamentos()).toHaveLength(antes);

      // No próprio grupo, a movimentação passa e só então o valor vira disponível.
      await ledger.mover({
        operacaoId: 'mov:g1', walletId: W, de: categoria, para: CATEGORIAS.PESSOAL,
        valor: 90, grupoId: G1, participacaoId: 'p1', organizacaoId: null, source: 'teste',
      });
      const r = await ledger.resumo(W);
      expect(r).toMatchObject({ total: 100, disponivel: 100 });
      expect(r.categorias[categoria].valor).toBe(0);
    });
  });
});
