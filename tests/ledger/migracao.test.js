// Migração dos legados (002-ledger-segmentado, T018).
import { describe, it, expect } from 'vitest';
import { classificarLegado, planejarMigracao, compararResumos } from '../../lib/ledger/migracao.js';

const legado = (campos) => ({
  walletId: 'w1',
  status: 'confirmed',
  referenceId: null,
  createdAt: new Date('2026-11-01T12:00:00Z'),
  ...campos,
});

describe('migração dos lançamentos legados', () => {
  it('classifica as 5 combinações reais do banco de desenvolvimento', () => {
    const base = { categoria: 'pessoal', organizacaoId: null, grupoId: null, participacaoId: null, pernasTotal: 1 };
    expect(classificarLegado(legado({ _id: 'a', type: 'debit', source: 'assinatura_grupo', referenceId: 'inv1' })))
      .toEqual({ ...base, operacaoId: 'assinatura_grupo:inv1' });
    expect(classificarLegado(legado({ _id: 'b', type: 'credit', source: 'pix', referenceId: 'pay1' })))
      .toEqual({ ...base, operacaoId: 'pix:pay1' });
    expect(classificarLegado(legado({ _id: 'c', type: 'credit', source: 'estorno_assinatura', referenceId: 'inv1' })))
      .toEqual({ ...base, operacaoId: 'estorno_assinatura:inv1' });
    expect(classificarLegado(legado({ _id: 'd', type: 'debit', source: 'uso_saldo', referenceId: null })))
      .toEqual({ ...base, operacaoId: 'legado:d' });
    expect(classificarLegado(legado({ _id: 'e', type: 'debit', source: 'saque', referenceId: 'wd1', status: 'blocked' })))
      .toEqual({ ...base, operacaoId: 'saque:wd1' });
  });

  it('não remigra documento que já tem categoria', () => {
    expect(classificarLegado({ _id: 'x', categoria: 'caucao' })).toBeNull();
    expect(planejarMigracao([{ _id: 'x', categoria: 'pessoal', walletId: 'w1' }])).toEqual([]);
  });

  it('resumo por carteira igual antes e depois numa base com os 13 casos reais', () => {
    const docs = [
      // carteira 1: 247.68 de PIX menos 247 de assinaturas (centavos fantasmas no cálculo antigo)
      legado({ _id: 1, walletId: 'w1', type: 'credit', source: 'pix', referenceId: 'p1', amount: 147.68 }),
      legado({ _id: 2, walletId: 'w1', type: 'credit', source: 'pix', referenceId: 'p2', amount: 100 }),
      legado({ _id: 3, walletId: 'w1', type: 'debit', source: 'assinatura_grupo', referenceId: 'i1', amount: 99.9 }),
      legado({ _id: 4, walletId: 'w1', type: 'debit', source: 'assinatura_grupo', referenceId: 'i2', amount: 97.1 }),
      legado({ _id: 5, walletId: 'w1', type: 'debit', source: 'assinatura_grupo', referenceId: 'i3', amount: 50 }),
      // carteira 2: assinatura, estorno, uso de saldo e saque em andamento
      legado({ _id: 6, walletId: 'w2', type: 'credit', source: 'pix', referenceId: 'p3', amount: 80 }),
      legado({ _id: 7, walletId: 'w2', type: 'debit', source: 'assinatura_grupo', referenceId: 'i4', amount: 25 }),
      legado({ _id: 8, walletId: 'w2', type: 'credit', source: 'estorno_assinatura', referenceId: 'i4', amount: 25 }),
      legado({ _id: 9, walletId: 'w2', type: 'debit', source: 'uso_saldo', referenceId: null, amount: 10.1 }),
      legado({ _id: 10, walletId: 'w2', type: 'debit', source: 'saque', referenceId: 'wd1', amount: 30, status: 'blocked' }),
      // carteira 3
      legado({ _id: 11, walletId: 'w3', type: 'credit', source: 'pix', referenceId: 'p4', amount: 0.1 }),
      legado({ _id: 12, walletId: 'w3', type: 'credit', source: 'pix', referenceId: 'p5', amount: 0.2 }),
      legado({ _id: 13, walletId: 'w3', type: 'debit', source: 'assinatura_grupo', referenceId: 'i5', amount: 0.3 }),
    ];
    const plano = planejarMigracao(docs);
    expect(plano).toHaveLength(13);
    const comparacao = compararResumos(docs, plano);
    expect(comparacao).toHaveLength(3);
    expect(comparacao.every((c) => c.igual)).toBe(true);
    const w1 = comparacao.find((c) => c.walletId === 'w1');
    expect(w1.depois).toMatchObject({ total: 0.68, disponivel: 0.68 });
    const w2 = comparacao.find((c) => c.walletId === 'w2');
    expect(w2.depois).toMatchObject({ total: 69.9, disponivel: 39.9, saqueEmAndamento: 30 });
    expect(comparacao.find((c) => c.walletId === 'w3').depois.total).toBe(0);
  });

  it('pernasTotal conta legados que caem no mesmo operacaoId', () => {
    const plano = planejarMigracao([
      legado({ _id: 'a', type: 'debit', source: 'x', referenceId: 'r' }),
      legado({ _id: 'b', type: 'credit', source: 'x', referenceId: 'r' }),
    ]);
    expect(plano.map((p) => p.set.pernasTotal)).toEqual([2, 2]);
  });
});
