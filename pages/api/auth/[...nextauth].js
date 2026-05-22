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
          token.contaValidada = usuario.contaValidada || false;
          token.sobrenome = usuario.sobrenome || "";
          token.telefone = usuario.telefone || "";
          token.username = usuario.username || "";
          token.systemRole = usuario.systemRole || "user";
          token.isBlocked = usuario.isBlocked || false;

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
        // Refresh do token: atualiza campos voláteis do banco para o middleware funcionar corretamente
        const client = await clientPromise;
        const db = client.db(process.env.MONGODB_DB);
        const usuario = await db.collection("users").findOne(
          { email: token.email },
          { projection: { contaValidada: 1, isBlocked: 1, systemRole: 1 } }
        );
        if (usuario) {
          token.contaValidada = usuario.contaValidada || false;
          token.isBlocked = usuario.isBlocked || false;
          token.systemRole = usuario.systemRole || token.systemRole || "user";
        }
      }
      return token;
    },

    async session({ session, token }) {
      const client = await clientPromise;
      const db = client.db(process.env.MONGODB_DB);
      const usuario = await db.collection("users").findOne({ email: token.email });

      session.user.id = usuario?._id || token.id;
      session.user.name = usuario?.nome || token.name;
      session.user.email = usuario?.email || token.email;
      session.user.image = usuario?.image || token.image;
      session.user.sobrenome = usuario?.sobrenome || "";
      session.user.telefone = usuario?.telefone || "";
      session.user.username = usuario?.username || "";
      session.user.newUser = token.newUser || false;
      session.user.contaValidada = usuario?.contaValidada || false;
      session.user.systemRole = usuario?.systemRole || token.systemRole || "user";
      session.user.isBlocked = usuario?.isBlocked ?? token.isBlocked ?? false;

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
