// pages/api/verifyCode.js
import clientPromise from "../../lib/mongodb";

const MAX_TENTATIVAS = 5;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo nao permitido" });
  }

  const { email, codigo } = req.body;

  if (!email || !codigo) {
    return res.status(400).json({ message: "Email e codigo sao obrigatorios" });
  }

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);

    const registro = await db
      .collection("verificationCodes")
      .findOne(
        { email, status: "pendente" },
        { sort: { createdAt: -1 } }
      );

    if (!registro) {
      return res.status(400).json({ message: "Codigo nao encontrado" });
    }

    if (new Date() > new Date(registro.expiresAt)) {
      return res.status(400).json({ message: "Codigo expirado" });
    }

    if (registro.tentativas >= MAX_TENTATIVAS) {
      return res.status(429).json({ message: "Muitas tentativas incorretas. Solicite um novo codigo." });
    }

    if (registro.codigo !== codigo.toUpperCase()) {
      await db.collection("verificationCodes").updateOne(
        { _id: registro._id },
        { $inc: { tentativas: 1 } }
      );
      const restantes = MAX_TENTATIVAS - (registro.tentativas + 1);
      return res.status(400).json({
        message: `Codigo incorreto. ${restantes > 0 ? `${restantes} tentativa(s) restante(s).` : "Ultima tentativa esgotada."}`,
      });
    }

    // Marca código como usado e conta como validada
    await Promise.all([
      db.collection("verificationCodes").updateOne(
        { _id: registro._id },
        { $set: { status: "usado", usedAt: new Date() } }
      ),
      db.collection("users").updateOne(
        { email },
        { $set: { contaValidada: true } }
      ),
    ]);

    return res.status(200).json({ message: "E-mail verificado com sucesso!" });
  } catch (error) {
    console.error("Erro na verificacao:", error);
    return res.status(500).json({ message: "Erro interno no servidor" });
  }
}
