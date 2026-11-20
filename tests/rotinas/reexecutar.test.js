// Testes de reexecução manual (T024, FR-018) — não travados.
import { describe, it, expect, vi } from 'vitest';
import { executarRotina, reexecutarItem, MAX_TENTATIVAS } from '../../lib/rotinas/executor.js';
import { criarRepositorioMemoria } from '../helpers/repositorio-rotinas-memoria.js';

const AGORA = new Date('2026-11-20T13:00:00Z');
const HORA = 60 * 60 * 1000;

async function levarAFalhaDefinitiva(repo, rotina) {
  for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
    await executarRotina(rotina, { repo, agora: new Date(AGORA.getTime() + i * HORA) });
  }
}

describe('reexecutarItem', () => {
  it('zera tentativas e processa com os dados gravados', async () => {
    const repo = criarRepositorioMemoria();
    let quebrado = true;
    const processar = vi.fn(async () => {
      if (quebrado) throw new Error('fora do ar');
      return 'concluido';
    });
    const rotina = { id: 'r', descricao: 't', buscarVencidos: async () => [{ chave: 'k', dados: { valor: 42 } }], processarItem: processar };
    await levarAFalhaDefinitiva(repo, rotina);
    expect((await repo.obterItem({ rotinaId: 'r', chave: 'k' })).situacao).toBe('falha_definitiva');

    // Ainda quebrado: volta a falhar com contagem zerada (tentativas = 1)
    const r1 = await reexecutarItem(rotina, 'k', { repo, agora: new Date(AGORA.getTime() + 10 * HORA), autorId: 'adm' });
    expect(r1).toMatchObject({ chave: 'k', situacao: 'falha', reprocessado: true });
    expect((await repo.obterItem({ rotinaId: 'r', chave: 'k' })).tentativas).toBe(1);

    quebrado = false;
    const r2 = await reexecutarItem(rotina, 'k', { repo, agora: new Date(AGORA.getTime() + 11 * HORA), autorId: 'adm' });
    expect(r2).toMatchObject({ situacao: 'concluido', reprocessado: true });
    expect(processar).toHaveBeenLastCalledWith(expect.objectContaining({ chave: 'k', dados: { valor: 42 } }));

    const manuais = repo._execucoes().filter((e) => e.origem === 'manual');
    expect(manuais).toHaveLength(2);
    expect(manuais[0]).toMatchObject({ rotinaId: 'r', autorId: 'adm' });
  });

  it('item concluído não é reprocessado', async () => {
    const repo = criarRepositorioMemoria();
    const processar = vi.fn(async () => 'concluido');
    const rotina = { id: 'r', descricao: 't', buscarVencidos: async () => [{ chave: 'k' }], processarItem: processar };
    await executarRotina(rotina, { repo, agora: AGORA });
    const r = await reexecutarItem(rotina, 'k', { repo, agora: AGORA });
    expect(r).toEqual({ chave: 'k', situacao: 'concluido', reprocessado: false });
    expect(processar).toHaveBeenCalledTimes(1);
  });

  it('item em processamento com lease vigente não é reprocessado', async () => {
    const repo = criarRepositorioMemoria();
    await repo.reivindicarItem({ rotinaId: 'r', chave: 'k', dados: {}, agora: AGORA, leaseMs: HORA });
    const processar = vi.fn();
    const rotina = { id: 'r', descricao: 't', buscarVencidos: async () => [], processarItem: processar };
    const r = await reexecutarItem(rotina, 'k', { repo, agora: AGORA });
    expect(r).toMatchObject({ situacao: 'processando', reprocessado: false });
    expect(processar).not.toHaveBeenCalled();
  });

  it('item inexistente lança erro identificável', async () => {
    const repo = criarRepositorioMemoria();
    const rotina = { id: 'r', descricao: 't', buscarVencidos: async () => [], processarItem: vi.fn() };
    await expect(reexecutarItem(rotina, 'nada', { repo, agora: AGORA })).rejects.toMatchObject({ code: 'ITEM_NAO_ENCONTRADO' });
  });
});
