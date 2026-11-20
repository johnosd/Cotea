// Repositório de rotinas em memória — helper de teste da feature
// 001-rotinas-agendadas, TRAVADO junto com os testes de contrato.
// Define a interface (porta) que lib/rotinas/repositorio-mongo.js também
// DEVE seguir. Atomicidade: cada método faz check-and-set sem `await` no meio,
// o que é atômico no event loop — equivalente ao findOneAndUpdate do Mongo.

const FINAIS = new Set(['concluido', 'ignorado', 'falha_definitiva']);

export function criarRepositorioMemoria() {
  const itens = new Map(); // `${rotinaId}::${chave}` -> registro
  const execucoes = new Map(); // id -> execução
  let seq = 0;
  const k = (rotinaId, chave) => `${rotinaId}::${chave}`;

  return {
    /**
     * Tenta assumir o item para processamento.
     * @returns {Promise<{ reivindicado: true, registro: object } |
     *   { reivindicado: false, motivo: 'concluido'|'ignorado'|'falha_definitiva'|'em_processamento' }>}
     */
    async reivindicarItem({ rotinaId, chave, dados = {}, agora, leaseMs }) {
      const id = k(rotinaId, chave);
      const atual = itens.get(id);
      if (atual && FINAIS.has(atual.situacao)) return { reivindicado: false, motivo: atual.situacao };
      if (atual && atual.situacao === 'processando' && atual.travadoAte > agora.getTime()) {
        return { reivindicado: false, motivo: 'em_processamento' };
      }
      const registro = {
        rotinaId,
        chave,
        dados: atual?.dados ?? dados,
        tentativas: atual?.tentativas ?? 0,
        ultimoErro: atual?.ultimoErro ?? null,
        situacao: 'processando',
        travadoAte: agora.getTime() + leaseMs,
        concluidoEm: null,
        criadoEm: atual?.criadoEm ?? agora,
        atualizadoEm: agora,
      };
      itens.set(id, registro);
      return { reivindicado: true, registro: { ...registro } };
    },

    /** situacao: 'concluido' | 'ignorado' */
    async concluirItem({ rotinaId, chave, situacao, agora }) {
      const r = itens.get(k(rotinaId, chave));
      if (!r) throw new Error(`item inexistente: ${rotinaId}/${chave}`);
      Object.assign(r, { situacao, travadoAte: 0, concluidoEm: agora, atualizadoEm: agora });
    },

    /** Incrementa tentativas; vira 'falha_definitiva' ao atingir maxTentativas. */
    async registrarFalhaItem({ rotinaId, chave, erro, agora, maxTentativas }) {
      const r = itens.get(k(rotinaId, chave));
      if (!r) throw new Error(`item inexistente: ${rotinaId}/${chave}`);
      r.tentativas += 1;
      r.ultimoErro = String(erro);
      r.travadoAte = 0;
      r.atualizadoEm = agora;
      const definitiva = r.tentativas >= maxTentativas;
      r.situacao = definitiva ? 'falha_definitiva' : 'falha';
      return { tentativas: r.tentativas, definitiva };
    },

    /** Reexecução manual: zera tentativas de um item em falha/falha_definitiva. */
    async reabrirItem({ rotinaId, chave, agora }) {
      const r = itens.get(k(rotinaId, chave));
      if (!r) return null;
      if (r.situacao === 'falha' || r.situacao === 'falha_definitiva') {
        Object.assign(r, { situacao: 'falha', tentativas: 0, travadoAte: 0, atualizadoEm: agora });
      }
      return { ...r };
    },

    async obterItem({ rotinaId, chave }) {
      const r = itens.get(k(rotinaId, chave));
      return r ? { ...r } : null;
    },

    async iniciarExecucao({ rotinaId, origem, autorId = null, inicio }) {
      seq += 1;
      const id = `exec-${seq}`;
      execucoes.set(id, { _id: id, rotinaId, origem, autorId, inicio, fim: null, resultado: null });
      return id;
    },

    async finalizarExecucao(id, { fim, resultado, processados, ignorados, falhas, pulados, erro = null }) {
      const e = execucoes.get(id);
      if (!e) throw new Error(`execução inexistente: ${id}`);
      Object.assign(e, { fim, resultado, processados, ignorados, falhas, pulados, erro });
    },

    // Inspeção (só testes)
    _itens: () => [...itens.values()].map((r) => ({ ...r })),
    _execucoes: () => [...execucoes.values()].map((e) => ({ ...e })),
  };
}
