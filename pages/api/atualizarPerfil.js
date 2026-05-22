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

  const usernameLimpo = username.trim().replace(/\s/g, "");

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

    const enderecoSanitizado = {
      cep: endereco.cep || "",
      uf: endereco.uf || "",
      cidade: endereco.cidade || "",
      bairro: endereco.bairro || "",
      rua: endereco.rua || "",
      numero: endereco.numero || "",
      complemento: endereco.complemento || "",
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
          cpf: encryptCPF(cpf || ""),
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
