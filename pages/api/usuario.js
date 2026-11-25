// pages/api/usuario.js
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { getDb } from "../../lib/mongodb";
import { resumoCadastroFinanceiro } from "../../lib/cadastro-financeiro-perfil";

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

    // 004-cadastro-financeiro (FR-010, SC-005): o CPF nunca sai completo; só mascarado.
    const { cpf, ...dados } = usuario;
    const { cpfMascarado, cpfTravado } = resumoCadastroFinanceiro({ cpf, endereco: usuario.endereco });
    return res.status(200).json({ ...dados, cpfMascarado, cpfTravado });
  } catch (error) {
    console.error("Erro ao buscar dados do usuario:", error);
    return res.status(500).json({ message: "Erro interno do servidor" });
  }
}
