// Execução das transições de moderação no banco (005-aprovacao-grupos).
// Usa lib/moderacao.js (puro) para planejar; grava com findOneAndUpdate
// condicional ao status/envio esperado (FR-014); notifica com _id
// determinístico (idempotente, FR-026) e audita só depois de gravar (FR-028).
// Ver sdd/specs/005-aprovacao-grupos/logic/moderacao.md §3.
import { ObjectId } from 'mongodb';
import { logAudit } from './audit';
import { CODIGOS_MODERACAO, STATUS_GRUPO, planejarTransicao } from './moderacao';

const STATUS_SEM_PARTICIPACAO = [STATUS_GRUPO.CANCELADO, STATUS_GRUPO.REJEITADO];

const comoObjectId = (v) => {
  if (v instanceof ObjectId) return v;
  if (typeof v === 'string' && ObjectId.isValid(v)) return new ObjectId(v);
  return null;
};

/** Dono do grupo como ObjectId (adminId, adminIdString ou admin.userId). */
export function donoDoGrupo(grupo) {
  return comoObjectId(grupo?.adminId) || comoObjectId(grupo?.adminIdString) || comoObjectId(grupo?.admin?.userId);
}

const TITULOS = {
  aprovar: 'Grupo aprovado',
  aprovar_automatico: 'Grupo aprovado automaticamente',
  pedir_ajuste: 'Ajustes solicitados no seu grupo',
  rejeitar: 'Grupo rejeitado',
  cancelar: 'Grupo cancelado pelo Cotea',
  reprovar_revisao: 'Grupo cancelado pelo Cotea',
  encerrar: 'Grupo encerrado pelo dono',
};

function mensagemPara({ acao, nome, texto, paraMembro }) {
  const grupo = nome ? `"${nome}"` : 'seu grupo';
  if (paraMembro && acao === 'encerrar') {
    return `O dono encerrou o grupo ${grupo}${texto ? `. Motivo: ${texto}` : ''}. Em caso de duvidas sobre valores pagos, fale com o suporte.`;
  }
  if (paraMembro) {
    return `O grupo ${grupo} foi cancelado pelo Cotea e nao aceita mais novas entradas. Se voce tinha caucao no grupo, ela volta para o seu saldo automaticamente; para outros valores pagos, o suporte vai entrar em contato.`;
  }
  switch (acao) {
    case 'aprovar':
      return `O grupo ${grupo} foi aprovado e ja esta publico.`;
    case 'aprovar_automatico':
      return `O grupo ${grupo} foi aprovado automaticamente e ja esta publico. Ele ainda passara por uma revisao do Cotea.`;
    case 'pedir_ajuste':
      return `O Cotea pediu ajustes no grupo ${grupo}: ${texto}. Edite o grupo e reenvie para aprovacao.`;
    case 'rejeitar':
      return `O grupo ${grupo} foi rejeitado. Motivo: ${texto}`;
    default:
      return `O grupo ${grupo} foi cancelado pelo Cotea. Motivo: ${texto}`;
  }
}

/**
 * Notificações internas do evento (idempotentes pelo _id: repetir não duplica).
 * @param {import('mongodb').Db} db
 * @param {{ grupo: object, evento: { acao: string, envio: number, texto?: string|null, em?: Date }, destino: 'dono'|'dono_e_membros'|'membros'|null }} p
 * @returns {Promise<number>} quantas notificações novas foram gravadas
 */
