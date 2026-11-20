// Repositório Mongo das rotinas agendadas (feature 001-rotinas-agendadas).
// Replica EXATAMENTE a interface de tests/helpers/repositorio-rotinas-memoria.js
// (D-04). Recebe `db` por parâmetro — não importa lib/mongodb.js.
// Atenção: no driver mongodb v6, findOneAndUpdate retorna o documento direto
// (sem `.value`) — R-007.
import { randomUUID } from 'crypto';

const FINAIS = ['concluido', 'ignorado', 'falha_definitiva'];

export function criarRepositorioMongo(db) {
  const itens = db.collection('rotinaItens');
  const execucoes = db.collection('rotinaExecucoes');

  return {
    async reivindicarItem({ rotinaId, chave, dados = {}, agora, leaseMs }) {
      try {
        // Upsert com filtro que só casa itens não finais e sem lease vigente.
        // Item final/travado: o filtro não casa, o upsert tenta inserir e o
        // índice único { rotinaId, chave } devolve E11000 → não reivindicado.
        const registro = await itens.findOneAndUpdate(
          {
            rotinaId,
            chave,
            situacao: { $nin: FINAIS },
            $or: [{ situacao: { $ne: 'processando' } }, { travadoAte: { $lte: agora } }],
          },
          {
            $set: {
              situacao: 'processando',
              travadoAte: new Date(agora.getTime() + leaseMs),
              atualizadoEm: agora,
            },
            $setOnInsert: {
              _id: randomUUID(),
              dados,
              tentativas: 0,
              ultimoErro: null,
              concluidoEm: null,
              criadoEm: agora,
            },
          },
          { upsert: true, returnDocument: 'after' }
        );
        return { reivindicado: true, registro };
      } catch (error) {
        if (error?.code !== 11000) throw error;
        const atual = await itens.findOne({ rotinaId, chave });
        return {
          reivindicado: false,
          motivo: FINAIS.includes(atual?.situacao) ? atual.situacao : 'em_processamento',
        };
      }
    },

    async concluirItem({ rotinaId, chave, situacao, agora }) {
      const resultado = await itens.updateOne(
        { rotinaId, chave },
        { $set: { situacao, travadoAte: null, concluidoEm: agora, atualizadoEm: agora } }
      );
      if (resultado.matchedCount === 0) throw new Error(`item inexistente: ${rotinaId}/${chave}`);
    },

    async registrarFalhaItem({ rotinaId, chave, erro, agora, maxTentativas }) {
      // Pipeline de update: incrementa e decide a situação numa única operação atômica.
      const registro = await itens.findOneAndUpdate(
        { rotinaId, chave },
        [
          {
            $set: {
              tentativas: { $add: [{ $ifNull: ['$tentativas', 0] }, 1] },
              ultimoErro: { $literal: String(erro) },
              travadoAte: null,
              atualizadoEm: agora,
            },
          },
          {
            $set: {
              situacao: {
                $cond: [{ $gte: ['$tentativas', maxTentativas] }, 'falha_definitiva', 'falha'],
              },
            },
          },
        ],
        { returnDocument: 'after' }
      );
      if (!registro) throw new Error(`item inexistente: ${rotinaId}/${chave}`);
      return { tentativas: registro.tentativas, definitiva: registro.situacao === 'falha_definitiva' };
    },

    async reabrirItem({ rotinaId, chave, agora }) {
      await itens.updateOne(
        { rotinaId, chave, situacao: { $in: ['falha', 'falha_definitiva'] } },
        { $set: { situacao: 'falha', tentativas: 0, travadoAte: null, atualizadoEm: agora } }
      );
      return itens.findOne({ rotinaId, chave });
    },

    async obterItem({ rotinaId, chave }) {
      return itens.findOne({ rotinaId, chave });
    },

    async iniciarExecucao({ rotinaId, origem, autorId = null, inicio }) {
      const _id = randomUUID();
      await execucoes.insertOne({
        _id,
        rotinaId,
        origem,
        autorId: autorId ? String(autorId) : null,
        inicio,
        fim: null,
        resultado: null,
        processados: 0,
        ignorados: 0,
        falhas: 0,
        pulados: 0,
        erro: null,
      });
      return _id;
    },

    async finalizarExecucao(id, { fim, resultado, processados, ignorados, falhas, pulados, erro = null }) {
      const r = await execucoes.updateOne(
        { _id: id },
        { $set: { fim, resultado, processados, ignorados, falhas, pulados, erro } }
      );
      if (r.matchedCount === 0) throw new Error(`execução inexistente: ${id}`);
    },
  };
}
