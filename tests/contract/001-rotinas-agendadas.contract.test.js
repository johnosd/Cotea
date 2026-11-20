// Testes de contrato da feature 001-rotinas-agendadas.
// TRAVADOS pelo sdd-plan (contract-tests.lock): o sdd-execute só pode fazê-los
// passar, nunca editá-los. Interface pública: lib/calendario.js e
// lib/rotinas/executor.js; repositório fake em tests/helpers.
import { describe, it, expect, vi } from 'vitest';
import {
  feriadosNacionais,
  ehDiaUtil,
  vencimentoDiasCorridos,
  vencimentoDiasUteis,
  prazoVencido,
} from '../../lib/calendario.js';
import { executarRotina } from '../../lib/rotinas/executor.js';
import { criarRepositorioMemoria } from '../helpers/repositorio-rotinas-memoria.js';

const brt = (local) => new Date(`${local}-03:00`); // horário de Brasília (sem horário de verão desde 2019)
const iso = (data) => data.toISOString();
const HORA = 60 * 60 * 1000;

function rotinaDeTeste({ id = 'teste', itens, processar }) {
  return {
    id,
    descricao: 'Rotina de teste do contrato',
    buscarVencidos: async ({ agora }) =>
      itens.filter((i) => i.venceEm.getTime() <= agora.getTime()).map(({ chave }) => ({ chave, dados: { chave } })),
    processarItem: processar,
  };
}

