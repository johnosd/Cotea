// Rotina de liquidação de participações (006-checkout-caucao, D-07 · logic §9).
// Rede de segurança do que a requisição não terminou (FR-022: até 1 hora; o agendador
// roda a cada 15 minutos). Usa as mesmas operações do ledger das requisições, então nada é
// devolvido nem consumido duas vezes.
//
// Itens (as condições que os geram não voltam atrás):
//   - `liquidar:<participacaoId>` — caução bloqueada em grupo cancelado, rejeitado ou
//     excluído, ou de membro banido;
//   - `liberar:<participacaoId>` — mensalidade retida de quem já tem direito à liberação
//     (grupo lotado ou acesso enviado).
import { ObjectId } from 'mongodb';
import { STATUS_GRUPO } from '../moderacao';
import { planejarLiquidacao } from '../checkout';
import { liberarParticipacao, liquidarParticipacao } from '../checkout-servidor';

export const ROTINA_LIQUIDACAO_ID = 'liquidacao-participacoes';

const ENCERRADOS = [STATUS_GRUPO.CANCELADO, STATUS_GRUPO.REJEITADO];

/**
 * Por que a participação precisa ser liquidada, ou null.
 * `remover` só quando o grupo não existe mais: o registro de um banido barra a volta.
 */
function motivoDeLiquidar(membro, grupo) {
  if (membro?.caucao?.situacao !== 'bloqueada') return null;
  if (!grupo) return { motivo: 'grupo_excluido', remover: true };
  if (ENCERRADOS.includes(grupo.status)) return { motivo: 'grupo_cancelado', remover: false };
  if (membro.status === 'banido') return { motivo: 'banido', remover: false };
  return null;
}

/** Retenção que já pode ser consumida num grupo que continua de pé. */
function podeLiberar(membro, grupo) {
  if (!grupo || ENCERRADOS.includes(grupo.status)) return false;
  const plano = planejarLiquidacao({ membro, grupo });
  return plano.retido > 0 && plano.liberada;
}

export const rotinaLiquidacaoParticipacoes = {
  id: ROTINA_LIQUIDACAO_ID,
  descricao: 'Devolve cauções pendentes (grupos cancelados ou excluídos, banidos) e libera mensalidades retidas',
  ativa: true,

  async buscarVencidos({ contexto = {} }) {
    const { db } = contexto;
    if (!db) return [];
    const colecao = db.collection('membrosGrupo');
    const comCaucao = await colecao.find({ 'caucao.situacao': 'bloqueada' }).toArray();
    const comRetencao = await colecao.find({ 'retencao.situacao': { $in: ['retida', 'a_liberar'] } }).toArray();
    const todos = [...comCaucao, ...comRetencao];
    if (todos.length === 0) return [];
    const grupos = await db.collection('grupos')
      .find({ _id: { $in: todos.map((m) => m.grupoId) } })
      .toArray();
    const porId = new Map(grupos.map((g) => [String(g._id), g]));
    const grupoDe = (m) => porId.get(String(m.grupoId));
    const item = (acao, m) => ({ chave: `${acao}:${m._id}`, dados: { acao, membroId: String(m._id) } });

    return [
      ...comCaucao.filter((m) => motivoDeLiquidar(m, grupoDe(m))).map((m) => item('liquidar', m)),
      ...comRetencao.filter((m) => podeLiberar(m, grupoDe(m))).map((m) => item('liberar', m)),
    ];
  },

  async processarItem({ dados = {}, contexto = {} }) {
    const { db } = contexto;
    if (!db || !ObjectId.isValid(dados.membroId)) return 'ignorado';
    const membroId = new ObjectId(dados.membroId);

    // Erros propagam: o executor repete e alerta os admins.
    if (dados.acao === 'liberar') {
      return (await liberarParticipacao({ db, membroId })) ? 'concluido' : 'ignorado';
    }

    const membro = await db.collection('membrosGrupo').findOne({ _id: membroId });
    if (!membro) return 'ignorado';
    const grupo = await db.collection('grupos').findOne({ _id: membro.grupoId });
    const decisao = motivoDeLiquidar(membro, grupo);
    if (!decisao) return 'ignorado';
    await liquidarParticipacao({ db, membroId, motivo: decisao.motivo, remover: decisao.remover });
    return 'concluido';
  },
};
