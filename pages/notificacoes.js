import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import Header from '../components/Header';

const formatarData = (valor) => {
  if (!valor) return '';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const resumir = (texto, limite = 120) => {
  if (!texto) return '';
  if (texto.length <= limite) return texto;
  return `${texto.slice(0, limite)}...`;
};

function ListaNotificacoes({ titulo, itens, loading, erro, destaque = false, onClickNotificacao }) {
  return (
    <section className="bg-white rounded-2xl shadow-md border border-gray-100 p-4 sm:p-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{titulo}</h2>
        {loading && <span className="text-sm text-gray-500">Carregando...</span>}
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      {!loading && !erro && (!itens || itens.length === 0) && (
        <p className="text-sm text-gray-500">Nenhuma notificacao</p>
      )}
      <div className="space-y-3">
        {itens?.map((n) => {
          const content = (
            <div
              className={`rounded-lg border p-3 flex flex-col gap-1 ${
                destaque ? 'border-blue-200 bg-blue-50/60' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{n.titulo || 'Notificacao'}</p>
                <span className="text-xs text-gray-500 whitespace-nowrap">{formatarData(n.data)}</span>
              </div>
              <p className="text-sm text-gray-700">{resumir(n.mensagem, 120)}</p>
            </div>
          );

          return (
            <button
              key={n._id || `${n.titulo}-${n.data}`}
              type="button"
              onClick={() => onClickNotificacao?.(n)}
              className="w-full text-left"
            >
              {content}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function NotificacoesPage() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id || session?.user?._id || session?.user?.sub || '';
  const [naoLidas, setNaoLidas] = useState([]);
  const [lidas, setLidas] = useState([]);
  const [loadingNL, setLoadingNL] = useState(false);
  const [loadingL, setLoadingL] = useState(false);
  const [erroNL, setErroNL] = useState('');
  const [erroL, setErroL] = useState('');

  const carregou = useMemo(() => status !== 'loading', [status]);

  useEffect(() => {
    if (!userId) return;
    const fetchNotifs = async () => {
      setLoadingNL(true);
      setLoadingL(true);
      setErroNL('');
      setErroL('');
      try {
        const [resNL, resL] = await Promise.all([
          fetch(`/api/notificacoes?userId=${encodeURIComponent(userId)}&lido=false`),
          fetch(`/api/notificacoes?userId=${encodeURIComponent(userId)}&lido=true`),
        ]);
        const dataNL = await resNL.json().catch(() => []);
        const dataL = await resL.json().catch(() => []);
        if (!resNL.ok) throw new Error(dataNL?.message || 'Erro ao carregar nao lidas');
        if (!resL.ok) throw new Error(dataL?.message || 'Erro ao carregar lidas');
        setNaoLidas(Array.isArray(dataNL) ? dataNL : []);
        setLidas(Array.isArray(dataL) ? dataL : []);
      } catch (err) {
        const msg = err?.message || 'Erro ao carregar notificacoes';
        setErroNL(msg);
        setErroL(msg);
      } finally {
        setLoadingNL(false);
        setLoadingL(false);
      }
    };
    fetchNotifs();
  }, [userId]);

  const marcarComoLida = async (notif) => {
    if (!notif || notif.lido || !userId || !notif._id) return;
    try {
      await fetch('/api/notificacoes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, notificacaoId: notif._id }),
      });
      setNaoLidas((prev) => prev.filter((n) => n._id !== notif._id));
      setLidas((prev) => [{ ...notif, lido: true, dataLido: new Date().toISOString() }, ...prev]);
    } catch (err) {
      // silencioso
    }
  };

  const handleClickNotif = async (notif) => {
    await marcarComoLida(notif);
  };

  if (status === 'loading') {
    return (
      <>
        <Header />
        <main className="pt-[110px] min-h-screen bg-gray-50 px-4">
          <div className="max-w-5xl mx-auto text-gray-600">Carregando sessao...</div>
        </main>
      </>
    );
  }

  if (status === 'unauthenticated' || !userId) {
    return (
      <>
        <Header />
        <main className="pt-[110px] min-h-screen bg-gray-50 px-4">
          <div className="max-w-5xl mx-auto text-gray-600">
            Voce precisa estar logado para ver suas notificacoes.
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="pt-[110px] min-h-screen bg-gray-50 px-4 pb-10">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Central</p>
              <h1 className="text-2xl font-bold text-gray-900">Notificacoes</h1>
              <p className="text-gray-600 text-sm">Mensagens do sistema, grupos e validacao de conta.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ListaNotificacoes
              titulo="Nao lidas"
              itens={naoLidas}
              loading={loadingNL}
              erro={erroNL}
              destaque
              onClickNotificacao={handleClickNotif}
            />
            <ListaNotificacoes
              titulo="Lidas"
              itens={lidas}
              loading={loadingL}
              erro={erroL}
              onClickNotificacao={handleClickNotif}
            />
          </div>
        </div>
      </main>
    </>
  );
}
