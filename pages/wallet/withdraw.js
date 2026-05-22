import { useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Header from '../../components/Header';

export default function WalletWithdraw() {
  const { status } = useSession();
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [cpfPixKey, setCpfPixKey] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/withdraw/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount), cpfPixKey }),
      });
      const data = await res.json();
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Chave PIX (CPF - 11 dígitos)</label>
              <input
                type="text"
                value={cpfPixKey}
                onChange={(e) => setCpfPixKey(e.target.value.replace(/\D/g, ''))}
                maxLength={11}
                className="w-full border rounded px-3 py-2"
                placeholder="Somente números"
                required
                disabled={loading}
              />
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
