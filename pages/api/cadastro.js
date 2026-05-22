// pages/api/cadastro.js
import clientPromise from "../../lib/mongodb";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo nao permitido." });
  }

  const { nome, sobrenome, email, image, telefone = "", username } = req.body || {};

  const nomeLimpo = (nome || "").trim();
  const sobrenomeLimpo = (sobrenome || "").trim();
  const emailLimpo = (email || "").trim().toLowerCase();
  const usernameLimpo = (username || "").trim().toLowerCase();
  const telefoneLimpo = String(telefone || "").replace(/\D/g, "");

  if (!nomeLimpo || !sobrenomeLimpo || !emailLimpo || !usernameLimpo) {
    return res.status(400).json({ message: "Nome, sobrenome, email e usuario sao obrigatorios." });
  }

  if (!/^[a-z0-9_.-]{3,20}$/i.test(usernameLimpo)) {
    return res.status(400).json({ message: "Usuario deve ter 3-20 caracteres (letras, numeros, . _ -)." });
  }

  if (telefoneLimpo && telefoneLimpo.length < 10) {
    return res.status(400).json({ message: "Telefone invalido. Informe DDD + numero." });
  }

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);

    const existingUser = await db.collection("users").findOne({ email: emailLimpo });
    if (existingUser) {
      return res.status(409).json({ message: "Usuario ja existe." });
    }

    const existingUsername = await db.collection("users").findOne({ username: usernameLimpo });
    if (existingUsername) {
      return res.status(409).json({ message: "Nome de usuario ja esta em uso." });
    }

    const resultado = await db.collection("users").insertOne({
      nome: nomeLimpo,
      sobrenome: sobrenomeLimpo,
      email: emailLimpo,
      image,
      telefone: telefoneLimpo,
      username: usernameLimpo,
      contaValidada: false,
      systemRole: "user",
      isBlocked: false,
      createdAt: new Date(),
    });

    // Notificacao para validar conta
    try {
      await db.collection("notificacoesUsuario").insertOne({
        userId: resultado.insertedId,
        titulo: "Confirme seu e-mail",
        mensagem: "Valide sua conta para aproveitar todos os recursos. Clique para ir à página de verificação.",
        tipo: "sistema",
        acao: "validar_conta",
        lido: false,
        importante: true,
        data: new Date(),
        dataLido: null,
        expiraEm: null,
      });
    } catch (notifyError) {
      console.error("Erro ao criar notificacao de validacao:", notifyError);
    }

    return res.status(201).json({ message: "Usuario cadastrado com sucesso!" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao cadastrar usuario. Tente novamente." });
  }
}
