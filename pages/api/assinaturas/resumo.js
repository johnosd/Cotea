// GET /api/assinaturas/resumo?grupoId= — o que se paga para entrar num grupo
// (006-checkout-caucao, FR-003/FR-004). Só leitura (no máximo cria a carteira vazia); o
// gate de cadastro financeiro fica na confirmação (POST /api/assinaturas/pay).
// Contrato em sdd/specs/006-checkout-caucao/contracts/api-entrada.md.
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { calculateBalances, ensureWallet, getSessionUserId } from '../../../lib/wallet';
import { parseObjectId } from '../../../lib/grupos-utils';
import { avaliarEntradaNoGrupo } from '../../../lib/grupo-entrada';
import { calcularResumoEntrada, montarResumoParaTela } from '../../../lib/checkout';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const userId = getSessionUserId(session);
    if (!session || !userId) {
      return res.status(401).json({ error: 'Nao autenticado' });
    }
    if (!session.user.contaValidada) {
      return res.status(403).json({ error: 'Conta nao verificada. Confirme seu e-mail para assinar grupos.' });
    }

    const bruto = Array.isArray(req.query?.grupoId) ? req.query.grupoId[0] : req.query?.grupoId;
    const grupoId = parseObjectId(String(bruto || '').trim());
    if (!grupoId) {
      return res.status(400).json({ error: 'grupoId obrigatorio e invalido' });
    }

    const db = await getDb();
    const grupo = await db.collection('grupos').findOne({ _id: grupoId });
    if (!grupo) return res.status(404).json({ error: 'Grupo nao encontrado' });

    // As recusas são as mesmas do pay e não carregam dados do grupo.
    const membros = await db.collection('membrosGrupo').find({ grupoId }).toArray();
    const impedimento = avaliarEntradaNoGrupo({ grupo, userId, membros });
    if (impedimento) {
      return res.status(impedimento.http).json({ error: impedimento.error, codigo: impedimento.codigo });
    }
    const resumo = calcularResumoEntrada({ grupo, membros });
    if (!resumo.valido) {
      return res.status(409).json({ error: 'Preco indisponivel para este grupo', codigo: 'preco_indisponivel' });
    }

    const wallet = await ensureWallet(userId);
    const { available } = await calculateBalances(wallet._id);

    return res.status(200).json({
      grupo: { _id: String(grupo._id), nome: grupo.nome || '' },
      resumo: montarResumoParaTela(resumo, available),
    });
  } catch (error) {
    console.error('Erro ao montar resumo da entrada:', error);
    return res.status(500).json({ error: 'Erro interno ao montar o resumo' });
  }
}
