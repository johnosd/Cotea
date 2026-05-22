import { useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Header from '../../components/Header';

export default function WalletPay() {
  const { status } = useSession();
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/wallet/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount), description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao usar saldo');
      setResult(data);
      setTimeout(() => router.push('/wallet'), 800);
    } catch (err) {
      setError(err.message || 'Erro ao usar saldo');
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
            <h1 className="text-2xl font-bold text-gray-900">Usar saldo</h1>
            <Link href="/wallet" className="text-sm text-blue-600 hover:underline">
              Voltar para carteira
            </Link>
          </div>

          {!isAuth && <p className="text-red-600">Faça login para usar saldo.</p>}

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
                placeholder="50.00"
                required
                disabled={!isAuth || loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descrição (opcional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="Pagamento interno"
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={!isAuth || loading}
            >
              {loading ? 'Processando...' : 'Debitar saldo'}
            </button>
          </form>

          {error && <p className="text-red-600 mt-4">{error}</p>}
          {result && (
            <div className="mt-6 p-4 border rounded-lg bg-gray-50">
              <p className="text-sm text-gray-600">Débito realizado</p>
              <p className="text-sm text-gray-700 mt-1">Ledger ID: {result.ledgerId}</p>
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
