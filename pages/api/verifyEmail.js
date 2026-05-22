// pages/api/verifyEmail.js
import clientPromise from "../../lib/mongodb";
import { ObjectId } from "mongodb";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo nao permitido" });
  }

  const { email, codigo } = req.body || {};
  if (!email || !codigo) {
    return res.status(400).json({ message: "E-mail e codigo sao obrigatorios." });
  }

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);
    const now = new Date();

    const record = await db.collection("verificationCodes").findOne(
      { email, tipo: "validacao_cadastro", status: "pendente" },
      { sort: { createdAt: -1 } }
    );

    if (!record) {
      return res.status(400).json({ message: "Codigo nao encontrado." });
    }

    if (record.expiresAt && now > new Date(record.expiresAt)) {
      await db.collection("verificationCodes").updateOne({ _id: record._id }, { $set: { status: "expirado" } });
      return res.status(400).json({ message: "Codigo expirado." });
    }

    if (record.codigo !== codigo.toUpperCase()) {
      await db
        .collection("verificationCodes")
        .updateOne({ _id: record._id }, { $inc: { tentativas: 1 } });
      return res.status(400).json({ message: "Codigo incorreto." });
    }

    await db.collection("users").updateOne({ email }, { $set: { contaValidada: true } });
    await db
      .collection("verificationCodes")
      .updateOne({ _id: record._id }, { $set: { status: "usado", usedAt: now, tentativas: record.tentativas + 1 } });

    return res.status(200).json({ message: "Conta validada com sucesso." });
  } catch (error) {
    console.error("Erro ao validar e-mail:", error);
    return res.status(500).json({ message: "Erro interno do servidor." });
  }
}
