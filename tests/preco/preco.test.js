// Testes adicionais da regra de preço (003-preco-por-vaga), fora do contrato travado.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calcularPrecoVaga, precoDoGrupo, validarNovaCapacidade, MOTIVOS_PRECO_INVALIDO } from '../../lib/preco.js';

const centavos = (v) => Math.round(v * 100);

describe('calcularPrecoVaga — casos adicionais', () => {
  it('aceita valores grandes sem perder precisão', () => {
    const r = calcularPrecoVaga({ valorTotal: 9999999.99, capacidade: 7 });
    expect(r.valido).toBe(true);
    expect(centavos(r.repasse) + centavos(r.taxa)).toBe(centavos(r.valorPorVaga));
    expect(r.repasse).toBe(1428571.43);
    expect(r.valorPorVaga).toBe(1500000);
  });

  it('aceita strings com espaços, vírgula e uma casa decimal', () => {
    expect(calcularPrecoVaga({ valorTotal: ' 10,1 ', capacidade: ' 2 ' })).toMatchObject({ valido: true, repasse: 5.05, valorPorVaga: 5.3 });
    expect(calcularPrecoVaga({ valorTotal: '10.10', capacidade: 2 })).toMatchObject({ valido: true, repasse: 5.05 });
  });

  it('confere a soma em uma varredura de valores (sem centavos fantasmas)', () => {
    for (let t = 1; t <= 3000; t += 7) {
      for (let c = 2; c <= 12; c += 1) {
        const r = calcularPrecoVaga({ valorTotal: t / 100, capacidade: c });
        if (!r.valido) {
          expect(r.motivo).toBe(MOTIVOS_PRECO_INVALIDO.REPASSE_MINIMO);
          continue;
        }
        expect(centavos(r.repasse) + centavos(r.taxa)).toBe(centavos(r.valorPorVaga));
        expect(r.taxa).toBeGreaterThanOrEqual(0);
        // valorPorVaga nunca diverge de (T/C)*1,05 em mais de meio centavo
        expect(Math.abs(r.valorPorVaga - (t / 100 / c) * 1.05)).toBeLessThanOrEqual(0.005 + 1e-9);
      }
    }
  });

  it('tem capacidade inválida antes de valor inválido', () => {
    expect(calcularPrecoVaga({ valorTotal: 0, capacidade: 1 }).motivo).toBe(MOTIVOS_PRECO_INVALIDO.CAPACIDADE_MINIMA);
    expect(calcularPrecoVaga()).toMatchObject({ valido: false, motivo: MOTIVOS_PRECO_INVALIDO.CAPACIDADE_MINIMA });
  });
});

describe('precoDoGrupo — casos adicionais', () => {
  it('aceita números vindos como objetos numéricos do driver (valueOf) ou strings', () => {
    const double = (v) => ({ valueOf: () => v });
    expect(precoDoGrupo({ precoValido: true, valorPorVaga: double(10.5), repassePorVaga: double(10), taxaPorVaga: double(0.5) }))
      .toEqual({ valido: true, valorPorVaga: 10.5, repasse: 10, taxa: 0.5 });
    expect(precoDoGrupo({ precoValido: true, valorPorVaga: '10.5', repassePorVaga: '10', taxaPorVaga: '0.5' }).valido).toBe(true);
  });

  it('recusa precoValido diferente de true literal e valores ausentes', () => {
    expect(precoDoGrupo({ precoValido: 'true', valorPorVaga: 10.5, repassePorVaga: 10, taxaPorVaga: 0.5 })).toEqual({ valido: false });
    expect(precoDoGrupo({ precoValido: true, valorPorVaga: 10.5, repassePorVaga: 10 })).toEqual({ valido: false });
    expect(precoDoGrupo({ precoValido: true, valorPorVaga: 0, repassePorVaga: 0, taxaPorVaga: 0 })).toEqual({ valido: false });
  });
});

describe('validarNovaCapacidade — casos adicionais', () => {
  it('trata membrosAtivos ausente como só o dono', () => {
    expect(validarNovaCapacidade({ capacidade: 2 })).toMatchObject({ valido: true, participantes: 1 });
  });
});

describe('lib/preco.js é importável no cliente', () => {
  it('não importa nenhum módulo', () => {
    const fonte = readFileSync(fileURLToPath(new URL('../../lib/preco.js', import.meta.url)), 'utf8');
    expect(fonte).not.toMatch(/^\s*import\s/m);
    expect(fonte).not.toMatch(/require\(/);
  });
});
