// PUT /api/admin/users/[id]/cpf — correção do CPF travado de um usuário pelo
// admin do sistema (004-cadastro-financeiro, US5, FR-018/FR-019, D-09).
// Motivo obrigatório; mesmas regras do cadastro (dígito verificador, CPF único,
// gravação cifrada + hash); o admin não corrige o próprio CPF; a auditoria
// registra só o motivo (nunca o CPF, nem mascarado).
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
import { authOptions } from '../../../auth/[...nextauth]';
import { getDb } from '../../../../../lib/mongodb';
import { PERMISSIONS, hasRole } from '../../../../../lib/authz';
import { logAudit } from '../../../../../lib/audit';
import { getClientIp } from '../../../../../lib/ratelimit';
import { encryptCPF, hashCPF } from '../../../../../lib/encryption';
import { mascararCPF } from '../../../../../lib/cpf-mascara';
import { somenteDigitosCpf, validarCpf } from '../../../../../lib/cadastro-financeiro';
import {
  CODIGO_CPF_INDISPONIVEL,
  MENSAGEM_CPF_INDISPONIVEL,
  cpfEmUsoPorOutraConta,
} from '../../../../../lib/cadastro-financeiro-perfil';

const MOTIVO_MAX = 500;

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session) return res.status(401).json({ error: 'Nao autenticado' });
    if (!hasRole(session, PERMISSIONS.CORRIGIR_CPF)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const { id } = req.query;
    if (!ObjectId.isValid(id) || String(id).length !== 24) {
      return res.status(400).json({ error: 'ID invalido' });
    }
    if (String(session.user.id) === String(id)) {
      return res.status(403).json({ error: 'Voce nao pode corrigir o proprio CPF. Peca a outro administrador.' });
    }

    const motivo = String(req.body?.motivo ?? '').trim().slice(0, MOTIVO_MAX);
    if (!motivo) return res.status(400).json({ error: 'Informe o motivo da correcao.' });

    const cpf = somenteDigitosCpf(req.body?.cpf);
    if (!validarCpf(cpf)) return res.status(400).json({ error: 'CPF invalido.' });

    const db = await getDb();
    const usuarioId = new ObjectId(id);
    const usuario = await db.collection('users').findOne({ _id: usuarioId }, { projection: { _id: 1, email: 1 } });
    if (!usuario) return res.status(404).json({ error: 'Usuario nao encontrado' });

    const cpfHash = hashCPF(cpf);
    if (await cpfEmUsoPorOutraConta(db, cpfHash, usuarioId)) {
      return res.status(409).json({ error: MENSAGEM_CPF_INDISPONIVEL, codigo: CODIGO_CPF_INDISPONIVEL });
    }

    try {
      await db.collection('users').updateOne({ _id: usuarioId }, { $set: { cpf: encryptCPF(cpf), cpfHash } });
    } catch (err) {
      if (err?.code === 11000) {
        return res.status(409).json({ error: MENSAGEM_CPF_INDISPONIVEL, codigo: CODIGO_CPF_INDISPONIVEL });
      }
      throw err;
    }

    await logAudit({
      action: 'user.cpf_corrected',
      actorId: String(session.user.id),
      actorEmail: session.user.email,
      targetId: String(id),
      targetCollection: 'users',
      details: { motivo },
      ip: getClientIp(req),
    });

    return res.status(200).json({ cpfMascarado: mascararCPF(cpf) });
  } catch (error) {
    console.error('Erro ao corrigir CPF:', error?.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
