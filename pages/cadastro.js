// pages/cadastro.js
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";

export default function Cadastro() {
  const { data: session } = useSession();
  const router = useRouter();

  const fullName = useMemo(() => session?.user?.name || "", [session?.user?.name]);
  const [nome, setNome] = useState("");
  const [sobrenome, setSobrenome] = useState("");
  const [email] = useState(session?.user?.email || "");
  const [image] = useState(session?.user?.image || "");
  const [telefone, setTelefone] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!fullName) return;
    const [primeiro, ...restante] = fullName.trim().split(" ");
    setNome((v) => (v ? v : primeiro || ""));
    setSobrenome((v) => (v ? v : restante.join(" ") || ""));
  }, [fullName]);

  const validarCampos = () => {
    const usernameLimpo = username.trim().toLowerCase();
    const telefoneLimpo = telefone.replace(/\D/g, "");

    if (!nome.trim() || !sobrenome.trim() || !email || !usernameLimpo) {
      return "Nome, sobrenome e usuario sao obrigatorios.";
    }

    if (!/^[a-z0-9_.-]{3,20}$/i.test(usernameLimpo)) {
      return "Usuario deve ter 3-20 caracteres (letras, numeros, . _ -).";
    }

    if (telefoneLimpo && telefoneLimpo.length < 10) {
      return "Telefone invalido. Informe DDD + numero.";
    }

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const mensagemErro = validarCampos();
    if (mensagemErro) {
      setErro(mensagemErro);
      return;
    }

    setLoading(true);
    setErro("");

    const payload = {
      nome: nome.trim(),
      sobrenome: sobrenome.trim(),
      email,
      image,
      telefone: telefone.replace(/\D/g, ""),
      username: username.trim().toLowerCase(),
    };

    const response = await fetch("/api/cadastro", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      router.push("/verificacao");
    } else {
      const data = await response.json();
      setErro(data.message || "Erro ao cadastrar.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex justify-center items-center bg-gray-100">
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">Cadastro de Usuario</h2>
        <img src={image} alt="Imagem do usuario" className="w-20 h-20 rounded-full mx-auto mb-4" />

        <input
          type="text"
          placeholder="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="w-full p-3 mb-4 border rounded"
        />

        <input
          type="text"
          placeholder="Sobrenome"
          value={sobrenome}
          onChange={(e) => setSobrenome(e.target.value)}
          className="w-full p-3 mb-4 border rounded"
        />

        <input
          type="email"
          placeholder="Email"
          value={email}
          disabled
          className="w-full p-3 mb-4 border rounded"
        />

        <input
          type="text"
          placeholder="Telefone (DDD + numero)"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
          className="w-full p-3 mb-4 border rounded"
        />

        <input
          type="text"
          placeholder="Nome de usuario"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full p-3 mb-4 border rounded"
        />

        {erro && <p className="text-red-500 text-sm mb-2">{erro}</p>}

        <button
          type="submit"
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
          disabled={loading}
        >
          {loading ? "Cadastrando..." : "Cadastrar"}
        </button>
      </form>
    </div>
  );
}
