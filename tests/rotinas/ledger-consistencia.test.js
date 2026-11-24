// Rotina ledger-consistencia (002-ledger-segmentado, T032).
// `lib/audit` é mockado só para não abrir conexão com o Mongo (o import valida env).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));

import { logAudit } from '../../lib/audit';
import { executarRotina } from '../../lib/rotinas/executor.js';
import { criarRotinaLedgerConsistencia, alertarInconsistencia } from '../../lib/rotinas/ledger-consistencia.js';
import { criarRepositorioMemoria } from '../helpers/repositorio-rotinas-memoria.js';

const vazio = { agregados: [], semCampos: [], operacoesIncompletas: [] };

describe('rotina ledger-consistencia', () => {
  it('chave diária no fuso de Brasília: 23:30 BRT ainda é o mesmo dia; 00:10 BRT é o seguinte', async () => {
    const rotina = criarRotinaLedgerConsistencia({ coletar: async () => vazio });
    // 23:30 BRT de 24/11 = 02:30 UTC de 25/11
    expect(await rotina.buscarVencidos({ agora: new Date('2026-11-25T02:30:00Z') })).toEqual([
      { chave: 'consistencia:2026-11-24', dados: {} },
    ]);
    // 00:10 BRT de 25/11 = 03:10 UTC de 25/11
    expect(await rotina.buscarVencidos({ agora: new Date('2026-11-25T03:10:00Z') })).toEqual([
      { chave: 'consistencia:2026-11-25', dados: {} },
    ]);
  });

  it('executa uma vez por dia (idempotente) e só alerta quando há achado, sem corrigir', async () => {
    const repo = criarRepositorioMemoria();
    const coletar = vi.fn(async () => ({
      ...vazio,
      agregados: [{ walletId: 'w1', categoria: 'caucao', grupoId: 'g1', type: 'debit', status: 'confirmed', centavos: 100 }],
    }));
    const alertar = vi.fn(async () => ({ adminsNotificados: 1 }));
    const rotina = criarRotinaLedgerConsistencia({ coletar, alertar });
    const contexto = { db: { marcador: true } };

    const primeira = await executarRotina(rotina, { repo, agora: new Date('2026-11-24T12:00:00Z'), contexto });
    expect(primeira).toMatchObject({ processados: 1, falhas: 0 });
    const segunda = await executarRotina(rotina, { repo, agora: new Date('2026-11-24T12:15:00Z'), contexto });
    expect(segunda).toMatchObject({ processados: 0, pulados: 1 });

    expect(coletar).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledTimes(1);
    const [, { chave, achados }] = alertar.mock.calls[0];
    expect(chave).toBe('consistencia:2026-11-24');
    expect(achados[0]).toMatchObject({ tipo: 'categoria_negativa', categoria: 'caucao', grupoId: 'g1' });

    // Dia seguinte: novo item.
    const amanha = await executarRotina(rotina, { repo, agora: new Date('2026-11-25T12:00:00Z'), contexto });
    expect(amanha).toMatchObject({ processados: 1 });
  });

  it('ledger consistente não alerta', async () => {
    const alertar = vi.fn();
    const rotina = criarRotinaLedgerConsistencia({ coletar: async () => vazio, alertar });
    await expect(rotina.processarItem({ chave: 'consistencia:2026-11-24', contexto: { db: {} } })).resolves.toBe('concluido');
    expect(alertar).not.toHaveBeenCalled();
  });

  it('erro de leitura lança (retentativa do executor)', async () => {
    const rotina = criarRotinaLedgerConsistencia({ coletar: async () => { throw new Error('banco fora'); } });
    await expect(rotina.processarItem({ chave: 'k', contexto: { db: {} } })).rejects.toThrow('banco fora');
  });

  it('alertarInconsistencia grava auditoria mesmo se a notificação falhar', async () => {
    vi.mocked(logAudit).mockClear();
    const erroLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      collection: (nome) => {
        if (nome === 'users') return { find: () => ({ toArray: async () => [{ _id: 'a1' }] }) };
        if (nome === 'notificacoesUsuario') return { insertMany: async () => { throw new Error('mongo fora'); } };
        throw new Error(`coleção inesperada: ${nome}`);
      },
    };
    await alertarInconsistencia(db, { chave: 'consistencia:2026-11-24', achados: [{ tipo: 'sem_categoria', walletId: 'w1' }] });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAudit).mock.calls[0][0]).toMatchObject({
      action: 'ledger.inconsistencia',
      details: { quantidade: 1, notificacaoFalhou: true },
    });
    erroLog.mockRestore();
  });
});
