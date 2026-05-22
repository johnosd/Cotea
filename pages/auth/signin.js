// pages/auth/signin.js
import { useSession, signIn } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/router";

export default function SignIn() {
  const { data: session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session) {
      if (session.user.newUser) {
        // Se for um novo usuário, redirecionar para a tela de cadastro
        router.push("/cadastro");
      } else {
        // Se o usuário já existe, pode redirecionar para a página principal
        router.push("/");
      }
    }
  }, [session, router]);

  return (
    <main className="pt-[100px] min-h-screen flex flex-col justify-center items-center bg-gray-100 p-6">
      <h1 className="text-2xl font-bold mb-6">Entrar com sua conta</h1>
      <button
        onClick={() => signIn("google")}
        className="bg-red-600 text-white px-6 py-3 rounded hover:bg-red-700 transition"
      >
        Entrar com Google
      </button>
    </main>
  );
}
