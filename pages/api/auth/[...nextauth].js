// pages/api/auth/[...nextauth].js
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import clientPromise from "../../../lib/mongodb";
import { checkRateLimit } from "../../../lib/ratelimit";

const DEFAULT_SESSION_MAX_AGE = 60 * 60 * 24; // 24h
const DEFAULT_SESSION_UPDATE_AGE = 60 * 30; // 30min
const envMaxAge = Number.parseInt(process.env.SESSION_MAX_AGE_SECONDS || '', 10);
const envUpdateAge = Number.parseInt(process.env.SESSION_UPDATE_AGE_SECONDS || '', 10);
const sessionMaxAge = Number.isFinite(envMaxAge) && envMaxAge > 0 ? envMaxAge : DEFAULT_SESSION_MAX_AGE;
const sessionUpdateAge = Number.isFinite(envUpdateAge) && envUpdateAge > 0 ? envUpdateAge : DEFAULT_SESSION_UPDATE_AGE;

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  callbacks: {
    async signIn({ user }) {
      const { allowed } = await checkRateLimit({
        key: `login:${user.email}`,
        max: 10,
        windowMs: 15 * 60 * 1000, // 15 min
      });
      return allowed;
    },
    async jwt({ token, user }) {
      if (user) {
        // Primeiro login: popula token a partir do banco
        token.email = user.email;
        token.name = user.name;
        token.image = user.image;

        const client = await clientPromise;
        const db = client.db(process.env.MONGODB_DB);
        const usuario = await db.collection("users").findOne({ email: user.email });

        if (usuario) {
          token.id = usuario._id;
          token.nome = usuario.nome || user.name || "";
          token.sobrenome = usuario.sobrenome || "";
          token.telefone = usuario.telefone || "";
          token.username = usuario.username || "";
          token.contaValidada = usuario.contaValidada || false;
          token.systemRole = usuario.systemRole || "user";
          token.isBlocked = usuario.isBlocked || false;
          if (usuario.image) token.image = usuario.image;

          // Cria notificacao de validacao se estiver pendente
          if (!usuario.contaValidada) {
            const jaNotificado = await db.collection("notificacoesUsuario").findOne({
              userId: usuario._id,
              acao: "validar_conta",
              lido: { $in: [false, null] },
            });
            if (!jaNotificado) {
              await db.collection("notificacoesUsuario").insertOne({
                userId: usuario._id,
                titulo: "Confirme seu e-mail",
                mensagem: "Sua conta ainda não está validada. Clique para finalizar a verificação.",
                tipo: "sistema",
                acao: "validar_conta",
                lido: false,
                importante: true,
                data: new Date(),
                dataLido: null,
                expiraEm: null,
              });
            }
          }
        } else {
          token.newUser = true;
          token.contaValidada = false;
          token.systemRole = "user";
          token.isBlocked = false;
        }
      } else if (token.email) {
        // Refresh periódico (a cada updateAge segundos): sincroniza campos do banco com o token
        const client = await clientPromise;
        const db = client.db(process.env.MONGODB_DB);
        const usuario = await db.collection("users").findOne(
          { email: token.email },
          { projection: { contaValidada: 1, isBlocked: 1, systemRole: 1, nome: 1, sobrenome: 1, telefone: 1, username: 1, image: 1 } }
        );
        if (usuario) {
          token.contaValidada = usuario.contaValidada || false;
          token.isBlocked = usuario.isBlocked || false;
          token.systemRole = usuario.systemRole || token.systemRole || "user";
          token.nome = usuario.nome || token.nome || "";
          token.sobrenome = usuario.sobrenome || token.sobrenome || "";
          token.telefone = usuario.telefone || token.telefone || "";
          token.username = usuario.username || token.username || "";
          if (usuario.image) token.image = usuario.image;
        }
      }
      return token;
    },

    async session({ session, token }) {
      // Lê apenas do token JWT — sem query ao banco neste callback
      session.user.id = token.id;
      session.user.name = token.nome || token.name;
      session.user.email = token.email;
      session.user.image = token.image;
      session.user.sobrenome = token.sobrenome || "";
      session.user.telefone = token.telefone || "";
      session.user.username = token.username || "";
      session.user.newUser = token.newUser || false;
      session.user.contaValidada = token.contaValidada || false;
      session.user.systemRole = token.systemRole || "user";
      session.user.isBlocked = token.isBlocked ?? false;
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: sessionMaxAge,
    updateAge: sessionUpdateAge,
  },
  jwt: {
    maxAge: sessionMaxAge,
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  secret: process.env.JWT_SECRET,
};

export default NextAuth(authOptions);
