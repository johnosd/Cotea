import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Header from '../../components/Header';

export default function WalletHome() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [balances, setBalances] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!session) return;
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/wallet/balance');
        if (!res.ok) {
          throw new Error((await res.json())?.error || 'Falha ao carregar saldo');
        }
        const data = await res.json();
        setBalances(data);
      } catch (err) {
        setError(err.message || 'Erro ao carregar saldo');
      } finally {
        setLoading(false);
      }
    };
    if (status === 'authenticated') {
      load();
    }
  }, [status, session]);

  return (
    <>
      <Header />
      <main className="pt-28 pb-12 px-4">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Minha carteira</h1>
            <div className="flex gap-2">
              <Link href="/wallet/add" className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700 text-sm">
                Adicionar via PIX
              </Link>
              <Link href="/wallet/pay" className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm">
                Usar saldo
              </Link>
              <Link href="/wallet/withdraw" className="px-3 py-2 rounded bg-purple-600 text-white hover:bg-purple-700 text-sm">
                Sacar
              </Link>
              <Link href="/wallet/invoices" className="px-3 py-2 rounded bg-gray-800 text-white hover:bg-gray-900 text-sm">
                Ver faturas
              </Link>
            </div>
          </div>

          {status === 'loading' && <p className="text-gray-500">Carregando sessão...</p>}
          {status === 'unauthenticated' && <p className="text-red-600">Faça login para ver sua carteira.</p>}
          {loading && <p className="text-gray-500">Atualizando saldo...</p>}
          {error && <p className="text-red-600">{error}</p>}

          {balances && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                <p className="text-sm text-gray-500">Saldo disponível</p>
                <p className="text-2xl font-semibold text-gray-900">
                  R$ {Number(balances.available || 0).toFixed(2)}
                </p>
              </div>
              <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                <p className="text-sm text-gray-500">Saldo total</p>
                <p className="text-2xl font-semibold text-gray-900">R$ {Number(balances.balance || 0).toFixed(2)}</p>
              </div>
              <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                <p className="text-sm text-gray-500">Bloqueado para saque</p>
                <p className="text-xl font-semibold text-gray-900">
                  R$ {Number(balances.blockedDebits || 0).toFixed(2)}
                </p>
              </div>
              <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                <p className="text-sm text-gray-500">Valores pendentes</p>
                <p className="text-xl font-semibold text-gray-900">
                  R$ {Number(balances.pendingTotal || 0).toFixed(2)}
                </p>
              </div>
              <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
                <p className="text-sm text-gray-500">Valores estornados</p>
                <p className="text-xl font-semibold text-gray-900">
                  R$ {Number(balances.returnedTotal || 0).toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
