import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import clientPromise from "../../lib/mongodb";
import { ObjectId } from "mongodb";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ message: "Nao autenticado" });

  if (req.method === "GET") {
    const { userId, lido } = req.query;
    if (!userId || !ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "userId invalido" });
    }

    const isAdmin = session.user.systemRole === "admin";
    if (!isAdmin && String(session.user.id) !== String(userId)) {
      return res.status(403).json({ message: "Acesso negado" });
    }

    try {
      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB);
      const filtro = { userId: new ObjectId(userId) };
      if (lido !== undefined) {
        filtro.lido = lido === "true";
      }
      const notificacoes = await db
        .collection("notificacoesUsuario")
        .find(filtro)
        .sort({ data: -1 })
        .limit(20)
        .toArray();
      return res.status(200).json(notificacoes);
    } catch (error) {
      console.error("Erro ao listar notificacoes:", error);
      return res.status(500).json({ message: "Erro ao listar notificacoes" });
    }
  }

  if (req.method === "PATCH") {
    const { userId, notificacaoId } = req.body || {};
    if (!userId || !ObjectId.isValid(userId) || !notificacaoId || !ObjectId.isValid(notificacaoId)) {
      return res.status(400).json({ message: "Parametros invalidos" });
    }

    const isAdmin = session.user.systemRole === "admin";
    if (!isAdmin && String(session.user.id) !== String(userId)) {
      return res.status(403).json({ message: "Acesso negado" });
    }

    try {
      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB);
      const resultado = await db.collection("notificacoesUsuario").updateOne(
        { _id: new ObjectId(notificacaoId), userId: new ObjectId(userId) },
        { $set: { lido: true, dataLido: new Date() } }
      );
      if (resultado.matchedCount === 0) {
        return res.status(404).json({ message: "Notificacao nao encontrada" });
      }
      return res.status(200).json({ message: "Notificacao marcada como lida" });
    } catch (error) {
      console.error("Erro ao atualizar notificacao:", error);
      return res.status(500).json({ message: "Erro ao atualizar notificacao" });
    }
  }

  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).json({ message: "Metodo nao permitido" });
}
