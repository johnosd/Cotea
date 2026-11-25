// GET/PUT /api/perfil/cadastro-financeiro (004-cadastro-financeiro).
// Contrato: sdd/specs/004-cadastro-financeiro/contracts/api-cadastro-financeiro.md.
// GET → { completo, pendencias, cpfMascarado, cpfTravado, endereco, cepConfirmado } (nunca o CPF completo).
// PUT { cpf?, endereco? } → 200 (mesmo corpo do GET) | 400 { error, codigo, campos } | 409 { error, codigo: 'cpf_indisponivel' }.
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getDb } from '../../../lib/mongodb';
import { getSessionUserId } from '../../../lib/wallet';
import {
  carregarUsuario,
  resumoCadastroFinanceiro,
  salvarCadastroFinanceiro,
} from '../../../lib/cadastro-financeiro-perfil';

async function usuarioDaSessao(session) {
  const userId = getSessionUserId(session);
  const porId = userId ? await carregarUsuario(userId) : null;
  if (porId) return porId;
  if (!session?.user?.email) return null;
  const db = await getDb();
  return db.collection('users').findOne({ email: session.user.email });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', ['GET', 'PUT']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user) return res.status(401).json({ error: 'Nao autenticado' });

    const usuario = await usuarioDaSessao(session);
    if (!usuario) return res.status(404).json({ error: 'Usuario nao encontrado' });

    if (req.method === 'GET') {
      return res.status(200).json(resumoCadastroFinanceiro(usuario));
    }

    const enviado = {};
    if (req.body?.cpf !== undefined) enviado.cpf = req.body.cpf;
    if (req.body?.endereco !== undefined) enviado.endereco = req.body.endereco;

    const resultado = await salvarCadastroFinanceiro({ userId: usuario._id, usuario, enviado });
    if (!resultado.ok) {
      const { http, ok, ...corpo } = resultado;
      return res.status(http).json(corpo);
    }
    return res.status(200).json(resultado.resumo);
  } catch (error) {
    console.error('Erro no cadastro financeiro:', error?.message);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
}
