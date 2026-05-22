import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Header from '../../components/Header';

const STATUS_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'confirmed', label: 'Confirmados' },
  { value: 'failed', label: 'Falhados' },
];

export default function WalletInvoices() {
  const { status: sessionStatus } = useSession();
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);

  const fetchPayments = async (statusParam) => {
    setLoading(true);
    setError('');
    try {
      const query = statusParam && statusParam !== 'all' ? `?status=${statusParam}` : '';
      const res = await fetch(`/api/payments/list${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao carregar faturas');
      setItems(data || []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar faturas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sessionStatus === 'authenticated') {
      fetchPayments(statusFilter);
    }
  }, [sessionStatus, statusFilter]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return items;
    return items.filter((p) => p.status === statusFilter);
  }, [items, statusFilter]);

  return (
    <>
      <Header />
      <main className="pt-28 pb-12 px-4">
        <div className="max-w-4xl mx-auto bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Faturas / Pagamentos</h1>
            <Link href="/wallet" className="text-sm text-blue-600 hover:underline">
              Voltar para carteira
            </Link>
          </div>

          {sessionStatus === 'unauthenticated' && <p className="text-red-600">Faça login para ver suas faturas.</p>}

          <div className="flex items-center gap-3 mt-2 mb-4">
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-3 py-2 rounded text-sm ${
                  statusFilter === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => fetchPayments(statusFilter)}
              className="ml-auto px-3 py-2 rounded bg-gray-100 text-gray-700 border hover:bg-gray-200 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>

          {error && <p className="text-red-600 mb-3">{error}</p>}
          {loading && <p className="text-gray-500 mb-3">Carregando faturas...</p>}

          {!loading && filtered.length === 0 && (
            <p className="text-gray-600">Nenhuma fatura encontrada para o filtro selecionado.</p>
          )}

          <div className="mt-4 space-y-3">
            {filtered.map((p) => (
              <div key={p._id} className="p-4 border rounded-lg bg-gray-50 flex flex-col sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-gray-700">
                    Valor:{' '}
                    <span className="font-semibold">
                      R$ {Number(p.amount || 0).toFixed(2)}
                    </span>
                  </p>
                  <p className="text-sm text-gray-700">Status: {p.status}</p>
                  <p className="text-xs text-gray-500">Gateway: {p.gateway}</p>
                  <p className="text-xs text-gray-500">
                    Criado em: {p.createdAt ? new Date(p.createdAt).toLocaleString() : '-'}
                  </p>
                  {p.externalId && <p className="text-xs text-gray-500">External ID: {p.externalId}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
