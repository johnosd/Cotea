import Image from "next/image";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header";
import EnderecoCampos, { ENDERECO_VAZIO } from "../components/EnderecoCampos";
import { validarCpf } from "../lib/cadastro-financeiro";
import { mascararCPF } from "../lib/cpf-mascara";

export default function Perfil() {
  const { data: session, status, update } = useSession();

  const [nome, setNome] = useState("");
  const [sobrenome, setSobrenome] = useState("");
  const [email, setEmail] = useState("");
  const [imagem, setImagem] = useState("");
  const [telefone, setTelefone] = useState("");
  const [username, setUsername] = useState("");
  const [cpf, setCpf] = useState("");
  // 004-cadastro-financeiro: depois de salvo, o CPF fica travado e só aparece mascarado.
  const [cpfTravado, setCpfTravado] = useState(false);
  const [cpfMascarado, setCpfMascarado] = useState("");
  const [errosCampos, setErrosCampos] = useState({});
  const [contaValidada, setContaValidada] = useState(false);
  const [saldoDisponivel, setSaldoDisponivel] = useState(0);
  const [saldoCaucao, setSaldoCaucao] = useState(0);
  const [usa2FA, setUsa2FA] = useState(false);
  const [pinSeguranca, setPinSeguranca] = useState("");
  const [endereco, setEndereco] = useState(ENDERECO_VAZIO);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [aba, setAba] = useState("dados");

  const inicial = useMemo(
    () => (nome?.[0] || session?.user?.name?.[0] || session?.user?.email?.[0] || "U").toUpperCase(),
    [nome, session?.user]
  );

  useEffect(() => {
    const carregarPerfil = async () => {
      if (status !== "authenticated" || !session?.user?.email) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/atualizarPerfil?email=${encodeURIComponent(session.user.email)}`);
        if (!res.ok) {
          if (res.status !== 404) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || "Erro ao carregar perfil");
          }
          setNome(session.user.nome || session.user.name || "");
          setSobrenome(session.user.sobrenome || "");
          setEmail(session.user.email || "");
          setImagem(session.user.image || "");
          setTelefone(session.user.telefone || "");
          setUsername(session.user.username || "");
          setMensagem("Complete seu perfil e salve para criar o registro.");
          return;
        }
        const user = await res.json();
        setNome(user.nome || session.user.name || "");
        setSobrenome(user.sobrenome || "");
        setEmail(user.email || "");
        setImagem(user.image || "");
        setTelefone(user.telefone || "");
        setUsername(user.username || "");
        setCpf("");
        setCpfTravado(Boolean(user.cpfTravado));
        setCpfMascarado(user.cpfMascarado || "");
        setContaValidada(Boolean(user.contaValidada));
        setSaldoDisponivel(Number(user.saldoDisponivel) || 0);
        setSaldoCaucao(Number(user.saldoCaucao) || 0);
        setUsa2FA(Boolean(user.usa2FA));
        setPinSeguranca(user.pinSeguranca || "");
        setEndereco({
          cep: user.endereco?.cep || "",
          uf: user.endereco?.uf || "",
          cidade: user.endereco?.cidade || "",
          bairro: user.endereco?.bairro || "",
          rua: user.endereco?.rua || "",
          numero: user.endereco?.numero || "",
          complemento: user.endereco?.complemento || "",
        });
      } catch (err) {
        setErro("Erro ao carregar dados do perfil.");
      }
      setLoading(false);
    };
    carregarPerfil();
  }, [status, session]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensagem("");
    setErro("");
    setErrosCampos({});
    const cpfDigitos = cpf.replace(/\D/g, "");
    if (!cpfTravado && cpfDigitos && !validarCpf(cpfDigitos)) {
      setErrosCampos({ cpf: "CPF invalido." });
      setAba("endereco");
      return;
    }
    setLoading(true);

    try {
      const response = await fetch("/api/atualizarPerfil", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // CPF travado não é reenviado (o servidor ignoraria de qualquer forma).
        body: JSON.stringify({ email, nome, sobrenome, imagem, telefone, username, cpf: cpfTravado ? undefined : cpfDigitos, endereco }),
      });

      if (response.ok) {
        setMensagem("Perfil atualizado com sucesso!");
        if (!cpfTravado && cpfDigitos) {
          setCpfTravado(true);
          setCpfMascarado(mascararCPF(cpfDigitos));
          setCpf("");
        }
        await update();
      } else {
        const data = await response.json();
        setErro(data.message || "Erro ao atualizar perfil.");
        if (data.campos) {
          setErrosCampos(data.campos);
          setAba("endereco");
        } else if (data.codigo === "cpf_indisponivel") {
          setErrosCampos({ cpf: data.message });
          setAba("endereco");
        }
      }
    } catch (error) {
      setErro("Erro ao atualizar perfil.");
    }

    setLoading(false);
  };

  if (status === "loading" || loading) return <p>Carregando...</p>;
  if (!session) return <p>Voce precisa estar logado para acessar esta pagina.</p>;

  return (
    <>
      <Header />
      <div className="min-h-screen flex justify-center items-start bg-gray-100 p-4 pt-32">
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded shadow max-w-2xl w-full space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Perfil do Usuario</h2>
            <div className="w-14 h-14 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-700">
              {imagem ? (
                <Image src={imagem} alt="Imagem do usuario" width={56} height={56} className="w-14 h-14 object-cover" />
              ) : (
                inicial
              )}
            </div>
          </div>

          <div className="flex border-b border-gray-200 text-sm font-semibold text-gray-700">
            <button
              type="button"
              onClick={() => setAba("dados")}
              className={`px-4 py-2 border-b-2 ${aba === "dados" ? "border-blue-600 text-blue-600" : "border-transparent"}`}
            >
              Dados pessoais
            </button>
            <button
              type="button"
              onClick={() => setAba("endereco")}
              className={`px-4 py-2 border-b-2 ${aba === "endereco" ? "border-blue-600 text-blue-600" : "border-transparent"}`}
            >
              CPF e endereco
            </button>
          </div>

          {aba === "dados" && (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full p-3 border rounded"
              />
              <input
                type="text"
                placeholder="Sobrenome"
                value={sobrenome}
                onChange={(e) => setSobrenome(e.target.value)}
                className="w-full p-3 border rounded"
              />
              <input type="email" placeholder="Email" value={email} disabled className="w-full p-3 border rounded bg-gray-50" />
              <input
                type="text"
                placeholder="Telefone"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                className="w-full p-3 border rounded"
              />
              <input
                type="text"
                placeholder="Nome de usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
                className="w-full p-3 border rounded"
              />
              <div className="text-sm text-gray-700 space-y-1">
                <p>
                  <span className="font-semibold">Conta validada:</span> {contaValidada ? "Sim" : "Nao"}
                </p>
                <p>
                  <span className="font-semibold">Saldo disponivel:</span> R$ {saldoDisponivel.toFixed(2)}
                </p>
                <p>
                  <span className="font-semibold">Saldo caucao:</span> R$ {saldoCaucao.toFixed(2)}
                </p>
                <p>
                  <span className="font-semibold">2FA:</span> {usa2FA ? "Ativado" : "Desativado"}
                </p>
                {pinSeguranca ? (
                  <p className="text-xs text-gray-500">PIN configurado.</p>
                ) : (
                  <p className="text-xs text-gray-500">PIN nao configurado.</p>
                )}
              </div>
            </div>
          )}

          {aba === "endereco" && (
            <div className="space-y-3">
              {cpfTravado ? (
                <div>
                  <input
                    type="text"
                    aria-label="CPF"
                    value={cpfMascarado}
                    readOnly
                    className="w-full p-3 border rounded bg-gray-50 text-gray-600"
                  />
                  <p className="text-xs text-gray-500 mt-1">CPF confirmado. Para corrigir, fale com o suporte.</p>
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    placeholder="CPF"
                    aria-label="CPF"
                    inputMode="numeric"
                    maxLength={14}
                    value={cpf}
                    onChange={(e) => setCpf(e.target.value)}
                    className="w-full p-3 border rounded"
                  />
                  <p className="text-xs text-gray-500 mt-1">Depois de salvo, o CPF nao pode ser alterado por voce.</p>
                  {errosCampos.cpf && <p className="text-sm text-red-600 mt-1">{errosCampos.cpf}</p>}
                </div>
              )}
              <EnderecoCampos endereco={endereco} onChange={setEndereco} erro={errosCampos.endereco} />
            </div>
          )}

          {mensagem && <p className="text-green-600 mb-2">{mensagem}</p>}
          {erro && <p className="text-red-600 mb-2">{erro}</p>}

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
              disabled={loading}
            >
              {loading ? "Salvando..." : "Salvar Alteracoes"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
