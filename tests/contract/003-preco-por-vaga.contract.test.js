// Testes de contrato da feature 003-preco-por-vaga.
// TRAVADOS pelo sdd-plan (contract-tests.lock): o sdd-execute só pode fazê-los
// passar, nunca editá-los. Interface pública: lib/preco.js (módulo puro).
import { describe, it, expect } from 'vitest';
import {
  calcularPrecoVaga,
  precoDoGrupo,
  validarNovaCapacidade,
  planejarMigracaoPrecos,
  MOTIVOS_PRECO_INVALIDO,
} from '../../lib/preco.js';

const centavos = (v) => Math.round(v * 100);

describe('003-preco-por-vaga — contrato', () => {
  // US1-AC1, US1-AC2 · FR-001 · SC-001 (inclui casos em que ponto flutuante ingênuo erra)
  it('calcula valor por vaga, repasse e taxa pela regra única, com meio-para-cima exato e taxa absorvendo o resíduo', () => {
    const casos = [
      // [T, C, valorPorVaga, repasse, taxa]
      [40, 4, 10.5, 10, 0.5],
      [10, 3, 3.5, 3.33, 0.17],
      [1, 2, 0.53, 0.5, 0.03],
      [55.9, 6, 9.78, 9.32, 0.46],
      [3.3, 3, 1.16, 1.1, 0.06],
      [0.57, 2, 0.3, 0.29, 0.01],
      [0.05, 5, 0.01, 0.01, 0],
      ['40,00', '4', 10.5, 10, 0.5],
    ];
    for (const [valorTotal, capacidade, valorPorVaga, repasse, taxa] of casos) {
      const r = calcularPrecoVaga({ valorTotal, capacidade });
      expect(r, `T=${valorTotal} C=${capacidade}`).toMatchObject({ valido: true, valorPorVaga, repasse, taxa, parteDono: repasse });
      expect(centavos(r.repasse) + centavos(r.taxa)).toBe(centavos(r.valorPorVaga));
    }
  });

  // US1-AC3 · FR-004, FR-005, FR-006 · Edge cases de entrada mal formada
  it('recusa capacidade < 2 ou não inteira, valor total inválido e repasse abaixo de R$ 0,01', () => {
    for (const capacidade of [1, 0, -2, 2.5, 'abc', undefined]) {
      expect(calcularPrecoVaga({ valorTotal: 40, capacidade }), `C=${capacidade}`)
        .toMatchObject({ valido: false, motivo: MOTIVOS_PRECO_INVALIDO.CAPACIDADE_MINIMA });
    }
    for (const valorTotal of [0, -1, 'x', 10.555, null, '']) {
      expect(calcularPrecoVaga({ valorTotal, capacidade: 4 }), `T=${valorTotal}`)
        .toMatchObject({ valido: false, motivo: MOTIVOS_PRECO_INVALIDO.VALOR_TOTAL_INVALIDO });
    }
    expect(calcularPrecoVaga({ valorTotal: 0.01, capacidade: 3 }))
      .toMatchObject({ valido: false, motivo: MOTIVOS_PRECO_INVALIDO.REPASSE_MINIMO });
    const r = calcularPrecoVaga({ valorTotal: 40, capacidade: 1 });
    expect(typeof r.mensagem).toBe('string');
    expect(r.mensagem.length).toBeGreaterThan(0);
  });

  // US2-AC1, US2-AC2, US3-AC4 · FR-010, FR-011, FR-014 — sem fallback para valorTotal/preco/T÷C
  it('precoDoGrupo usa só o preço vigente gravado e nunca cai em fallback legado', () => {
    expect(precoDoGrupo({ valorTotal: 40, capacidadeTotal: 4, valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true }))
      .toEqual({ valido: true, valorPorVaga: 10.5, repasse: 10, taxa: 0.5 });
    // legado: tem valorPorVaga e T/C, mas nunca passou pela regra nova
    expect(precoDoGrupo({ valorTotal: 40, capacidadeTotal: 4, valorPorVaga: 10 })).toEqual({ valido: false });
    expect(precoDoGrupo({ valorTotal: 85, capacidadeTotal: 1, preco: 85, precoValido: false })).toEqual({ valido: false });
    // trio incoerente não é cobrado
    expect(precoDoGrupo({ valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.4, precoValido: true })).toEqual({ valido: false });
    expect(precoDoGrupo(null)).toEqual({ valido: false });
  });

  // US1-AC4 · FR-007 — o dono conta como participante
  it('recusa capacidade nova abaixo de dono + membros ativos e aceita igual', () => {
    const recusa = validarNovaCapacidade({ capacidade: 3, membrosAtivos: 3 });
    expect(recusa).toMatchObject({ valido: false, participantes: 4 });
    expect(recusa.mensagem).toContain('4');
    expect(validarNovaCapacidade({ capacidade: 4, membrosAtivos: 3 })).toMatchObject({ valido: true, participantes: 4 });
    expect(validarNovaCapacidade({ capacidade: 2, membrosAtivos: 0 })).toMatchObject({ valido: true, participantes: 1 });
  });

  // US4-AC1, US4-AC2, US4-AC3 · FR-008, FR-015 · SC-005
  it('migração recalcula válidos, marca inválidos sem inventar valores, normaliza reservadas e é idempotente', () => {
    const legados = [
      { _id: 'a', valorTotal: 40, capacidadeTotal: 4, valorPorVaga: 10, vagasReservadasAdmin: 1 },
      { _id: 'b', valorTotal: 85, capacidadeTotal: 1, valorPorVaga: 85, vagasReservadasAdmin: 2 },
      { _id: 'c', capacidadeTotal: 4, valorPorVaga: 12 },
    ];
    const plano = planejarMigracaoPrecos(legados);
    const porId = Object.fromEntries(plano.map((p) => [p._id, p]));

    expect(porId.a).toMatchObject({
      acao: 'atualizar',
      set: { valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5, precoValido: true, vagasReservadasAdmin: 1 },
    });
    for (const id of ['b', 'c']) {
      expect(porId[id].acao).toBe('invalido');
      expect(porId[id].motivo).toBeTruthy();
      expect(porId[id].set).toMatchObject({ precoValido: false, vagasReservadasAdmin: 1 });
      expect(porId[id].set).not.toHaveProperty('valorPorVaga');
      expect(porId[id].set).not.toHaveProperty('capacidadeTotal');
      expect(porId[id].set).not.toHaveProperty('valorTotal');
    }

    const aplicados = legados.map((g) => ({ ...g, ...(porId[g._id].set || {}) }));
    const segunda = planejarMigracaoPrecos(aplicados);
    expect(segunda.every((p) => p.set === null)).toBe(true);
    expect(segunda.find((p) => p._id === 'a').acao).toBe('inalterado');
    expect(segunda.find((p) => p._id === 'b').acao).toBe('invalido');
  });
});
