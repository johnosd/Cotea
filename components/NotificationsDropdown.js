import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export default function NotificationsDropdown({ userId }) {
  const [aberto, setAberto] = useState(false);
  const [notificacoes, setNotificacoes] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const dropdownRef = useRef(null);
  const botaoRef = useRef(null);

  const naoLidas = notificacoes.filter((n) => !n.lido).length;

  const carregar = async () => {
    if (!userId) return;
    setCarregando(true);
    try {
      const res = await fetch(`/api/notificacoes?userId=${encodeURIComponent(userId)}&lido=false`);
      if (res.ok) setNotificacoes((await res.json()) || []);
    } catch (err) {
      console.error('Erro ao carregar notificacoes', err);
    }
    setCarregando(false);
  };

  const toggle = () => {
    const proximo = !aberto;
    setAberto(proximo);
    if (proximo) carregar();
  };

  useEffect(() => {
    if (!aberto) return;

    const onClickFora = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        !botaoRef.current?.contains(e.target)
      ) {
        setAberto(false);
      }
    };
    const onEsc = (e) => { if (e.key === 'Escape') setAberto(false); };

    document.addEventListener('mousedown', onClickFora);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickFora);
      document.removeEventListener('keydown', onEsc);
    };
  }, [aberto]);

  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        ref={botaoRef}
        onClick={toggle}
        className="flex items-center justify-center h-10 w-10 rounded-full bg-gray-800 border border-gray-700 hover:bg-gray-700 transition"
        aria-label="Ver notificacoes"
        aria-expanded={aberto}
      >
        <span className="relative">
          <svg
            className="h-5 w-5 text-white"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          {naoLidas > 0 && (
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" aria-hidden />
          )}
        </span>
      </button>

      {aberto && (
        <div
          ref={dropdownRef}
          className="absolute right-0 mt-3 w-80 bg-gray-800 rounded-lg shadow-lg text-white z-[9999] py-2 border border-gray-700"
        >
          <div className="px-4 pb-2 text-xs uppercase tracking-wide text-gray-400 flex justify-between items-center">
            <span>Notificacoes</span>
            {carregando && <span className="text-[10px] text-gray-500">Carregando...</span>}
          </div>
          {notificacoes.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-300">Nenhuma notificacao.</p>
          )}
          {notificacoes.map((notif) => (
            <Link
              key={notif._id || notif.titulo}
              href={notif.acao === 'validar_conta' ? '/verificacao' : '#'}
              className="block px-4 py-3 hover:bg-gray-700"
              onClick={() => setAberto(false)}
            >
              <p className="text-sm font-semibold">{notif.titulo}</p>
              <p className="text-xs text-gray-300 mt-1">{notif.mensagem}</p>
            </Link>
          ))}
          <div className="border-t border-gray-700 mt-2 pt-2">
            <Link
              href="/notificacoes?tab=todas"
              className="block px-4 py-2 text-sm text-blue-200 hover:text-white hover:bg-gray-700 rounded-b-lg"
              onClick={() => setAberto(false)}
            >
              Ver todas as notificacoes
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
