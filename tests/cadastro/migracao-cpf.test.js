// planejarMigracaoCpf (004, T039; FR-020, SC-002).
import { describe, it, expect } from 'vitest';
import { planejarMigracaoCpf } from '../../lib/cadastro-financeiro.js';

const hash = (cpf) => `h:${cpf}`;
const tipoDe = (plano, id) => plano.acoes.find((a) => a._id === id)?.tipo;

describe('planejarMigracaoCpf', () => {
  it('classifica texto puro, cifrado sem hash, inválido, sem CPF e já migrado', () => {
    const plano = planejarMigracaoCpf([
      { _id: 'puro', cpfClaro: '52998224725', cpfCifrado: false },
      { _id: 'semHash', cpfClaro: '11144477735', cpfCifrado: true },
      { _id: 'hashErrado', cpfClaro: '12345678909', cpfCifrado: true, cpfHash: 'outro' },
      { _id: 'invalido', cpfClaro: '12345678900', cpfCifrado: false },
      { _id: 'vazio', cpfClaro: '', cpfCifrado: false },
      { _id: 'ok', cpfClaro: '00000000191', cpfCifrado: true, cpfHash: 'h:00000000191' },
    ], { hash });
    expect(tipoDe(plano, 'puro')).toBe('criptografar');
    expect(tipoDe(plano, 'semHash')).toBe('definir_hash');
    expect(tipoDe(plano, 'hashErrado')).toBe('definir_hash');
    expect(tipoDe(plano, 'invalido')).toBe('marcar_invalido');
    expect(tipoDe(plano, 'vazio')).toBeUndefined();
    expect(tipoDe(plano, 'ok')).toBeUndefined();
    expect(plano.resumo).toMatchObject({ total: 6, criptografar: 1, definirHash: 2, marcarInvalido: 1, semCpf: 1, semAlteracao: 1, conflitos: 0 });
  });

  it('CPF repetido vira conflito e nenhuma das contas recebe ação', () => {
    const plano = planejarMigracaoCpf([
      { _id: 'a', cpfClaro: '52998224725', cpfCifrado: false },
      { _id: 'b', cpfClaro: '529.982.247-25', cpfCifrado: true },
      { _id: 'c', cpfClaro: '11144477735', cpfCifrado: false },
    ], { hash });
    expect(plano.conflitos).toEqual([{ ids: ['a', 'b'] }]);
    expect(tipoDe(plano, 'a')).toBeUndefined();
    expect(tipoDe(plano, 'b')).toBeUndefined();
    expect(tipoDe(plano, 'c')).toBe('criptografar');
  });

  it('segunda passada sobre o resultado aplicado → 0 ações (idempotente)', () => {
    const antes = [
      { _id: 'puro', cpfClaro: '52998224725', cpfCifrado: false },
      { _id: 'semHash', cpfClaro: '11144477735', cpfCifrado: true },
      { _id: 'invalido', cpfClaro: '12345678900', cpfCifrado: false },
    ];
    const plano = planejarMigracaoCpf(antes, { hash });
    const depois = antes.map((u) => {
      const tipo = tipoDe(plano, u._id);
      if (tipo === 'criptografar' || tipo === 'definir_hash') return { ...u, cpfCifrado: true, cpfHash: hash(u.cpfClaro) };
      if (tipo === 'marcar_invalido') return { _id: u._id, cpfClaro: '', cpfCifrado: false };
      return u;
    });
    const segunda = planejarMigracaoCpf(depois, { hash });
    expect(segunda.acoes).toEqual([]);
    expect(segunda.conflitos).toEqual([]);
  });
});
