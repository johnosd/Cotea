// Testes adicionais do planner de migração (003-preco-por-vaga, T021).
import { describe, it, expect } from 'vitest';
import { planejarMigracaoPrecos, MOTIVOS_PRECO_INVALIDO } from '../../lib/preco.js';

describe('planejarMigracaoPrecos — casos adicionais', () => {
  it('aceita valorTotal legado como string', () => {
    const [item] = planejarMigracaoPrecos([{ _id: 1, valorTotal: '85', capacidadeTotal: 2 }]);
    expect(item).toMatchObject({ acao: 'atualizar', set: { valorPorVaga: 44.63, repassePorVaga: 42.5, taxaPorVaga: 2.13 } });
  });

  it('marca capacidade ausente como inválida', () => {
    const [item] = planejarMigracaoPrecos([{ _id: 1, valorTotal: 40 }]);
    expect(item).toMatchObject({ acao: 'invalido', motivo: MOTIVOS_PRECO_INVALIDO.CAPACIDADE_MINIMA });
  });

  it('atualiza grupo com preço correto só por causa das reservadas', () => {
    const [item] = planejarMigracaoPrecos([{
      _id: 1, valorTotal: 40, capacidadeTotal: 4, valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5,
      precoValido: true, vagasReservadasAdmin: 2,
    }]);
    expect(item.acao).toBe('atualizar');
    expect(item.set.vagasReservadasAdmin).toBe(1);
  });

  it('reproduz os 5 grupos reais da base de desenvolvimento (quickstart §1)', () => {
    const reais = [
      ['Claude Pro', 180, 4, 47.25, 45, 2.25],
      ['NeoReader', 100, 4, 26.25, 25, 1.25],
      ['Canva Pro', 85, 2, 44.63, 42.5, 2.13],
      ['heygen', 200, 20, 10.5, 10, 0.5],
      ['Streaming CCPLAY', 70, 2, 36.75, 35, 1.75],
    ];
    const plano = planejarMigracaoPrecos(reais.map(([nome, t, c]) => ({ _id: nome, valorTotal: t, capacidadeTotal: c, vagasReservadasAdmin: 1 })));
    plano.forEach((item, i) => {
      const [, , , v, r, x] = reais[i];
      expect(item).toMatchObject({ acao: 'atualizar', set: { valorPorVaga: v, repassePorVaga: r, taxaPorVaga: x, precoValido: true } });
    });
  });

  it('lista vazia ou ausente devolve lista vazia', () => {
    expect(planejarMigracaoPrecos([])).toEqual([]);
    expect(planejarMigracaoPrecos()).toEqual([]);
  });
});
