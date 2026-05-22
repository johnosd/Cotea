import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import Header from '../../components/Header';
import { PERMISSIONS, hasRole } from '../../lib/authz';

const ROLES = [
  { value: 'user',    label: 'Usuário' },
  { value: 'support', label: 'Suporte' },
  { value: 'finance', label: 'Financeiro' },
  { value: 'admin',   label: 'Admin' },
];

const ROLE_BADGE = {
  user:    'bg-gray-100 text-gray-700',
  support: 'bg-blue-100 text-blue-700',
  finance: 'bg-yellow-100 text-yellow-700',
  admin:   'bg-purple-100 text-purple-700',
};

const TABS = [
  { id: 'users', label: 'Usuarios', roles: PERMISSIONS.USERS_TAB },
  { id: 'groups', label: 'Grupos', roles: PERMISSIONS.GROUPS_TAB },
  { id: 'withdrawals', label: 'Saques', roles: PERMISSIONS.WITHDRAWALS_TAB },
  { id: 'audit', label: 'Auditoria', roles: PERMISSIONS.AUDIT_TAB },
];

function UsersTab({ allowed, canChangeRole, currentUserId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao carregar usuarios');
      setItems(data || []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  const toggleBlock = async (id, isBlocked) => {
    setActionLoading(`block-${id}`);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${id}/block`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isBlocked: !isBlocked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao atualizar usuario');
      setItems((prev) =>
        prev.map((u) => (u._id === id ? { ...u, isBlocked: data.isBlocked } : u))
      );
    } catch (err) {
      setError(err.message || 'Erro ao atualizar usuario');
    } finally {
      setActionLoading('');
    }
  };

  const changeRole = async (id, systemRole) => {
    setActionLoading(`role-${id}`);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${id}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao alterar papel');
      setItems((prev) =>
        prev.map((u) => (u._id === id ? { ...u, systemRole: data.systemRole } : u))
      );
    } catch (err) {
      setError(err.message || 'Erro ao alterar papel');
      // reverte o select visualmente recarregando os itens
      load();
    } finally {
      setActionLoading('');
    }
  };

  if (!allowed) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Usuarios</h2>
        <button
          onClick={load}
          className="px-3 py-2 text-sm rounded bg-gray-100 border hover:bg-gray-200 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">CPF</th>
              <th className="px-3 py-2">Papel</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const isOwnAccount = String(u._id) === String(currentUserId);
              const roleLoading = actionLoading === `role-${u._id}`;
              const blockLoading = actionLoading === `block-${u._id}`;
              return (
                <tr key={u._id} className="border-t">
                  <td className="px-3 py-2">{[u.nome, u.sobrenome].filter(Boolean).join(' ') || '-'}</td>
                  <td className="px-3 py-2">{u.email || '-'}</td>
                  <td className="px-3 py-2">{u.cpf || '-'}</td>
                  <td className="px-3 py-2">
                    {canChangeRole && !isOwnAccount ? (
                      <select
                        value={u.systemRole || 'user'}
                        disabled={roleLoading}
                        onChange={(e) => changeRole(u._id, e.target.value)}
                        className={`text-xs font-semibold rounded px-2 py-1 border border-gray-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 ${ROLE_BADGE[u.systemRole] || ROLE_BADGE.user}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`text-xs font-semibold rounded px-2 py-1 ${ROLE_BADGE[u.systemRole] || ROLE_BADGE.user}`}>
                        {ROLES.find((r) => r.value === u.systemRole)?.label || u.systemRole || 'Usuário'}
                        {isOwnAccount && <span className="ml-1 text-gray-400">(você)</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold rounded px-2 py-1 ${u.isBlocked ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {u.isBlocked ? 'Bloqueado' : 'Ativo'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleBlock(u._id, u.isBlocked)}
                      disabled={blockLoading || isOwnAccount}
                      title={isOwnAccount ? 'Voce nao pode bloquear a propria conta' : ''}
                      className={`px-3 py-1 rounded text-sm font-semibold ${
                        u.isBlocked
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : 'bg-red-600 text-white hover:bg-red-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {blockLoading
                        ? 'Atualizando...'
                        : u.isBlocked
                        ? 'Desbloquear'
                        : 'Bloquear'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-gray-600" colSpan={6}>
                  Nenhum usuario encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupsTab({ allowed }) {
  if (!allowed) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Grupos</h2>
      <p className="text-sm text-gray-700">
        Gerencie grupos existentes. Acesse a ferramenta completa em{' '}
        <Link href="/admin/grupos" className="text-blue-600 hover:underline">
          /admin/grupos
        </Link>
        .
      </p>
      <Link
        href="/admin/grupos"
        className="inline-flex px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700"
      >
        Abrir gerenciamento de grupos
      </Link>
    </div>
  );
}

function WithdrawalsTab({ allowed }) {
  if (!allowed) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Saques</h2>
      <p className="text-sm text-gray-700">
        Aprovar ou rejeitar pedidos de saque. Use a interface dedicada em{' '}
        <Link href="/admin/withdrawals" className="text-blue-600 hover:underline">
          /admin/withdrawals
        </Link>
        .
      </p>
      <Link
        href="/admin/withdrawals"
        className="inline-flex px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700"
      >
        Abrir gerenciamento de saques
      </Link>
    </div>
  );
}

function AuditTab({ allowed }) {
  if (!allowed) return null;
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Auditoria</h2>
      <p className="text-sm text-gray-700">Funcionalidade reservada para administradores.</p>
      <p className="text-sm text-gray-500">Endpoint protegido: /api/admin/audit</p>
    </div>
  );
}

export default function AdminPanel() {
  const router = useRouter();
  const { tab = 'users' } = router.query;
  const { data: session, status } = useSession();

  const isAllowed = (roles) => hasRole(session, roles);

  const availableTabs = useMemo(
    () => TABS.filter((t) => isAllowed(t.roles)),
    [session?.user?.systemRole, session?.user?.isBlocked]
  );

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/auth/signin?callbackUrl=${encodeURIComponent('/admin')}`);
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <>
        <Header />
        <main className="pt-[100px] p-6">Carregando sessao...</main>
      </>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <>
        <Header />
        <main className="pt-[100px] p-6">Redirecionando para login...</main>
      </>
    );
  }

  const userRole = session?.user?.systemRole || 'user';
  if (!isAllowed([...PERMISSIONS.USERS_TAB, ...PERMISSIONS.GROUPS_TAB, ...PERMISSIONS.WITHDRAWALS_TAB, ...PERMISSIONS.AUDIT_TAB])) {
    return (
      <>
        <Header />
        <main className="pt-[100px] p-6">
          <div className="max-w-3xl mx-auto bg-white p-6 rounded shadow">
            <h1 className="text-2xl font-bold mb-2">403 - Acesso negado</h1>
            <p className="text-gray-700">Seu perfil ({userRole}) nao tem acesso ao painel administrativo.</p>
          </div>
        </main>
      </>
    );
  }

  const currentTab = availableTabs.find((t) => t.id === tab) ? tab : availableTabs[0]?.id;

  const renderTab = () => {
    switch (currentTab) {
      case 'users':
        return (
          <UsersTab
            allowed={isAllowed(PERMISSIONS.USERS_TAB)}
            canChangeRole={isAllowed(PERMISSIONS.ROLE_CHANGE)}
            currentUserId={session?.user?.id}
          />
        );
      case 'groups':
        return <GroupsTab allowed={isAllowed(PERMISSIONS.GROUPS_TAB)} />;
      case 'withdrawals':
        return <WithdrawalsTab allowed={isAllowed(PERMISSIONS.WITHDRAWALS_TAB)} />;
      case 'audit':
        return <AuditTab allowed={isAllowed(PERMISSIONS.AUDIT_TAB)} />;
      default:
        return <div className="text-gray-700">Selecione uma aba valida.</div>;
    }
  };

  return (
    <>
      <Header admin />
      <main className="pt-[110px] pb-12 px-4">
        <div className="max-w-6xl mx-auto bg-white rounded-xl shadow border border-gray-100 p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-600">Painel administrativo</p>
              <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
            </div>
            <div className="flex gap-2 flex-wrap">
              {availableTabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() =>
                    router.push({ pathname: '/admin', query: { tab: t.id } }, undefined, { shallow: true })
                  }
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
                    currentTab === t.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-50 text-gray-800 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {renderTab()}
        </div>
      </main>
    </>
  );
}
