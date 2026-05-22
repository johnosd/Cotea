import { randomUUID } from 'crypto';
import { getDb } from './mongodb';

/**
 * Registra uma ação administrativa ou financeira no audit log.
 * Nunca lança exceção — falha silenciosa para não quebrar a operação principal.
 *
 * @param {object} opts
 * @param {string} opts.action        - ex: 'withdrawal.approved', 'user.role_changed'
 * @param {string} opts.actorId       - id do usuário que executou a ação
 * @param {string} opts.actorEmail    - email do ator
 * @param {string} [opts.targetId]    - id do recurso afetado
 * @param {string} [opts.targetCollection] - coleção do recurso afetado
 * @param {object} [opts.details]     - dados extras (antes/depois, valores, etc.)
 * @param {string} [opts.ip]          - IP do ator
 */
export async function logAudit({ action, actorId, actorEmail, targetId, targetCollection, details = {}, ip = null }) {
  try {
    const db = await getDb();
    await db.collection('auditLogs').insertOne({
      _id: randomUUID(),
      action,
      actorId: String(actorId),
      actorEmail: actorEmail || null,
      targetId: targetId ? String(targetId) : null,
      targetCollection: targetCollection || null,
      details,
      ip,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}
