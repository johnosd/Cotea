// Testes de validação das datas extras (T027) — não travados.
import { describe, it, expect } from 'vitest';
import { validarDataExtra, ehDataValida, carregarDatasExtras } from '../lib/calendario-dados.js';

describe('calendario-dados', () => {
  it('aceita data válida e normaliza a descrição', () => {
    expect(validarDataExtra({ data: '2026-02-17', descricao: '  Carnaval ' })).toEqual({
      ok: true,
      data: '2026-02-17',
      descricao: 'Carnaval',
    });
  });

  it('recusa data inexistente, formato errado e descrição inválida', () => {
    expect(validarDataExtra({ data: '2026-02-30', descricao: 'x' }).ok).toBe(false);
    expect(validarDataExtra({ data: '17/02/2026', descricao: 'x' }).ok).toBe(false);
    expect(validarDataExtra({ data: '2026-02-17', descricao: '   ' })).toEqual({ ok: false, error: 'Descricao obrigatoria' });
    expect(validarDataExtra({ data: '2026-02-17', descricao: 'a'.repeat(101) }).ok).toBe(false);
    expect(validarDataExtra({ data: '2026-02-17', descricao: 'a'.repeat(100) }).ok).toBe(true);
    expect(validarDataExtra().ok).toBe(false);
  });

  it('ehDataValida considera ano bissexto', () => {
    expect(ehDataValida('2028-02-29')).toBe(true);
    expect(ehDataValida('2026-02-29')).toBe(false);
  });

  it('carregarDatasExtras devolve os ids ordenados pelo banco', async () => {
    const chamadas = {};
    const db = {
      collection: (nome) => {
        chamadas.colecao = nome;
        return {
          find: (filtro, opcoes) => {
            chamadas.opcoes = opcoes;
            return { sort: () => ({ toArray: async () => [{ _id: '2026-02-16' }, { _id: '2026-02-17' }] }) };
          },
        };
      },
    };
    expect(await carregarDatasExtras(db)).toEqual(['2026-02-16', '2026-02-17']);
    expect(chamadas.colecao).toBe('calendarioDatasExtras');
  });
});
