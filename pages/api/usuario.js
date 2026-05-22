// pages/api/usuario.js
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { getDb } from "../../lib/mongodb";
import { decryptCPF } from "../../lib/encryption";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session) {
    return res.status(401).json({ message: "Nao autorizado" });
  }

  try {
    const db = await getDb();

    const usuario = await db.collection("users").findOne(
      { email: session.user.email },
      {
        projection: {
          nome: 1,
          sobrenome: 1,
          email: 1,
          image: 1,
          telefone: 1,
          username: 1,
          cpf: 1,
          endereco: 1,
          contaValidada: 1,
          createdAt: 1,
        },
      }
    );

    if (!usuario) {
      return res.status(404).json({ message: "Usuario nao encontrado" });
    }

    if (usuario.cpf) usuario.cpf = decryptCPF(usuario.cpf);
    return res.status(200).json(usuario);
  } catch (error) {
    console.error("Erro ao buscar dados do usuario:", error);
    return res.status(500).json({ message: "Erro interno do servidor" });
  }
}
