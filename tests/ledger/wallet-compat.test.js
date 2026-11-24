// Compatibilidade de calculateBalances (002-ledger-segmentado, T019 · D-09).
import { describe, it, expect } from 'vitest';
import { calcularResumo } from '../../lib/ledger/ledger.js';
import { mapearSaldosLegados } from '../../lib/ledger/apresentacao.js';

const l = (campos) => ({ walletId: 'w1', status: 'confirmed', ...campos });

describe('campos antigos de calculateBalances derivados do resumo', () => {
  it('mantém balance/available/blockedDebits/pendingTotal/returnedTotal e acrescenta resumo', () => {
    const docs = [
      l({ type: 'credit', amount: 247.68 }), // legado sem categoria conta como pessoal
      l({ type: 'debit', amount: 247, categoria: 'pessoal' }),
      l({ type: 'credit', amount: 100, categoria: 'pessoal' }),
      l({ type: 'debit', amount: 40, categoria: 'pessoal', status: 'blocked' }),
      l({ type: 'credit', amount: 15, categoria: 'pessoal', status: 'pending' }),
      l({ type: 'debit', amount: 12.5, categoria: 'pessoal', status: 'cancelled' }),
      l({ type: 'credit', amount: 9, categoria: 'pessoal', status: 'cancelled' }),
      l({ type: 'credit', amount: 20, categoria: 'caucao', grupoId: 'g1' }),
    ];
    const r = mapearSaldosLegados(calcularResumo(docs), docs);
    expect(r).toMatchObject({
      balance: 120.68,
      available: 60.68,
      confirmedCredits: 367.68,
      confirmedDebits: 247,
      blockedDebits: 40,
      pendingTotal: 15,
      returnedTotal: 12.5,
    });
    expect(r.resumo.categorias.caucao.valor).toBe(20);
    expect(r.resumo.disponivel).toBe(60.68);
  });

  it('carteira vazia devolve zeros', () => {
    expect(mapearSaldosLegados(calcularResumo([]), [])).toMatchObject({
      balance: 0, available: 0, blockedDebits: 0, pendingTotal: 0, returnedTotal: 0,
    });
  });
});
