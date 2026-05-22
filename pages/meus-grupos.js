import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import Header from '../components/Header';

export default function MeusGrupos() {
  const { data: session, status } = useSession();
  const [grupos, setGrupos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const userId =
    session?.user?.id || session?.user?._id || session?.user?.sub || session?.user?.userId || session?.user?.uid || '';

  useEffect(() => {
    if (status === 'loading') return;
    if (!userId) {
      setCarregando(false);
      setErro('Faca login para ver seus grupos.');
      return;
    }

    const fetchGrupos = async () => {
      try {
        const res = await fetch(`/api/meus-grupos?userId=${encodeURIComponent(userId)}`);
        if (!res.ok) throw new Error('Erro ao carregar grupos');
        const data = await res.json();
        setGrupos(Array.isArray(data) ? data : []);
      } catch (error) {
        setErro('Nao foi possivel carregar seus grupos.');
      } finally {
        setCarregando(false);
      }
    };
    fetchGrupos();
  }, [userId, status]);

  const gruposMembro = useMemo(() => grupos.filter((g) => g.papel === 'membro'), [grupos]);
  const gruposAdmin = useMemo(() => grupos.filter((g) => g.papel === 'admin'), [grupos]);
  const todos = grupos;

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50 text-gray-900 px-4 pb-12 pt-[110px]">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="space-y-2">
            <p className="text-sm uppercase tracking-wide text-blue-700 font-semibold">Minha conta</p>
            <h1 className="text-3xl font-extrabold">Meus grupos</h1>
            <p className="text-gray-600">Aqui estao os grupos onde voce participa ou administra.</p>
          </div>

          {carregando && <p className="text-gray-600">Carregando...</p>}
          {erro && <p className="text-red-600">{erro}</p>}

          {!carregando && !erro && (
            <div className="space-y-10">
              <SecaoGrupos titulo="Todos" descricao="Todos os grupos que voce esta." grupos={todos} />
              <SecaoGrupos titulo="Membros" descricao="Grupos em que voce participa." grupos={gruposMembro} />
              <SecaoGrupos titulo="Administrador" descricao="Grupos administrados por voce." grupos={gruposAdmin} />
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function SecaoGrupos({ titulo, descricao, grupos }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{titulo}</h2>
        <p className="text-sm text-gray-600">{descricao}</p>
      </div>
      {(!grupos || grupos.length === 0) && <p className="text-sm text-gray-500">Nenhum grupo encontrado.</p>}
      {grupos && grupos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {grupos.map((grupo) => {
            const capacidadeBase = grupo.capacidadeTotal ?? grupo.membrosAtivos ?? 0;
            const capacidadeNum = Number(capacidadeBase);
            const membrosNum = Number(grupo.membrosAtivos ?? 0);
            const capacidade = Number.isFinite(capacidadeNum) && capacidadeNum > 0 ? capacidadeNum : membrosNum;
            const vagas = Math.max(capacidade - membrosNum, 0);
            const valorPago = Number(grupo.valorPago || 0);
            const statusPagamento = grupo.pagamentoStatus || 'n/d';

            return (
              <Link
                key={grupo._id || grupo.id}
                href={`/grupos/${grupo._id || grupo.id}`}
                className="bg-white rounded-2xl shadow-md border border-gray-100 p-4 flex gap-3 hover:shadow-lg transition"
              >
                <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center overflow-hidden text-blue-700">
                  {grupo.capa ? (
                    <Image
                      src={grupo.capa}
                      alt={grupo.nome}
                      width={56}
                      height={56}
                      className="w-full h-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <i className="fa fa-users" aria-hidden="true"></i>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-blue-700 font-semibold truncate">{grupo.nome}</p>
                  <p className="text-xs text-gray-600 truncate">{grupo.descricao || 'Grupo de assinatura'}</p>
                  <p className="text-[11px] text-gray-600 mt-1">
                    Pagamento: <span className="font-semibold text-gray-800">{statusPagamento}</span>
                    {valorPago > 0 && ` • R$ ${valorPago.toFixed(2)}`}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-700 mt-2">
                    <i className="fa fa-users text-blue-600" aria-hidden="true"></i>
                    <span>
                      {membrosNum}/{capacidade || 0} membros
                    </span>
                    <span className={`ml-auto px-2 py-1 rounded-full ${vagas > 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                      {vagas > 0 ? `${vagas} vagas` : 'Completo'}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
