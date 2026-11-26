// POST /api/grupos/[id]/moderacao — ações do dono sobre o próprio grupo
// (005-aprovacao-grupos, US4 · FR-020, FR-021; R-008).
// Body: { acao, texto? }, acao ∈ ACOES_DONO:
//   - reenviar (ajustes → em_aprovacao, novo prazo): exige conta validada, não
//     bloqueado e cadastro financeiro completo — as mesmas condições da criação;
//   - desistir (em_aprovacao/ajustes → cancelado);
//   - encerrar (ativo → cancelado, motivo opcional, membros avisados; sem estorno até a V2-14).
// Contrato em sdd/specs/005-aprovacao-grupos/contracts/api-moderacao.md.
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from '../../auth/[...nextauth]';
import { getDb } from '../../../../lib/mongodb';
import { getSessionUserId } from '../../../../lib/wallet';
import { getClientIp } from '../../../../lib/ratelimit';
import { parseObjectId } from '../../../../lib/grupos-utils';
import { verificarCadastroFinanceiro } from '../../../../lib/cadastro-financeiro-servidor';
import { ACOES_DONO, ACOES_MODERACAO, CODIGOS_MODERACAO } from '../../../../lib/moderacao';
import { donoDoGrupo, executarTransicao } from '../../../../lib/moderacao-servidor';

const MENSAGENS = {
  reenviar: 'Grupo reenviado para aprovacao',
  desistir: 'Pedido de aprovacao cancelado',
  encerrar: 'Grupo cancelado',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const requesterId = parseObjectId(getSessionUserId(session));
    if (!session?.user || !requesterId) return res.status(401).json({ error: 'Nao autenticado' });

    const { id } = req.query;
    if (!ObjectId.isValid(id) || String(id).length !== 24) return res.status(400).json({ error: 'ID invalido' });
    const grupoId = new ObjectId(id);

    const acao = String(req.body?.acao ?? '');
    if (!ACOES_DONO.includes(acao)) {
      return res.status(400).json({ error: 'Acao de moderacao invalida', codigo: CODIGOS_MODERACAO.ACAO_INVALIDA });
    }

    const db = await getDb();
    const grupo = await db.collection('grupos').findOne({ _id: grupoId });
    if (!grupo) return res.status(404).json({ error: 'Grupo nao encontrado' });

    // Dono = adminId do grupo ou membro com papel admin não banido (mesma regra do PUT).
    const donoId = donoDoGrupo(grupo);
    const ehDono = (donoId && donoId.equals(requesterId))
      || Boolean(await db.collection('membrosGrupo').findOne({
        grupoId, userId: requesterId, papel: 'admin', status: { $ne: 'banido' },
      }));
    if (!ehDono) return res.status(403).json({ error: 'Apenas o dono do grupo pode fazer isso' });

    // Reenviar equivale a criar: mesmas condições da criação (FR-020; B-05; 004 D-03).
    if (acao === ACOES_MODERACAO.REENVIAR) {
      if (!session.user.contaValidada) {
        return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para reenviar o grupo.' });
      }
      const usuario = await db.collection('users').findOne({ _id: requesterId }, { projection: { isBlocked: 1 } });
      if (usuario?.isBlocked === true || session.user.isBlocked === true) {
        return res.status(403).json({ error: 'Conta bloqueada. Voce nao pode reenviar grupos. Procure o suporte.' });
      }
      const verificacao = await verificarCadastroFinanceiro(requesterId);
      if (!verificacao.ok) return res.status(verificacao.http).json(verificacao.body);
    }

    const resultado = await executarTransicao(db, {
      grupoId,
      acao,
      texto: req.body?.texto,
      ator: { id: String(requesterId), email: session.user.email || null },
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
    console.error('Erro na API /api/grupos/[id]/moderacao:', error);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