describe('001-rotinas-agendadas — contrato', () => {
  // US1-AC1, US1-AC2 · FR-001, FR-002, FR-003, FR-008
  it('processa só os itens vencidos e não repete efeito ao rodar de novo', async () => {
    const repo = criarRepositorioMemoria();
    const base = brt('2026-11-20T10:00:00');
    const itens = [
      { chave: 'v1', venceEm: new Date(base.getTime() - 3 * HORA) },
      { chave: 'v2', venceEm: new Date(base.getTime() - 2 * HORA) },
      { chave: 'v3', venceEm: base },
      { chave: 'f1', venceEm: new Date(base.getTime() + 5 * HORA) },
      { chave: 'f2', venceEm: new Date(base.getTime() + 6 * HORA) },
    ];
    const processar = vi.fn(async () => 'concluido');
    const rotina = rotinaDeTeste({ itens, processar });

    const r1 = await executarRotina(rotina, { repo, agora: base });
    expect(r1).toMatchObject({ resultado: 'sucesso', processados: 3, ignorados: 0, falhas: 0 });
    expect(processar.mock.calls.map(([ctx]) => ctx.chave).sort()).toEqual(['v1', 'v2', 'v3']);

    const r2 = await executarRotina(rotina, { repo, agora: new Date(base.getTime() + HORA) });
    expect(processar).toHaveBeenCalledTimes(3);
    expect(r2).toMatchObject({ processados: 0, pulados: 3 });

    const situacoes = Object.fromEntries(repo._itens().map((i) => [i.chave, i.situacao]));
    expect(situacoes).toEqual({ v1: 'concluido', v2: 'concluido', v3: 'concluido' });
    expect(repo._execucoes()).toHaveLength(2);
    expect(repo._execucoes()[0]).toMatchObject({ rotinaId: 'teste', origem: 'automatica', resultado: 'sucesso', processados: 3 });
  });

  // US1-AC3 · FR-003 (execuções simultâneas)
  it('duas execuções simultâneas processam cada item com efeito uma única vez', async () => {
    const repo = criarRepositorioMemoria();
    const agora = brt('2026-11-20T10:00:00');
    const itens = ['a', 'b', 'c'].map((chave) => ({ chave, venceEm: new Date(agora.getTime() - HORA) }));
    const processar = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'concluido';
    });
    const rotina = rotinaDeTeste({ itens, processar });

    const [r1, r2] = await Promise.all([
      executarRotina(rotina, { repo, agora }),
      executarRotina(rotina, { repo, agora, origem: 'manual', autorId: 'admin-1' }),
    ]);

    const porChave = processar.mock.calls.reduce((acc, [ctx]) => ({ ...acc, [ctx.chave]: (acc[ctx.chave] || 0) + 1 }), {});
    expect(porChave).toEqual({ a: 1, b: 1, c: 1 });
    expect(r1.processados + r2.processados).toBe(3);
    expect(r1.pulados + r2.pulados).toBe(3);
  });

  // US3-AC2, US3-AC3 · FR-005, FR-006, FR-007
  it('isola falhas, retenta até 5 vezes, vira falha definitiva e alerta uma única vez', async () => {
    const repo = criarRepositorioMemoria();
    const inicio = brt('2026-11-20T10:00:00');
    const itens = ['ok', 'quebra', 'ignora'].map((chave) => ({ chave, venceEm: new Date(inicio.getTime() - HORA) }));
    const processar = vi.fn(async ({ chave }) => {
      if (chave === 'quebra') throw new Error('falha simulada');
      return chave === 'ignora' ? 'ignorado' : 'concluido';
    });
    const alertar = vi.fn(async () => {});
    const rotina = rotinaDeTeste({ itens, processar });

    const r1 = await executarRotina(rotina, { repo, agora: inicio, alertar });
    expect(r1).toMatchObject({ resultado: 'parcial', processados: 1, ignorados: 1, falhas: 1 });

    for (let i = 1; i <= 5; i += 1) {
      await executarRotina(rotina, { repo, agora: new Date(inicio.getTime() + i * HORA), alertar });
    }

    const chamadas = (c) => processar.mock.calls.filter(([ctx]) => ctx.chave === c).length;
    expect(chamadas('ok')).toBe(1);
    expect(chamadas('ignora')).toBe(1);
    expect(chamadas('quebra')).toBe(5);

    const quebra = await repo.obterItem({ rotinaId: 'teste', chave: 'quebra' });
    expect(quebra).toMatchObject({ situacao: 'falha_definitiva', tentativas: 5 });
    expect(quebra.ultimoErro).toContain('falha simulada');
    expect((await repo.obterItem({ rotinaId: 'teste', chave: 'ignora' })).situacao).toBe('ignorado');

    expect(alertar).toHaveBeenCalledTimes(1);
    expect(alertar).toHaveBeenCalledWith(expect.objectContaining({ rotinaId: 'teste', chave: 'quebra', tentativas: 5 }));
  });

  // US2-AC1..AC5 · FR-010, FR-011, FR-012, FR-013 · SC-004
  it('calcula vencimentos em dias corridos e úteis no horário de Brasília', () => {
    expect([...feriadosNacionais(2026)].sort()).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07',
      '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
    ]);

    // Corridos: instante exato + N × 24h
    expect(iso(vencimentoDiasCorridos(brt('2026-11-03T14:30:00'), 5))).toBe(iso(brt('2026-11-08T14:30:00')));

    // Úteis: 23:59:59.999 (Brasília) do N-ésimo dia útil após o dia do evento
    expect(iso(vencimentoDiasUteis(brt('2026-11-13T18:00:00'), 2))).toBe('2026-11-18T02:59:59.999Z'); // sexta → terça
    expect(iso(vencimentoDiasUteis(brt('2026-11-18T10:00:00'), 2))).toBe('2026-11-24T02:59:59.999Z'); // pula 20/11 e fim de semana
    expect(iso(vencimentoDiasUteis(brt('2026-04-02T10:00:00'), 1))).toBe('2026-04-07T02:59:59.999Z'); // pula Sexta-feira Santa
    expect(iso(vencimentoDiasUteis(brt('2026-11-07T10:00:00'), 2))).toBe('2026-11-11T02:59:59.999Z'); // evento no sábado
    expect(iso(vencimentoDiasUteis(brt('2026-11-10T23:59:59'), 1))).toBe('2026-11-12T02:59:59.999Z'); // 23:59:59 local já é 11/11 em UTC
    expect(iso(vencimentoDiasUteis(brt('2026-12-30T09:00:00'), 2))).toBe('2027-01-05T02:59:59.999Z'); // virada de ano
  });

  // US4-AC1 · FR-012, FR-014 (calendário vigente no momento da verificação)
  it('considera datas extras e o calendário atual ao verificar se o prazo venceu', () => {
    const evento = brt('2026-02-13T10:00:00'); // sexta; 17/02/2026 é terça de Carnaval
    const carnaval = ['2026-02-17'];

    expect(ehDiaUtil('2026-02-17')).toBe(true);
    expect(ehDiaUtil('2026-02-17', { datasExtras: carnaval })).toBe(false);
    expect(ehDiaUtil('2026-11-20')).toBe(false);

    expect(iso(vencimentoDiasUteis(evento, 2))).toBe('2026-02-18T02:59:59.999Z');
    expect(iso(vencimentoDiasUteis(evento, 2, { datasExtras: carnaval }))).toBe('2026-02-19T02:59:59.999Z');

    const agora = brt('2026-02-18T12:00:00');
    expect(prazoVencido({ evento, dias: 2, tipo: 'uteis', agora })).toBe(true);
    expect(prazoVencido({ evento, dias: 2, tipo: 'uteis', agora, datasExtras: carnaval })).toBe(false);

    const venc = vencimentoDiasCorridos(evento, 5);
    expect(prazoVencido({ evento, dias: 5, tipo: 'corridos', agora: venc })).toBe(true);
    expect(prazoVencido({ evento, dias: 5, tipo: 'corridos', agora: new Date(venc.getTime() - 1) })).toBe(false);
  });
});
