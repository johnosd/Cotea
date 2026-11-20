// pages/auth/signin.js
import { useSession, signIn } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/router";
import { destinoSeguro } from "../../lib/redirecionamento";

export default function SignIn() {
  const { data: session } = useSession();
  const router = useRouter();
  const destino = destinoSeguro(router.query.callbackUrl);

  useEffect(() => {
    if (!router.isReady || !session) return;
    if (session.user.newUser) {
      // Novo usuário: completa o cadastro antes de seguir
      router.replace("/cadastro");
    } else {
      // Usuário existente: volta para onde estava tentando ir (ex.: /admin?tab=rotinas)
      router.replace(destino);
    }
  }, [session, router, destino]);

  return (
    <main className="pt-[100px] min-h-screen flex flex-col justify-center items-center bg-gray-100 p-6">
      <h1 className="text-2xl font-bold mb-6">Entrar com sua conta</h1>
      <button
        onClick={() => signIn("google", { callbackUrl: destino })}
        className="bg-red-600 text-white px-6 py-3 rounded hover:bg-red-700 transition"
      >
        Entrar com Google
      </button>
    </main>
  );
}
