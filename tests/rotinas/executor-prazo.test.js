// T035 — orçamento de tempo de uma passada do executor (não travado).
import { describe, it, expect, vi } from 'vitest';
import { executarRotina } from '../../lib/rotinas/executor.js';
import { criarRepositorioMemoria } from '../helpers/repositorio-rotinas-memoria.js';

const AGORA = new Date('2026-11-24T13:00:00Z');

// Relógio falso: só avança quando o processamento de um item "gasta" tempo.
function montar(qtd, custoMs) {
  let t = 0;
  const processar = vi.fn(async () => {
    t += custoMs;
    return 'concluido';
  });
  const rotina = {
    id: 'prazo',
    descricao: 'teste',
    buscarVencidos: async () => Array.from({ length: qtd }, (_, i) => ({ chave: `i${i}` })),
    processarItem: processar,
  };
  return { rotina, processar, relogio: () => t };
}

describe('executor — orçamento de tempo (prazoMs)', () => {
  it('corta a passada ao estourar o prazo e o restante sai na execução seguinte', async () => {
    const repo = criarRepositorioMemoria();
    const { rotina, processar, relogio } = montar(5, 10);

    // t=0,10,20 < 25 → 3 itens; em t=30 >= 25 o 4º não é reivindicado.
    const r1 = await executarRotina(rotina, { repo, agora: AGORA, prazoMs: 25, relogio });
    expect(r1).toMatchObject({ resultado: 'sucesso', processados: 3, pulados: 0, cortada: true, restantes: 2 });
    expect(processar).toHaveBeenCalledTimes(3);
    expect(repo._itens()).toHaveLength(3); // os 2 cortados nem foram reivindicados

    // Próxima execução (sem orçamento): processa só os 2 que sobraram; os 3 antigos são pulados.
    const r2 = await executarRotina(rotina, { repo, agora: AGORA });
    expect(r2).toMatchObject({ processados: 2, pulados: 3 });
    expect(r2.cortada).toBeUndefined();
    expect(processar).toHaveBeenCalledTimes(5);
    expect(repo._itens().every((i) => i.situacao === 'concluido')).toBe(true);
  });

  it('sem prazoMs não corta, mesmo com relógio avançando muito', async () => {
    const repo = criarRepositorioMemoria();
    const { rotina, relogio } = montar(4, 1_000_000);
    const r = await executarRotina(rotina, { repo, agora: AGORA, relogio });
    expect(r).toMatchObject({ processados: 4 });
    expect(r.cortada).toBeUndefined();
    expect(r.restantes).toBeUndefined();
  });

  it.each([0, -5, NaN, undefined, null, '30'])('ignora prazoMs inválido (%s)', async (prazoMs) => {
    const repo = criarRepositorioMemoria();
    const { rotina, relogio } = montar(3, 1_000_000);
    const r = await executarRotina(rotina, { repo, agora: AGORA, prazoMs, relogio });
    expect(r).toMatchObject({ processados: 3 });
    expect(r.cortada).toBeUndefined();
  });

  it('sempre tenta o 1º item, mesmo com o prazo já estourado (progresso garantido)', async () => {
    const repo = criarRepositorioMemoria();
    const { rotina, processar, relogio } = montar(3, 100);
    const r = await executarRotina(rotina, { repo, agora: AGORA, prazoMs: 1, relogio });
    expect(processar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ processados: 1, cortada: true, restantes: 2 });
  });

  it('não marca como cortada quando o último item termina exatamente dentro do prazo', async () => {
    const repo = criarRepositorioMemoria();
    const { rotina, relogio } = montar(3, 10);
    // t antes dos itens: 0, 10, 20; todos < 100 → nada a cortar.
    const r = await executarRotina(rotina, { repo, agora: AGORA, prazoMs: 100, relogio });
    expect(r).toMatchObject({ processados: 3 });
    expect(r.cortada).toBeUndefined();
  });

  it('o tempo gasto em buscarVencidos também conta no orçamento', async () => {
    const repo = criarRepositorioMemoria();
    let t = 0;
    const rotina = {
      id: 'prazo',
      descricao: 'teste',
      buscarVencidos: async () => {
        t += 50; // consulta lenta
        return [{ chave: 'a' }, { chave: 'b' }];
      },
      processarItem: vi.fn(async () => 'concluido'),
    };
    const r = await executarRotina(rotina, { repo, agora: AGORA, prazoMs: 40, relogio: () => t });
    expect(r).toMatchObject({ processados: 1, cortada: true, restantes: 1 });
  });
});
