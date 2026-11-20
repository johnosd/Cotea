// Alerta de falha definitiva de item de rotina (FR-006, FR-020, D-10):
// notificação interna para cada admin do sistema não bloqueado + auditoria.
import { logAudit } from '../audit';

export function criarAlertaAdmins(db) {
  return async function alertar({ rotinaId, chave, erro, tentativas }) {
    const agora = new Date();
    const admins = await db
      .collection('users')
      .find({ systemRole: 'admin', isBlocked: { $ne: true } }, { projection: { _id: 1 } })
      .toArray();

    if (admins.length) {
      await db.collection('notificacoesUsuario').insertMany(
        admins.map((admin) => ({
          userId: admin._id,
          titulo: 'Rotina com falha definitiva',
          mensagem: `A rotina ${rotinaId} falhou ${tentativas} vezes no item ${chave} e parou de tentar. Ultimo erro: ${erro}`,
          tipo: 'sistema',
          acao: '/admin?tab=rotinas',
          lido: false,
          data: agora,
          importante: true,
        }))
      );
    }

    await logAudit({
      action: 'rotina.item_falha_definitiva',
      actorId: 'sistema',
      actorEmail: null,
      targetId: `${rotinaId}:${chave}`,
      targetCollection: 'rotinaItens',
      details: { rotinaId, chave, tentativas, erro, adminsNotificados: admins.length },
    });
  };
}
