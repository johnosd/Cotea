// Testes adicionais do executor (T014) — não travados.
import { describe, it, expect, vi } from 'vitest';
import { executarRotina, MAX_TENTATIVAS } from '../../lib/rotinas/executor.js';
import { criarRepositorioMemoria } from '../helpers/repositorio-rotinas-memoria.js';

const AGORA = new Date('2026-11-20T13:00:00Z');
const MIN = 60 * 1000;

const rotinaCom = (itens, processar = async () => 'concluido') => ({
  id: 'extra',
  descricao: 'teste',
  buscarVencidos: async () => itens,
  processarItem: processar,
});

describe('executor — casos adicionais', () => {
  it('reassume item processando quando o lease expirou e pula enquanto vigente', async () => {
    const repo = criarRepositorioMemoria();
    // Simula execução que morreu no meio: item ficou "processando" com lease de 10 min.
    await repo.reivindicarItem({ rotinaId: 'extra', chave: 'x', dados: {}, agora: AGORA, leaseMs: 10 * MIN });
    const processar = vi.fn(async () => 'concluido');
    const rotina = rotinaCom([{ chave: 'x' }], processar);

    const durante = await executarRotina(rotina, { repo, agora: new Date(AGORA.getTime() + 5 * MIN) });
    expect(durante).toMatchObject({ processados: 0, pulados: 1 });

    const depois = await executarRotina(rotina, { repo, agora: new Date(AGORA.getTime() + 11 * MIN) });
    expect(depois).toMatchObject({ processados: 1, pulados: 0 });
    expect(processar).toHaveBeenCalledTimes(1);
  });

  it('buscarVencidos que lança finaliza a execução com erro, sem relançar', async () => {
    const repo = criarRepositorioMemoria();
    const rotina = { id: 'extra', descricao: 't', buscarVencidos: async () => { throw new Error('banco fora'); }, processarItem: vi.fn() };
    const r = await executarRotina(rotina, { repo, agora: AGORA });
    expect(r).toMatchObject({ resultado: 'erro', processados: 0, falhas: 0, erro: 'banco fora' });
    expect(repo._execucoes()[0]).toMatchObject({ resultado: 'erro', erro: 'banco fora' });
    expect(repo._execucoes()[0].fim).toBeInstanceOf(Date);
  });

  it('respeita o limite de itens por execução e processa o restante depois', async () => {
    const repo = criarRepositorioMemoria();
    const itens = Array.from({ length: 5 }, (_, i) => ({ chave: `i${i}` }));
    const rotina = rotinaCom(itens);
    expect(await executarRotina(rotina, { repo, agora: AGORA, limite: 3 })).toMatchObject({ processados: 3 });
    expect(await executarRotina(rotina, { repo, agora: AGORA, limite: 3 })).toMatchObject({ processados: 0, pulados: 3 });
    // Itens já concluídos ocupam o limite; com limite maior, os restantes saem.
    expect(await executarRotina(rotina, { repo, agora: AGORA })).toMatchObject({ processados: 2, pulados: 3 });
  });

  it('falha no alertar não altera contagens nem relança', async () => {
    const repo = criarRepositorioMemoria();
    const rotina = rotinaCom([{ chave: 'q' }], async () => { throw new Error('x'); });
    const alertar = vi.fn(async () => { throw new Error('smtp fora'); });
    const erroLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    let ultimo;
    for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
      ultimo = await executarRotina(rotina, { repo, agora: new Date(AGORA.getTime() + i * 60 * MIN), alertar });
    }
    expect(ultimo).toMatchObject({ falhas: 1, resultado: 'erro' });
    expect(alertar).toHaveBeenCalledTimes(1);
    expect((await repo.obterItem({ rotinaId: 'extra', chave: 'q' })).situacao).toBe('falha_definitiva');
    erroLog.mockRestore();
  });

  it('retorno diferente de "ignorado" conta como concluído e o erro é truncado em 500', async () => {
    const repo = criarRepositorioMemoria();
    const rotina = rotinaCom([{ chave: 'a' }, { chave: 'b' }], async ({ chave }) => {
      if (chave === 'b') throw new Error('e'.repeat(800));
      return undefined;
    });
    const r = await executarRotina(rotina, { repo, agora: AGORA });
    expect(r).toMatchObject({ processados: 1, falhas: 1, resultado: 'parcial' });
    expect((await repo.obterItem({ rotinaId: 'extra', chave: 'a' })).situacao).toBe('concluido');
    expect((await repo.obterItem({ rotinaId: 'extra', chave: 'b' })).ultimoErro).toHaveLength(500);
  });

  it('exige repo', async () => {
    await expect(executarRotina(rotinaCom([]), {})).rejects.toThrow(TypeError);
  });
});
