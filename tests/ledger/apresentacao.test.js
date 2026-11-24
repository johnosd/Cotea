// Apresentação do resumo (002-ledger-segmentado, T024).
import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { calcularResumo, CATEGORIAS_BLOQUEADAS } from '../../lib/ledger/ledger.js';
import { enriquecerResumo, resumoPublico, ROTULOS_CATEGORIAS } from '../../lib/ledger/apresentacao.js';

const G1 = '665f00000000000000000001';
const G2 = '665f00000000000000000002';
const APAGADO = '665f00000000000000000009';

function dbFake(grupos) {
  const consultas = [];
  return {
    consultas,
    collection(nome) {
      expect(nome).toBe('grupos');
      return {
        find(filtro) {
          consultas.push(filtro);
          const alvos = filtro._id.$in.map(String);
          return { toArray: async () => grupos.filter((g) => alvos.includes(String(g._id))) };
        },
      };
    },
  };
}

const l = (campos) => ({ walletId: 'w', status: 'confirmed', type: 'credit', participacaoId: null, ...campos });

describe('apresentação do resumo', () => {
  it('enriquece porGrupo com grupoNome casando string do ledger com ObjectId de grupos; grupo apagado → null', async () => {
    const resumo = calcularResumo([
      l({ categoria: 'pessoal', amount: 10 }),
      l({ categoria: 'caucao', amount: 12.34, grupoId: G1, participacaoId: 'p1' }),
      l({ categoria: 'caucao', amount: 5, grupoId: G2, participacaoId: 'p2' }),
      l({ categoria: 'disputa', amount: 1, grupoId: APAGADO }),
    ]);
    const db = dbFake([
      { _id: new ObjectId(G1), nome: 'Netflix família' },
      { _id: G2, nome: 'Spotify' }, // _id string também é aceito
    ]);
    const enriquecido = await enriquecerResumo(db, resumo);

    expect(enriquecido.categorias.caucao.valor).toBe(17.34);
    expect(enriquecido.categorias.caucao.porGrupo).toEqual(
      expect.arrayContaining([
        { grupoId: G1, grupoNome: 'Netflix família', participacaoId: 'p1', valor: 12.34 },
        { grupoId: G2, grupoNome: 'Spotify', participacaoId: 'p2', valor: 5 },
      ])
    );
    expect(enriquecido.categorias.disputa.porGrupo).toEqual([
      { grupoId: APAGADO, grupoNome: null, participacaoId: null, valor: 1 },
    ]);
    expect(enriquecido.disponivel).toBe(10);
    expect(db.consultas).toHaveLength(1);
  });

  it('sem grupos não consulta o banco', async () => {
    const db = dbFake([]);
    const r = await enriquecerResumo(db, calcularResumo([l({ categoria: 'pessoal', amount: 3 })]));
    expect(db.consultas).toHaveLength(0);
    expect(r.categorias.caucao).toEqual({ valor: 0, porGrupo: [] });
  });

  it('resumoPublico não expõe receitaTaxa', () => {
    const publico = resumoPublico(calcularResumo([]));
    expect(publico).not.toHaveProperty('receitaTaxa');
    expect(Object.keys(publico).sort()).toEqual(['categorias', 'disponivel', 'sacavel', 'saqueEmAndamento', 'total']);
  });

  it('toda categoria não disponível e o saque em andamento têm rótulo e explicação', () => {
    for (const chave of [...CATEGORIAS_BLOQUEADAS, 'saqueEmAndamento']) {
      expect(ROTULOS_CATEGORIAS[chave]?.rotulo).toBeTruthy();
      expect(ROTULOS_CATEGORIAS[chave]?.explicacao).toBeTruthy();
    }
  });
});
