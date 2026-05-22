import { useSession, signIn } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";

const STORAGE_KEY = "verificacao_enviado";

export default function Verificacao() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [loading, setLoading] = useState(false);
  const sentRef = useRef(false);

  const marcarEnviado = () => {
    setEnviado(true);
    try { sessionStorage.setItem(STORAGE_KEY, "1"); } catch (_) { /* privado/SSR */ }
  };

  const enviarCodigo = async () => {
    setMensagem("");
    setErro("");
    setLoading(true);
    try {
      const response = await fetch("/api/sendVerificationCode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: session.user.email }),
      });
      if (response.ok) {
        setMensagem("Código enviado! Verifique sua caixa de entrada.");
        marcarEnviado();
      } else {
        const data = await response.json().catch(() => ({}));
        setErro(data.message || "Erro ao enviar o código.");
      }
    } catch {
      setErro("Erro ao comunicar com o servidor.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.email) return;

    if (session.user.contaValidada) {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) { /* */ }
      router.push("/");
      return;
    }

    // Se já enviou nesta sessão do browser, só mostra o formulário
    try {
      if (sessionStorage.getItem(STORAGE_KEY)) {
        setEnviado(true);
        return;
      }
    } catch (_) { /* */ }

    // Primeira visita: auto-envia uma vez (sentRef evita duplo disparo no StrictMode)
    if (sentRef.current) return;
    sentRef.current = true;
    enviarCodigo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  const verificarCodigo = async (e) => {
    e.preventDefault();
    setErro("");
    setMensagem("");
    try {
      const response = await fetch("/api/verifyEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigo.trim().toUpperCase(), email: session.user.email }),
      });
      if (response.ok) {
        try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) { /* */ }
        setMensagem("Conta verificada com sucesso!");
        await signIn("google", { redirect: false });
        router.push("/");
      } else {
        const data = await response.json().catch(() => ({}));
        setErro(data.message || "Código inválido ou expirado.");
      }
    } catch {
      setErro("Erro ao verificar o código.");
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex justify-center items-center bg-gray-100">
        <p className="text-gray-600">Carregando...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex justify-center items-center bg-gray-100">
        <p className="text-gray-600">Você precisa estar logado para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex justify-center items-center bg-gray-100 p-4">
      <div className="bg-white p-6 rounded shadow max-w-md w-full">
        <h2 className="text-xl font-bold mb-2">Verifique seu E-mail</h2>
        <p className="text-sm text-gray-500 mb-4">
          Enviamos um código para <strong>{session.user.email}</strong>.
        </p>

        {mensagem && <p className="text-green-600 text-sm mb-4">{mensagem}</p>}
        {erro && <p className="text-red-600 text-sm mb-4">{erro}</p>}

        {loading && !enviado ? (
          <p className="text-gray-500 text-sm text-center py-4">Enviando código...</p>
        ) : enviado ? (
          <form onSubmit={verificarCodigo} className="space-y-3">
            <input
              type="text"
              placeholder="Digite o código recebido"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className="w-full p-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="one-time-code"
              maxLength={8}
            />
            <button
              type="submit"
              className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 transition"
            >
              Verificar código
            </button>
            <button
              type="button"
              onClick={enviarCodigo}
              disabled={loading}
              className="w-full bg-gray-100 text-gray-700 py-2 rounded hover:bg-gray-200 transition text-sm disabled:opacity-50"
            >
              {loading ? "Reenviando..." : "Reenviar código"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="w-full bg-gray-400 text-white py-2 rounded hover:bg-gray-500 transition text-sm"
            >
              Validar depois
            </button>
          </form>
        ) : (
          <button
            onClick={enviarCodigo}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? "Enviando..." : "Enviar código"}
          </button>
        )}
      </div>
    </div>
  );
}
