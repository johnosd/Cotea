// Plano da migração das faturas do checkout antigo (006, T009 — logic §10, FR-030).
import { describe, it, expect } from 'vitest';
import { planejarMigracaoCheckout } from '../../lib/checkout.js';

const fatura = (_id, extra = {}) => ({ _id, userId: 'u1', grupoId: 'g1', amount: 42.5, status: 'paga', ...extra });
const acoes = (entrada) => Object.fromEntries(planejarMigracaoCheckout(entrada).map((p) => [p.invoiceId, p.acao]));

describe('planejarMigracaoCheckout', () => {
  it('casos do banco real: 3 pagas sem participação estornam; vinculada e estornada ficam', () => {
    const faturas = [
      fatura('a'), fatura('b'), fatura('c'),
      fatura('d', { userId: 'u2', grupoId: 'g2', vinculadoEm: new Date() }),
      fatura('e', { status: 'estornada' }),
    ];
    // membro antigo sem fatura, de outro usuário/grupo: não protege as faturas a, b e c
    const membros = [{ userId: 'u3', grupoId: 'g3', papel: 'membro' }];
    expect(acoes({ faturas, membros })).toEqual({ a: 'estornar', b: 'estornar', c: 'estornar', d: 'manter', e: 'manter' });
  });

  it('faturas abertas são canceladas', () => {
    expect(acoes({ faturas: [fatura('a', { status: 'aguardando_pagamento' }), fatura('b', { status: 'aguardando_recarga' })] }))
      .toEqual({ a: 'cancelar', b: 'cancelar' });
  });

  it('paga com participação (por usuário+grupo ou por invoiceId) ou com membroId não é estornada', () => {
    const faturas = [fatura('a'), fatura('b', { userId: 'u9' }), fatura('c', { userId: 'u8', membroId: 'm' })];
    const membros = [
      { userId: { toString: () => 'u1' }, grupoId: { toString: () => 'g1' }, status: 'banido' },
      { userId: 'outro', grupoId: 'outro', invoiceId: 'b' },
    ];
    expect(acoes({ faturas, membros })).toEqual({ a: 'manter', b: 'manter', c: 'manter' });
  });

  it('faturas do checkout novo e de status desconhecido ficam como estão (reexecução não muda nada)', () => {
    const faturas = [
      fatura('a', { entrada: { chave: 'x' } }),
      fatura('b', { status: 'cancelada' }),
      fatura('c', { status: undefined }),
    ];
    expect(acoes({ faturas })).toEqual({ a: 'manter', b: 'manter', c: 'manter' });
    expect(planejarMigracaoCheckout()).toEqual([]);
  });
});