export async function notificarEventoModeracao(db, { grupo, evento, destino }) {
  if (!destino || !grupo) return 0;
  const destinatarios = [];
  const dono = donoDoGrupo(grupo);
  if (dono && destino !== 'membros') destinatarios.push({ userId: dono, paraMembro: false });

  if (destino === 'dono_e_membros' || destino === 'membros') {
    const membros = await db.collection('membrosGrupo').find({ grupoId: grupo._id }).toArray();
    for (const m of membros) {
      if (m.status === 'banido' || m.papel === 'admin') continue;
      const uid = comoObjectId(m.userId);
      if (!uid || (dono && uid.equals(dono))) continue;
      if (destinatarios.some((d) => d.userId.equals(uid))) continue;
      destinatarios.push({ userId: uid, paraMembro: true });
    }
  }

  const col = db.collection('notificacoesUsuario');
  const data = evento.em instanceof Date ? evento.em : new Date();
  let gravadas = 0;
  for (const { userId, paraMembro } of destinatarios) {
    try {
      await col.insertOne({
        _id: `moderacao:${grupo._id}:${evento.envio}:${evento.acao}:${userId}`,
        userId,
        titulo: TITULOS[evento.acao] || 'Atualizacao do seu grupo',
        mensagem: mensagemPara({ acao: evento.acao, nome: grupo.nome, texto: evento.texto, paraMembro }),
        tipo: 'grupo',
        acao: `/grupos/${grupo._id}`,
        lido: false,
        data,
        importante: true,
      });
      gravadas += 1;
    } catch (erro) {
      if (erro?.code !== 11000) throw erro; // já notificado para este evento
    }
  }
  return gravadas;
}

/**
 * Executa uma transição de moderação.
 * @param {import('mongodb').Db} db
 * @param {{ grupoId: import('mongodb').ObjectId, acao: string, texto?: string,
 *           ator: { id: string|null, email?: string|null, automatico?: boolean },
 *           agora?: Date, ip?: string|null, envioEsperado?: number }} p
 * @returns {Promise<{ ok: true, grupo: object } | { ok: false, http: number, body: { error: string, codigo?: string } }>}
 */
export async function executarTransicao(db, { grupoId, acao, texto, ator = {}, agora = new Date(), ip = null, envioEsperado } = {}) {
  const col = db.collection('grupos');
  const grupo = await col.findOne({ _id: grupoId });
  if (!grupo) return { ok: false, http: 404, body: { error: 'Grupo nao encontrado' } };

  const plano = planejarTransicao({ grupo, acao, texto, ator, agora, envioEsperado });
  if (!plano.ok) return { ok: false, http: plano.http, body: { error: plano.error, codigo: plano.codigo } };

  // driver v6: devolve o documento (ou null), sem `.value` (B-06)
  const atualizado = await col.findOneAndUpdate(plano.filtro, plano.update, { returnDocument: 'after' });
  if (!atualizado) {
    return {
      ok: false, http: 409,
      body: { error: 'O grupo nao esta mais no estado esperado para esta acao. Atualize a pagina.', codigo: CODIGOS_MODERACAO.CONFLITO },
    };
  }

  try {
    await notificarEventoModeracao(db, { grupo: atualizado, evento: plano.evento, destino: plano.notificar });
  } catch (erro) {
    // A transição já foi gravada; a notificação é informativa (R-002).
    console.error('Falha ao notificar evento de moderacao:', erro?.message || erro);
  }

  // 006-checkout-caucao (FR-021, D-07): grupo encerrado devolve a caução de todos. A
  // transição já vale; o que não terminar aqui, a rotina `liquidacao-participacoes` completa.
  if (STATUS_SEM_PARTICIPACAO.includes(atualizado.status)) {
    try {
      // Import dinâmico: o módulo exige o banco real configurado.
      const { liquidarParticipacoesDoGrupo } = await import('./checkout-servidor');
      await liquidarParticipacoesDoGrupo({
        db,
        grupoId,
        motivo: acao === 'encerrar' ? 'grupo_encerrado' : 'grupo_cancelado',
        porId: ator.automatico ? null : ator.id,
      });
    } catch (erro) {
      console.error('Falha ao devolver caucoes do grupo encerrado:', erro?.message || erro);
    }
  }

  await logAudit({
    action: `grupo.moderacao.${acao}`,
    actorId: ator.automatico ? 'sistema' : String(ator.id),
    actorEmail: ator.automatico ? null : (ator.email || null),
    targetId: String(grupoId),
    targetCollection: 'grupos',
    details: {
      de: plano.evento.de, para: plano.evento.para, envio: plano.evento.envio,
      texto: plano.evento.texto, automatico: Boolean(ator.automatico), nome: atualizado.nome,
    },
    ip,
  });

  return { ok: true, grupo: atualizado };
}
