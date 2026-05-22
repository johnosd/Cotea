import Image from "next/image";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header";

export default function Perfil() {
  const { data: session, status, update } = useSession();

  const [nome, setNome] = useState("");
  const [sobrenome, setSobrenome] = useState("");
  const [email, setEmail] = useState("");
  const [imagem, setImagem] = useState("");
  const [telefone, setTelefone] = useState("");
  const [username, setUsername] = useState("");
  const [cpf, setCpf] = useState("");
  const [contaValidada, setContaValidada] = useState(false);
  const [saldoDisponivel, setSaldoDisponivel] = useState(0);
  const [saldoCaucao, setSaldoCaucao] = useState(0);
  const [usa2FA, setUsa2FA] = useState(false);
  const [pinSeguranca, setPinSeguranca] = useState("");
  const [endereco, setEndereco] = useState({
    cep: "",
    uf: "",
    cidade: "",
    bairro: "",
    rua: "",
    numero: "",
    complemento: "",
  });
  const [cepStatus, setCepStatus] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [aba, setAba] = useState("dados");

  const inicial = useMemo(
    () => (nome?.[0] || session?.user?.name?.[0] || session?.user?.email?.[0] || "U").toUpperCase(),
    [nome, session?.user]
  );

  const cepLimpo = useMemo(() => (endereco.cep || "").replace(/\D/g, ""), [endereco.cep]);

  const limparCamposEndereco = () =>
    setEndereco((prev) => ({
      ...prev,
      uf: "",
      cidade: "",
      bairro: "",
      rua: "",
    }));

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
        setCpf(user.cpf || "");
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

  useEffect(() => {
    if (!cepLimpo) {
      setCepStatus("");
      return;
    }

    if (cepLimpo.length !== 8) {
      setCepStatus("CEP deve ter 8 digitos.");
      limparCamposEndereco();
      return;
    }

    const controller = new AbortController();
    const buscarCep = async () => {
      setCepStatus("Buscando endereco...");
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error("Formato de CEP invalido");
        }

        const data = await res.json();
        if (data?.erro) {
          setCepStatus("CEP nao encontrado.");
          limparCamposEndereco();
          return;
        }

        setCepStatus("");
        setEndereco((prev) => ({
          ...prev,
          cep: cepLimpo,
          uf: data.uf || "",
          cidade: data.localidade || "",
          bairro: data.bairro || "",
          rua: data.logradouro || "",
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setCepStatus("Erro ao buscar CEP.");
        limparCamposEndereco();
      }
    };

    buscarCep();

    return () => controller.abort();
  }, [cepLimpo]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensagem("");
    setErro("");
    setLoading(true);

    try {
      const response = await fetch("/api/atualizarPerfil", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, nome, sobrenome, imagem, telefone, username, cpf, endereco }),
      });

      if (response.ok) {
        setMensagem("Perfil atualizado com sucesso!");
        await update();
      } else {
        const data = await response.json();
        setErro(data.message || "Erro ao atualizar perfil.");
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
              <input
                type="text"
                placeholder="CPF"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                className="w-full p-3 border rounded"
              />
              <fieldset className="border rounded p-3">
                <legend className="text-sm font-semibold text-gray-700 px-2">Endereco</legend>
                <input
                  type="text"
                  placeholder="CEP"
                  value={endereco.cep}
                  maxLength={8}
                  pattern="\d{8}"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  onChange={(e) => {
                    const rawCep = e.target.value.replace(/\D/g, "");
                    setEndereco((prev) => ({ ...prev, cep: rawCep }));
                    if (!rawCep) {
                      setCepStatus("");
                    }
                  }}
                  className="w-full p-2 mb-2 border rounded"
                />
                {cepStatus && (
                  <div className={`text-xs mb-1 ${cepStatus.startsWith("Buscando") ? "text-blue-600" : "text-red-600"}`}>
                    {cepStatus}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="UF"
                    value={endereco.uf}
                    onChange={(e) => setEndereco((prev) => ({ ...prev, uf: e.target.value }))}
                    className="w-20 p-2 mb-2 border rounded"
                    maxLength={2}
                  />
                  <input
                    type="text"
                    placeholder="Cidade"
                    value={endereco.cidade}
                    onChange={(e) => setEndereco((prev) => ({ ...prev, cidade: e.target.value }))}
                    className="flex-1 p-2 mb-2 border rounded"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Bairro"
                  value={endereco.bairro}
                  onChange={(e) => setEndereco((prev) => ({ ...prev, bairro: e.target.value }))}
                  className="w-full p-2 mb-2 border rounded"
                />
                <input
                  type="text"
                  placeholder="Rua"
                  value={endereco.rua}
                  onChange={(e) => setEndereco((prev) => ({ ...prev, rua: e.target.value }))}
                  className="w-full p-2 mb-2 border rounded"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Numero"
                    value={endereco.numero}
                    onChange={(e) => setEndereco((prev) => ({ ...prev, numero: e.target.value }))}
                    className="w-24 p-2 mb-2 border rounded"
                  />
                  <input
                    type="text"
                    placeholder="Complemento"
                    value={endereco.complemento}
                    onChange={(e) => setEndereco((prev) => ({ ...prev, complemento: e.target.value }))}
                    className="flex-1 p-2 mb-2 border rounded"
                  />
                </div>
              </fieldset>
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
