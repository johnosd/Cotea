// pages/api/atualizarPerfil.js
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import clientPromise from "../../lib/mongodb";
import { decryptCPF, encryptCPF } from "../../lib/encryption";

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

      const { systemRole, isBlocked, ...dadosPublicos } = user;
      if (dadosPublicos.cpf) dadosPublicos.cpf = decryptCPF(dadosPublicos.cpf);
      return res.status(200).json(dadosPublicos);
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
    endereco = {},
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

  const cpfDigitos = String(cpf || "").replace(/\D/g, "");
  if (cpfDigitos && cpfDigitos.length !== 11) {
    return res.status(400).json({ message: "CPF deve conter 11 digitos." });
  }

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

    const str = (v, max) => String(v || "").slice(0, max);
    const enderecoSanitizado = {
      cep:         str(endereco.cep, 9),
      uf:          str(endereco.uf, 2),
      cidade:      str(endereco.cidade, 100),
      bairro:      str(endereco.bairro, 100),
      rua:         str(endereco.rua, 200),
      numero:      str(endereco.numero, 20),
      complemento: str(endereco.complemento, 100),
    };

    await db.collection("users").updateOne(
      { email },
      {
        $set: {
          nome,
          sobrenome,
          image: imagem,
          telefone,
          username: usernameLimpo,
          cpf: encryptCPF(cpfDigitos),
          endereco: enderecoSanitizado,
        },
      }
    );

    return res.status(200).json({ message: "Perfil atualizado com sucesso." });
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    return res.status(500).json({ message: "Erro interno do servidor." });
  }
}
