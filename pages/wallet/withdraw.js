import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Header from '../../components/Header';
import CadastroFinanceiroForm, { ehCadastroIncompleto } from '../../components/CadastroFinanceiroForm';

export default function WalletWithdraw() {
  const { status } = useSession();
  const router = useRouter();
  const [amount, setAmount] = useState('');
  // 004-cadastro-financeiro (FR-016): a chave PIX é sempre o CPF do cadastro, só exibido mascarado.
  const [chaveMascarada, setChaveMascarada] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 004-cadastro-financeiro (US3): pendências devolvidas pela API abrem o formulário embutido.
  const [pendenciasCadastro, setPendenciasCadastro] = useState(null);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    let ativo = true;
    fetch('/api/perfil/cadastro-financeiro')
      .then((r) => (r.ok ? r.json() : null))
      .then((dados) => { if (ativo && dados?.cpfTravado) setChaveMascarada(dados.cpfMascarado); })
      .catch(() => {});
    return () => { ativo = false; };
  }, [status]);

  const enviar = async () => {
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/withdraw/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const data = await res.json();
      if (ehCadastroIncompleto(data)) {
        setPendenciasCadastro(data.pendencias);
        return;
      }
      if (!res.ok) throw new Error(data?.error || 'Erro ao solicitar saque');
      setResult(data);
      // Após sucesso, envia para resumo da carteira
      setTimeout(() => router.push('/wallet'), 800);
    } catch (err) {
      setError(err.message || 'Erro ao solicitar saque');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    enviar();
  };

  const isAuth = status === 'authenticated';

  return (
    <>
      <Header />
      <main className="pt-28 pb-12 px-4">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Solicitar saque</h1>
            <Link href="/wallet" className="text-sm text-blue-600 hover:underline">
              Voltar para carteira
            </Link>
          </div>

          {!isAuth && <p className="text-red-600">Faça login para sacar.</p>}

          {pendenciasCadastro && (
            <div className="mt-4">
              <CadastroFinanceiroForm
                pendencias={pendenciasCadastro}
                onCancelar={() => setPendenciasCadastro(null)}
                onSalvo={(dados) => {
                  setPendenciasCadastro(null);
                  if (dados?.cpfMascarado) setChaveMascarada(dados.cpfMascarado);
                  enviar();
                }}
              />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="120.00"
                required
                disabled={!isAuth || loading}
              />
            </div>
            <div>
              <p className="block text-sm font-medium text-gray-700 mb-1">Chave PIX</p>
              <p className="text-sm text-gray-800">
                {chaveMascarada ? `CPF ${chaveMascarada}` : 'CPF do seu cadastro financeiro (sera pedido ao solicitar, se faltar).'}
              </p>
              <p className="text-xs text-gray-500 mt-1">O saque e sempre enviado para o CPF do titular da conta.</p>
            </div>

            <button
              type="submit"
              className="px-4 py-2 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              disabled={!isAuth || loading}
            >
              {loading ? 'Enviando...' : 'Solicitar saque'}
            </button>
          </form>

          {error && <p className="text-red-600 mt-4">{error}</p>}
          {result && (
            <div className="mt-6 p-4 border rounded-lg bg-gray-50">
              <p className="text-sm text-gray-600">Solicitação enviada</p>
              <p className="text-sm text-gray-700 mt-1">Withdrawal ID: {result.withdrawalId}</p>
              <p className="text-sm text-gray-700 mt-1">Status: {result.status}</p>
              <p className="text-sm text-gray-700 mt-1">
                Saldo: R$ {Number(result.balance || 0).toFixed(2)} | Disponível:{' '}
                {Number(result.available || 0).toFixed(2)}
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
