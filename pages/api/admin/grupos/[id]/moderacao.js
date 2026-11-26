// POST /api/admin/grupos/[id]/moderacao — decisões do admin do sistema sobre um grupo
// (005-aprovacao-grupos, US2/US3/US5 · FR-010 a FR-014, FR-018, FR-023 a FR-025).
// Body: { acao, texto? }, acao ∈ ACOES_ADMIN. Só `systemRole: admin`
// (PERMISSIONS.MODERAR_GRUPOS); o suporte apenas consulta a fila. A transição é
// condicional ao estado (409 moderacao_conflito se outra decisão venceu).
// Contrato em sdd/specs/005-aprovacao-grupos/contracts/api-moderacao.md.
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from '../../../auth/[...nextauth]';
import { getDb } from '../../../../../lib/mongodb';
import { PERMISSIONS, hasRole } from '../../../../../lib/authz';
import { getClientIp } from '../../../../../lib/ratelimit';
import { ACOES_ADMIN, CODIGOS_MODERACAO } from '../../../../../lib/moderacao';
import { executarTransicao } from '../../../../../lib/moderacao-servidor';

const MENSAGENS = {
  aprovar: 'Grupo aprovado',
  pedir_ajuste: 'Ajustes solicitados ao dono',
  rejeitar: 'Grupo rejeitado',
  confirmar_revisao: 'Revisao confirmada',
  reprovar_revisao: 'Revisao reprovada: grupo cancelado',
  cancelar: 'Grupo cancelado pelo Cotea',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user) return res.status(401).json({ error: 'Nao autenticado' });
    if (!hasRole(session, PERMISSIONS.MODERAR_GRUPOS)) {
      return res.status(403).json({ error: 'Apenas o admin do sistema decide sobre grupos' });
    }

    const { id } = req.query;
    if (!ObjectId.isValid(id) || String(id).length !== 24) {
      return res.status(400).json({ error: 'ID invalido' });
    }

    const acao = String(req.body?.acao ?? '');
    if (!ACOES_ADMIN.includes(acao)) {
      return res.status(400).json({ error: 'Acao de moderacao invalida', codigo: CODIGOS_MODERACAO.ACAO_INVALIDA });
    }

    const db = await getDb();
    const resultado = await executarTransicao(db, {
      grupoId: new ObjectId(id),
      acao,
      texto: req.body?.texto,
      ator: { id: String(session.user.id), email: session.user.email || null },
      agora: new Date(),
      ip: getClientIp(req),
    });
    if (!resultado.ok) return res.status(resultado.http).json(resultado.body);

    return res.status(200).json({
      message: MENSAGENS[acao],
      status: resultado.grupo.status,
      moderacao: resultado.grupo.moderacao,
    });
  } catch (error) {
    console.error('Erro na API /api/admin/grupos/[id]/moderacao:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
