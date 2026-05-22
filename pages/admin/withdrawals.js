import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import Header from '../../components/Header';
import { PERMISSIONS, hasRole } from '../../lib/authz';

export default function AdminWithdrawals() {
  const { data: session, status } = useSession();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  const canList = useMemo(() => hasRole(session, PERMISSIONS.WITHDRAWALS_TAB), [session]);
  const canAct = useMemo(() => hasRole(session, ['admin', 'finance']), [session]);
  const isBlocked = Boolean(session?.user?.isBlocked);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/withdraw/list');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao listar saques');
      setItems(data || []);
    } catch (err) {
      setError(err.message || 'Erro ao listar saques');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated' && canList) {
      load();
    }
  }, [status, canList]);

  const act = async (endpoint, withdrawalId) => {
    setActionLoading(withdrawalId + endpoint);
    setError('');
    try {
      const res = await fetch(`/api/withdraw/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withdrawalId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro na acao');
      setItems((prev) => prev.map((w) => (w._id === withdrawalId ? { ...w, status: data.status } : w)));
    } catch (err) {
      setError(err.message || 'Erro ao executar acao');
    } finally {
      setActionLoading('');
    }
  };

  const pending = items.filter((w) => w.status === 'requested' || w.status === 'blocked');
  const finalized = items.filter((w) => w.status === 'paid' || w.status === 'rejected');

  return (
    <>
      <Header admin />
      <main className="pt-28 pb-12 px-4">
        <div className="max-w-5xl mx-auto bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Administracao de saques</h1>
          </div>

          {status === 'loading' && <p className="text-gray-500">Carregando sessao...</p>}
          {status === 'unauthenticated' && <p className="text-red-600">Faca login para acessar.</p>}
          {status === 'authenticated' && isBlocked && <p className="text-red-600">Conta bloqueada. Procure o suporte.</p>}
          {status === 'authenticated' && !isBlocked && !canList && (
            <p className="text-red-600">Acesso restrito ao time (admin/finance/support).</p>
          )}

          {error && <p className="text-red-600 mb-3">{error}</p>}

          {canList && !isBlocked && (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Pendentes</h2>
                <button
                  onClick={load}
                  className="px-3 py-2 rounded bg-gray-100 text-gray-700 border hover:bg-gray-200 disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? 'Atualizando...' : 'Atualizar'}
                </button>
              </div>
              {loading && <p className="text-gray-500">Carregando saques...</p>}
              {!loading && pending.length === 0 && <p className="text-gray-600 mb-4">Nenhum saque pendente.</p>}

              <div className="space-y-3">
                {pending.map((w) => (
                  <div key={w._id} className="p-4 border rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-gray-700">
                        Usuario: <span className="font-semibold">{w.userId}</span>
                      </p>
                      <p className="text-sm text-gray-700">
                        Valor: <span className="font-semibold">R$ {Number(w.amount || 0).toFixed(2)}</span>
                      </p>
                      <p className="text-sm text-gray-700">Status: {w.status}</p>
                      <p className="text-sm text-gray-700">PIX CPF: {w.pixKeyCpf}</p>
                    </div>
                    <div className="flex gap-2 mt-3 sm:mt-0">
                      <button
                        onClick={() => act('approve', w._id)}
                        className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                        disabled={actionLoading === w._id + 'approve' || !canAct}
                      >
                        {actionLoading === w._id + 'approve' ? 'Aprovando...' : 'Aprovar'}
                      </button>
                      <button
                        onClick={() => act('reject', w._id)}
                        className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        disabled={actionLoading === w._id + 'reject' || !canAct}
                      >
                        {actionLoading === w._id + 'reject' ? 'Rejeitando...' : 'Rejeitar'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <h2 className="text-lg font-semibold mt-8 mb-3">Finalizados</h2>
              {finalized.length === 0 && <p className="text-gray-600">Nenhum saque finalizado.</p>}
              <div className="space-y-2">
                {finalized.map((w) => (
                  <div key={w._id} className="p-3 border rounded bg-gray-50">
                    <p className="text-sm text-gray-700">
                      #{w._id} - R$ {Number(w.amount || 0).toFixed(2)} - {w.status}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
