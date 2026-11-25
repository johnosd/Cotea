// pages/api/atualizarPerfil.js
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import clientPromise from "../../lib/mongodb";
import { resumoCadastroFinanceiro, salvarCadastroFinanceiro } from "../../lib/cadastro-financeiro-perfil";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Nao autenticado." });
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB);

  if (req.method === "GET") {
    try {
      const { email } = req.query;
      if (!email) return res.status(400).json({ message: "Email e obrigatorio." });

      const isAdmin = session.user.systemRole === "admin";
      if (!isAdmin && email !== session.user.email) {
        return res.status(403).json({ message: "Acesso negado." });
      }

      const user = await db.collection("users").findOne({ email });
      if (!user) return res.status(404).json({ message: "Usuario nao encontrado." });

      // 004-cadastro-financeiro (D-04): o CPF nunca sai completo, nem para o admin.
      const { systemRole, isBlocked, cpf, cpfHash, cpfLegadoInvalido, ...dadosPublicos } = user;
      const { cpfMascarado, cpfTravado } = resumoCadastroFinanceiro(user);
      return res.status(200).json({ ...dadosPublicos, cpfMascarado, cpfTravado });
    } catch (error) {
      console.error("Erro ao carregar perfil:", error);
      return res.status(500).json({ message: "Erro ao carregar perfil." });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo nao permitido" });
  }

  const {
    email,
    nome,
    sobrenome,
    imagem,
    telefone,
    username,
    cpf,
    endereco,
  } = req.body;

  if (!email || !username || !nome || !sobrenome) {
    return res.status(400).json({ message: "Nome, sobrenome, email e username sao obrigatorios." });
  }

  if (email !== session.user.email) {
    return res.status(403).json({ message: "Acesso negado." });
  }

  if (nome.length > 100) return res.status(400).json({ message: "Nome deve ter no maximo 100 caracteres." });
  if (sobrenome.length > 100) return res.status(400).json({ message: "Sobrenome deve ter no maximo 100 caracteres." });
  if (telefone && String(telefone).length > 20) return res.status(400).json({ message: "Telefone deve ter no maximo 20 caracteres." });

  const usernameLimpo = username.trim().replace(/\s/g, "");
  if (usernameLimpo.length > 30) return res.status(400).json({ message: "Username deve ter no maximo 30 caracteres." });
  if (!/^[a-zA-Z0-9._-]+$/.test(usernameLimpo)) return res.status(400).json({ message: "Username deve conter apenas letras, numeros, ponto, hifen ou underscore." });

  try {
    const usuarioAtual = await db.collection("users").findOne({ email });
    if (!usuarioAtual) {
      return res.status(404).json({ message: "Usuario nao encontrado." });
    }

    const usuarioComMesmoUsername = await db.collection("users").findOne({
      username: usernameLimpo,
      email: { $ne: email },
    });

    if (usuarioComMesmoUsername) {
      return res.status(400).json({ message: "Nome de usuario ja esta em uso por outro usuario." });
    }

    // CPF e endereço passam pelas regras do cadastro financeiro (004, D-05):
    // dígito verificador, CPF único e travado, CEP consultado. Com erro, nada é gravado.
    const str = (v, max) => String(v || "").slice(0, max);
    const enderecoLimitado = {
      cep:         str(endereco?.cep, 9),
      uf:          str(endereco?.uf, 2),
      cidade:      str(endereco?.cidade, 100),
      bairro:      str(endereco?.bairro, 100),
      rua:         str(endereco?.rua, 200),
      numero:      str(endereco?.numero, 20),
      complemento: str(endereco?.complemento, 100),
    };
    const cadastro = await salvarCadastroFinanceiro({
      userId: usuarioAtual._id,
      usuario: usuarioAtual,
      enviado: endereco === undefined ? { cpf } : { cpf, endereco: enderecoLimitado },
    });
    if (!cadastro.ok) {
      return res.status(cadastro.http).json({ message: cadastro.error, codigo: cadastro.codigo, campos: cadastro.campos });
    }

    await db.collection("users").updateOne(
      { email },
      {
        $set: {
          nome,
          sobrenome,
          image: imagem,
          telefone,
          username: usernameLimpo,
        },
      }
    );

    return res.status(200).json({ message: "Perfil atualizado com sucesso." });
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    return res.status(500).json({ message: "Erro interno do servidor." });
  }
}
