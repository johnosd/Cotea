// Verificação de consistência do ledger (002-ledger-segmentado, T031).
import { describe, it, expect } from 'vitest';
import { verificarConsistencia, descreverAchado, TIPOS_ACHADO } from '../../lib/ledger/consistencia.js';

const ag = (campos) => ({ walletId: 'w1', categoria: 'pessoal', grupoId: null, type: 'credit', status: 'confirmed', centavos: 0, ...campos });
const G1 = '665f00000000000000000001';

describe('verificarConsistencia', () => {
  it('ledger consistente → 0 achados', () => {
    const achados = verificarConsistencia({
      agregados: [
        ag({ centavos: 10000 }),
        ag({ type: 'debit', centavos: 3000 }),
        ag({ type: 'debit', status: 'blocked', centavos: 7000 }),
        ag({ categoria: 'caucao', grupoId: G1, centavos: 500 }),
        ag({ categoria: 'caucao', grupoId: G1, type: 'debit', centavos: 500 }),
        ag({ walletId: 'plataforma', categoria: 'receita_taxa', centavos: 100 }),
        ag({ type: 'debit', status: 'cancelled', centavos: 99999 }),
      ],
      semCampos: [],
      operacoesIncompletas: [{ operacaoId: 'ok', quantidade: 2, pernasTotal: 2 }],
    });
    expect(achados).toEqual([]);
  });

  it('categoria negativa por grupo (caução de G1 não compensa outro grupo)', () => {
    const achados = verificarConsistencia({
      agregados: [
        ag({ categoria: 'caucao', grupoId: G1, type: 'debit', centavos: 150 }),
        ag({ categoria: 'caucao', grupoId: 'outro', centavos: 1000 }),
      ],
    });
    expect(achados).toEqual([
      { tipo: TIPOS_ACHADO.CATEGORIA_NEGATIVA, walletId: 'w1', categoria: 'caucao', grupoId: G1, valor: -1.5 },
    ]);
  });

  it('pessoal negativo e disponível negativo', () => {
    const negativo = verificarConsistencia({ agregados: [ag({ type: 'debit', centavos: 100 })] });
    expect(negativo.map((a) => a.tipo).sort()).toEqual([TIPOS_ACHADO.CATEGORIA_NEGATIVA, TIPOS_ACHADO.DISPONIVEL_NEGATIVO].sort());

    const soDisponivel = verificarConsistencia({
      agregados: [ag({ centavos: 1000 }), ag({ type: 'debit', status: 'blocked', centavos: 1500 })],
    });
    expect(soDisponivel).toEqual([
      { tipo: TIPOS_ACHADO.DISPONIVEL_NEGATIVO, walletId: 'w1', categoria: 'pessoal', valor: -5 },
    ]);
  });

  it('categoria fora da conta: receita_taxa em usuário, outra categoria na plataforma, categoria desconhecida', () => {
    const achados = verificarConsistencia({
      agregados: [
        ag({ categoria: 'receita_taxa', centavos: 10 }),
        ag({ walletId: 'plataforma', categoria: 'pessoal', centavos: 10 }),
        ag({ categoria: 'inventada', centavos: 10 }),
      ],
    });
    const fora = achados.filter((a) => a.tipo === TIPOS_ACHADO.CATEGORIA_FORA_DA_CONTA);
    expect(fora).toEqual(
      expect.arrayContaining([
        { tipo: TIPOS_ACHADO.CATEGORIA_FORA_DA_CONTA, walletId: 'w1', categoria: 'receita_taxa' },
        { tipo: TIPOS_ACHADO.CATEGORIA_FORA_DA_CONTA, walletId: 'plataforma', categoria: 'pessoal' },
        { tipo: TIPOS_ACHADO.CATEGORIA_FORA_DA_CONTA, walletId: 'w1', categoria: 'inventada' },
      ])
    );
    expect(fora).toHaveLength(3);
  });

  it('sem categoria e sem contexto (organizacaoId ausente, bloqueada sem grupo)', () => {
    const achados = verificarConsistencia({
      semCampos: [{ walletId: 'w1', semCategoria: 2, semOrganizacao: 1, bloqueadaSemGrupo: 3 }],
    });
    expect(achados.map((a) => a.tipo)).toEqual([
      TIPOS_ACHADO.SEM_CATEGORIA,
      TIPOS_ACHADO.SEM_CONTEXTO,
      TIPOS_ACHADO.SEM_CONTEXTO,
    ]);
    expect(achados[0].detalhe).toContain('2');
  });

  it('operação incompleta (quantidade ≠ pernasTotal)', () => {
    const achados = verificarConsistencia({
      operacoesIncompletas: [{ operacaoId: 'assinatura_grupo:i1', quantidade: 1, pernasTotal: 2, walletIds: ['w1'] }],
    });
    expect(achados).toEqual([
      { tipo: TIPOS_ACHADO.OPERACAO_INCOMPLETA, operacaoId: 'assinatura_grupo:i1', walletId: 'w1', detalhe: '1 de 2 lançamento(s) gravado(s)' },
    ]);
    expect(descreverAchado(achados[0])).toContain('assinatura_grupo:i1');
  });
});
