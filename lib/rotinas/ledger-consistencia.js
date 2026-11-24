// Rotina diária de conferência do ledger (002-ledger-segmentado, US4 · D-13).
// Um item por dia (data de Brasília); o agendador chama a cada 15 min e a
// idempotência do executor (001) garante uma conferência por dia.
// Só ALERTA (notificação a admins + auditoria); nunca corrige.
// Ver sdd/specs/002-ledger-segmentado/logic/ledger.md §9.
import { logAudit } from '../audit';
import { dataLocalBrasilia } from '../calendario';
import { CATEGORIAS_BLOQUEADAS } from '../ledger/categorias';
import { verificarConsistencia, descreverAchado } from '../ledger/consistencia';

const MAX_ACHADOS_AUDITORIA = 50;
const MAX_ACHADOS_MENSAGEM = 5;

/** Lê do banco, em 3 agregações, o que verificarConsistencia precisa. */
export async function coletarDadosConsistencia(db) {
  const col = db.collection('walletTransactions');
  const bloqueadas = [...CATEGORIAS_BLOQUEADAS];

  const agregados = (
    await col
      .aggregate([
        {
          $group: {
            _id: { walletId: '$walletId', categoria: '$categoria', grupoId: '$grupoId', type: '$type', status: '$status' },
            centavos: { $sum: { $round: [{ $multiply: [{ $toDouble: '$amount' }, 100] }, 0] } },
          },
        },
      ])
      .toArray()
  ).map((g) => ({
    walletId: g._id.walletId,
    categoria: g._id.categoria ?? null,
    grupoId: g._id.grupoId ?? null,
    type: g._id.type,
    status: g._id.status,
    centavos: g.centavos,
  }));

  const ausente = (campo) => ({ $eq: [{ $type: campo }, 'missing'] });
  const semGrupo = { $and: [{ $in: ['$categoria', bloqueadas] }, { $in: [{ $ifNull: ['$grupoId', null] }, [null, '']] }] };
  const semCampos = (
    await col
      .aggregate([
        {
          $match: {
            $or: [
              { categoria: { $exists: false } },
              { organizacaoId: { $exists: false } },
              { categoria: { $in: bloqueadas }, grupoId: { $in: [null, ''] } },
            ],
          },
        },
        {
          $group: {
            _id: '$walletId',
            semCategoria: { $sum: { $cond: [ausente('$categoria'), 1, 0] } },
            semOrganizacao: { $sum: { $cond: [ausente('$organizacaoId'), 1, 0] } },
            bloqueadaSemGrupo: { $sum: { $cond: [semGrupo, 1, 0] } },
          },
        },
      ])
      .toArray()
  ).map((g) => ({ walletId: g._id, semCategoria: g.semCategoria, semOrganizacao: g.semOrganizacao, bloqueadaSemGrupo: g.bloqueadaSemGrupo }));

  const operacoesIncompletas = (
    await col
      .aggregate([
        { $match: { operacaoId: { $type: 'string' } } },
        {
          $group: {
            _id: '$operacaoId',
            quantidade: { $sum: 1 },
            pernasTotal: { $max: '$pernasTotal' },
            walletIds: { $addToSet: '$walletId' },
          },
        },
        { $match: { $expr: { $ne: ['$quantidade', '$pernasTotal'] } } },
      ])
      .toArray()
  ).map((g) => ({ operacaoId: g._id, quantidade: g.quantidade, pernasTotal: g.pernasTotal, walletIds: g.walletIds }));

  return { agregados, semCampos, operacoesIncompletas };
}

/**
 * Notificação interna para cada admin não bloqueado + auditoria. A auditoria
 * é gravada MESMO se a notificação falhar (como lib/rotinas/alertas.js); a
 * falha da notificação só vai para o log, para não repetir a auditoria.
 */
export async function alertarInconsistencia(db, { chave, achados }) {
  let adminsNotificados = 0;
  let erroNotificacao = null;
  try {
    const admins = await db
      .collection('users')
      .find({ systemRole: 'admin', isBlocked: { $ne: true } }, { projection: { _id: 1 } })
      .toArray();
    if (admins.length) {
      const resumo = achados.slice(0, MAX_ACHADOS_MENSAGEM).map(descreverAchado).join('; ');
      const resto = achados.length > MAX_ACHADOS_MENSAGEM ? ` e mais ${achados.length - MAX_ACHADOS_MENSAGEM}` : '';
      const agora = new Date();
      await db.collection('notificacoesUsuario').insertMany(
        admins.map((admin) => ({
          userId: admin._id,
          titulo: 'Inconsistência no ledger',
          mensagem: `A conferência diária do ledger encontrou ${achados.length} problema(s): ${resumo}${resto}. Nada foi corrigido automaticamente.`,
          tipo: 'sistema',
          acao: '/admin?tab=rotinas',
          lido: false,
          data: agora,
          importante: true,
        }))
      );
    }
    adminsNotificados = admins.length;
  } catch (error) {
    erroNotificacao = error;
  }

  await logAudit({
    action: 'ledger.inconsistencia',
    actorId: 'sistema',
    actorEmail: null,
    targetId: chave,
    targetCollection: 'walletTransactions',
    details: {
      quantidade: achados.length,
      achados: achados.slice(0, MAX_ACHADOS_AUDITORIA),
      adminsNotificados,
      notificacaoFalhou: Boolean(erroNotificacao),
    },
  });

  if (erroNotificacao) console.error('ledger-consistencia: falha ao notificar admins', erroNotificacao);
  return { adminsNotificados };
}

export function criarRotinaLedgerConsistencia({
  coletar = coletarDadosConsistencia,
  alertar = alertarInconsistencia,
} = {}) {
  return {
    id: 'ledger-consistencia',
    descricao: 'Conferência diária do ledger (saldos negativos, campos ausentes, operações incompletas) — só alerta',
    ativa: true,

    async buscarVencidos({ agora }) {
      return [{ chave: `consistencia:${dataLocalBrasilia(agora)}`, dados: {} }];
    },

    async processarItem({ chave, contexto = {} }) {
      if (!contexto.db) throw new Error('ledger-consistencia exige contexto.db');
      // Erro de leitura lança: o executor (001) agenda a retentativa.
      const dados = await coletar(contexto.db);
      const achados = verificarConsistencia(dados);
      if (achados.length > 0) await alertar(contexto.db, { chave, achados });
      return 'concluido';
    },
  };
}

export const rotinaLedgerConsistencia = criarRotinaLedgerConsistencia();
