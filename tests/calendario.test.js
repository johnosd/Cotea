// Testes adicionais do calendário (T016) — não travados.
import { describe, it, expect, afterEach } from 'vitest';
import {
  feriadosNacionais,
  ehDiaUtil,
  dataLocalBrasilia,
  vencimentoDiasCorridos,
  vencimentoDiasUteis,
  prazoVencido,
} from '../lib/calendario.js';

const TZ_ORIGINAL = process.env.TZ;

describe('calendário — casos adicionais', () => {
  afterEach(() => {
    if (TZ_ORIGINAL === undefined) delete process.env.TZ;
    else process.env.TZ = TZ_ORIGINAL;
  });

  it('calcula a Sexta-feira Santa de vários anos', () => {
    expect(feriadosNacionais(2024)).toContain('2024-03-29');
    expect(feriadosNacionais(2025)).toContain('2025-04-18');
    expect(feriadosNacionais(2027)).toContain('2027-03-26');
    expect(feriadosNacionais(2030)).toContain('2030-04-19');
    expect(feriadosNacionais(2026)).toHaveLength(10);
  });

  it('não inclui Carnaval nem Corpus Christi', () => {
    expect(feriadosNacionais(2026)).not.toContain('2026-02-17');
    expect(feriadosNacionais(2026)).not.toContain('2026-06-04');
  });

  it('a lista devolvida é cópia (mutar não afeta o cálculo)', () => {
    feriadosNacionais(2026).push('2026-03-10');
    expect(ehDiaUtil('2026-03-10')).toBe(true);
  });

  it('fins de semana não são úteis', () => {
    expect(ehDiaUtil('2026-11-21')).toBe(false); // sábado
    expect(ehDiaUtil('2026-11-22')).toBe(false); // domingo
    expect(ehDiaUtil('2026-11-23')).toBe(true);
  });

  it('valida a quantidade de dias e as datas', () => {
    const evento = new Date('2026-11-20T12:00:00Z');
    expect(() => vencimentoDiasUteis(evento, 0)).toThrow(RangeError);
    expect(() => vencimentoDiasCorridos(evento, -1)).toThrow(RangeError);
    expect(() => vencimentoDiasUteis(evento, 1.5)).toThrow(RangeError);
    expect(() => vencimentoDiasUteis(new Date('x'), 1)).toThrow(TypeError);
    expect(() => prazoVencido({ evento, dias: 1, tipo: 'semanas', agora: evento })).toThrow(RangeError);
    expect(() => prazoVencido({ evento, dias: 1, tipo: 'uteis', agora: 'hoje' })).toThrow(TypeError);
  });

  it('não depende do fuso do processo', () => {
    const evento = new Date('2026-11-11T02:59:59.000Z'); // 10/11 23:59:59 em Brasília
    const resultados = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles'].map((tz) => {
      process.env.TZ = tz;
      return [dataLocalBrasilia(evento), vencimentoDiasUteis(evento, 1).toISOString()];
    });
    for (const r of resultados) expect(r).toEqual(['2026-11-10', '2026-11-12T02:59:59.999Z']);
  });
});
