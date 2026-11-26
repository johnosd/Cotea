// Rotina de aprovação automática de grupos (005-aprovacao-grupos, US3 · FR-015 a FR-017).
// Item = um envio de um grupo: chave `grupo:<grupoId>:envio:<n>`. Reenvio gera
// chave nova (prazo reinicia); o item do envio antigo é 'ignorado' ao revalidar,
// pelo filtro em `moderacao.envio`. Prazo: fim do 2º dia útil após o dia do envio
// (calendário da 001). Ver sdd/specs/005-aprovacao-grupos/logic/moderacao.md §4.
import { ObjectId } from 'mongodb';
import { STATUS_GRUPO, vencimentoAprovacao } from '../moderacao';
import { executarTransicao, notificarEventoModeracao } from '../moderacao-servidor';

export const ROTINA_APROVACAO_AUTOMATICA_ID = 'aprovacao-automatica-grupos';

const ACAO = 'aprovar_automatico';

export const rotinaAprovacaoAutomatica = {
  id: ROTINA_APROVACAO_AUTOMATICA_ID,
  descricao: 'Aprova automaticamente grupos em aprovação há mais de 2 dias úteis',
  ativa: true,

  async buscarVencidos({ agora, contexto = {} }) {
    const { db, datasExtras = [] } = contexto;
    if (!db) return [];
    // Filtro de prazo em JS: vencimentoDiasUteis não é expressável em query; o volume é
    // pequeno e o executor limita itens e tempo por execução.
    const grupos = await db.collection('grupos').find({ status: STATUS_GRUPO.EM_APROVACAO }).toArray();
    return grupos
      .map((g) => ({ g, vence: vencimentoAprovacao(g, { datasExtras }) }))
      .filter(({ vence }) => vence && agora.getTime() >= vence.getTime())
      .sort((a, b) => a.vence.getTime() - b.vence.getTime())
      .map(({ g }) => ({
        chave: `grupo:${g._id}:envio:${g.moderacao.envio}`,
        dados: { grupoId: String(g._id), envio: g.moderacao.envio },
      }));
  },

  async processarItem({ dados = {}, agora, contexto = {} }) {
    const { db } = contexto;
    if (!db || !ObjectId.isValid(dados.grupoId)) return 'ignorado';
    const grupoId = new ObjectId(dados.grupoId);

    const r = await executarTransicao(db, {
      grupoId,
      acao: ACAO,
      ator: { id: 'sistema', automatico: true },
      agora,
      envioEsperado: dados.envio,
    });
    if (r.ok) return 'concluido';

    // Revalidação (FR-007 da 001): reenvio, decisão manual ou outra execução venceu. Se o
    // grupo já reflete ESTA aprovação automática (queda entre gravar e notificar), renotifica
    // de forma idempotente (o _id determinístico impede duplicar).
    const atual = await db.collection('grupos').findOne({ _id: grupoId });
    const m = atual?.moderacao;
    if (atual?.status === STATUS_GRUPO.ATIVO && m?.aprovacao?.tipo === 'automatica' && m.envio === dados.envio) {
      try {
        await notificarEventoModeracao(db, {
          grupo: atual,
          evento: { acao: ACAO, envio: dados.envio, em: m.aprovacao.em },
          destino: 'dono',
        });
      } catch (erro) {
        console.error('Falha ao renotificar aprovacao automatica:', erro?.message || erro);
      }
    }
    return 'ignorado';
  },
};
