import Header from '../../../components/Header';
import Link from 'next/link';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { PERMISSIONS, hasRole } from '../../../lib/authz';

const fetcher = (url) => fetch(url).then((res) => res.json());

export default function GruposAdmin() {
  const { data: session, status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/auth/signin?callbackUrl=${encodeURIComponent('/admin/grupos')}`);
    }
  }, [status, router]);

  const podeVer = hasRole(session, PERMISSIONS.GROUPS_TAB);
  const userId = session?.user?.id || session?.user?._id || session?.user?.sub || session?.user?.userId || '';
  const { data: grupos, error, mutate } = useSWR(
    podeVer && userId ? `/api/meus-grupos?userId=${encodeURIComponent(userId)}` : null,
    fetcher
  );
  const [excluindoId, setExcluindoId] = useState(null);
  const gruposAdmin = useMemo(() => (Array.isArray(grupos) ? grupos.filter((g) => g.papel === 'admin') : []), [grupos]);

  if (status === 'loading') return <div className="pt-[100px] p-6">Carregando sessao...</div>;
  if (status === 'unauthenticated') return <div className="pt-[100px] p-6">Redirecionando para login...</div>;
  if (!podeVer) return <div className="pt-[100px] p-6">403 - Acesso restrito a suporte/admin.</div>;
  if (!userId) return <div className="pt-[100px] p-6">Faca login para ver seus grupos como administrador.</div>;
  if (error) return <div className="pt-[100px] p-6">Falha ao carregar grupos.</div>;
  if (!grupos) return <div className="pt-[100px] p-6">Carregando...</div>;

  async function handleExcluir(id) {
    const confirmar = confirm('Tem certeza que deseja excluir este grupo?');
    if (!confirmar) return;

    setExcluindoId(id);

    try {
      const res = await fetch(`/api/grupos/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao excluir grupo.');

      // Atualiza lista de grupos puxando novamente da API
      await mutate();
    } catch (err) {
      alert('Erro ao excluir grupo.');
    } finally {
      setExcluindoId(null);
    }
  }

  return (
    <>
      <Header admin />
      <main className="pt-[100px] min-h-screen p-6 bg-gray-100">
        <div className="flex justify-between items-center mb-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold">Administracao dos Grupos</h1>
          <Link href="/admin/grupos/novo" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
            + Novo Grupo
          </Link>
        </div>

        <table className="w-full table-auto bg-white rounded shadow max-w-6xl mx-auto">
          <thead>
            <tr className="bg-gray-200">
              <th className="border px-4 py-2">Nome</th>
              <th className="border px-4 py-2">Valor por vaga</th>
              <th className="border px-4 py-2">Capacidade</th>
              <th className="border px-4 py-2">Vagas (disp/reserv.)</th>
              <th className="border px-4 py-2">Status</th>
              <th className="border px-4 py-2">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {gruposAdmin.map((grupo) => {
              const capacidade = Number(grupo.capacidadeTotal) || 0;
              const membrosAtivos = Number(grupo.membrosAtivos) || 0;
              const reservadas = Number(grupo.vagasReservadasAdmin) || 0;
              const vagasDisponiveisCalc = Math.max(capacidade - membrosAtivos, 0);
              const statusDetalhado =
                grupo.statusDetalhado && grupo.statusDetalhado !== 'em_formacao' ? grupo.statusDetalhado : '';
              const grupoCompleto = capacidade > 0 && membrosAtivos >= capacidade;
              const statusLabel = grupoCompleto ? 'Completo' : grupo.status === 'inativo' ? 'Inativo' : 'Ativo';
              const valorPorVagaInformado = Number(grupo.valorPorVaga);
              const valorTotalNumero = Number(grupo.valorTotal);
              const valorPorVaga =
                Number.isFinite(valorPorVagaInformado) && valorPorVagaInformado > 0
                  ? valorPorVagaInformado
                  : Number.isFinite(valorTotalNumero) && capacidade > 0
                  ? valorTotalNumero / capacidade
                  : 0;

              return (
                <tr key={grupo._id}>
                  <td className="border px-4 py-2">{grupo.nome}</td>
                  <td className="border px-4 py-2">R$ {valorPorVaga.toFixed(2)}</td>
                  <td className="border px-4 py-2">{capacidade}</td>
                  <td className="border px-4 py-2">
                    {vagasDisponiveisCalc} / {reservadas}
                  </td>
                  <td className="border px-4 py-2">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        statusLabel === 'Completo'
                          ? 'bg-amber-100 text-amber-700'
                          : grupo.status === 'inativo'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {statusLabel}
                    </span>
                    {statusDetalhado ? <span className="ml-2 text-xs text-gray-600">({statusDetalhado})</span> : null}
                  </td>
                  <td className="border px-4 py-2 text-center space-x-2">
                    <Link href={`/admin/grupos/${grupo._id}`} className="text-blue-600 hover:underline">
                      Editar
                    </Link>
                    <button
                      onClick={() => handleExcluir(grupo._id)}
                      disabled={excluindoId === grupo._id}
                      className="text-red-600 hover:underline disabled:text-red-300"
                    >
                      {excluindoId === grupo._id ? 'Excluindo...' : 'Excluir'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>
    </>
  );
}
