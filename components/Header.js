import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';

export default function Header({ admin = false, valorBusca = '', onBuscar = () => {} }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [notificacoesAberto, setNotificacoesAberto] = useState(false);
  const [notificacoes, setNotificacoes] = useState([]);
  const [carregandoNotificacoes, setCarregandoNotificacoes] = useState(false);
  const { data: session, status } = useSession();
  const menuRef = useRef(null);
  const botaoMenuRef = useRef(null);
  const notifRef = useRef(null);
  const botaoNotifRef = useRef(null);
  const isLoadingSession = status === 'loading';
  const isAuthenticated = status === 'authenticated' && !!session;
  const userInitial = session?.user?.name?.[0]?.toUpperCase() || 'U';

  const handleSignOut = () => {
    signOut({ callbackUrl: '/' });
  };

  const fecharMenu = () => {
    setMenuAberto(false);
    botaoMenuRef.current?.focus();
  };

  useEffect(() => {
    if (!menuAberto) return;

    const handleClickFora = (event) => {
      const clickForaMenu =
        menuRef.current && !menuRef.current.contains(event.target) && !botaoMenuRef.current?.contains(event.target);
      const clickForaNotif =
        notifRef.current && !notifRef.current.contains(event.target) && !botaoNotifRef.current?.contains(event.target);

      if (menuAberto && clickForaMenu) fecharMenu();
      if (notificacoesAberto && clickForaNotif) setNotificacoesAberto(false);
    };

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        fecharMenu();
        setNotificacoesAberto(false);
      }
    };

    document.addEventListener('mousedown', handleClickFora);
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.removeEventListener('mousedown', handleClickFora);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [menuAberto, notificacoesAberto]);

  const carregarNotificacoes = async () => {
    if (!isAuthenticated) return;
    const userId =
      session?.user?.id || session?.user?._id || session?.user?.sub || session?.user?.userId || session?.user?.uid;
    if (!userId) return;
    setCarregandoNotificacoes(true);
    try {
      const res = await fetch(`/api/notificacoes?userId=${encodeURIComponent(userId)}&lido=false`);
      if (res.ok) {
        const data = await res.json();
        setNotificacoes(data || []);
      }
    } catch (err) {
      console.error('Erro ao carregar notificacoes', err);
    }
    setCarregandoNotificacoes(false);
  };

  const toggleNotificacoes = () => {
    const proximo = !notificacoesAberto;
    setNotificacoesAberto(proximo);
    if (proximo) carregarNotificacoes();
  };

  const notificacoesNaoLidas = notificacoes.filter((n) => !n.lido).length;

  return (
    <header
      className={`${
        admin ? 'bg-gray-900' : 'bg-black'
      } text-white px-6 flex items-center h-20 sm:h-24 fixed top-0 left-0 right-0 z-50 shadow-md`}
    >
      <div className="relative w-full max-w-7xl mx-auto flex justify-between items-center h-full">
        <Link href="/">
          <Image
            src="/imagens/logo.png"
            alt="Logo do Site"
            width={354}
            height={99}
            className="object-contain cursor-pointer w-36 sm:w-48 md:w-56 h-auto"
          />
        </Link>

        <form
          className="hidden sm:flex items-center flex-1 max-w-xl mx-6 bg-gray-800 border border-gray-700 rounded-full px-4 py-2"
          role="search"
          onSubmit={(e) => e.preventDefault()}
        >
          <svg
            className="h-4 w-4 text-gray-400 mr-2 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            name="search"
            value={valorBusca}
            onChange={(e) => onBuscar(e.target.value)}
            placeholder="Buscar jogos ou grupos"
            className="bg-transparent w-full placeholder:text-gray-400 focus:outline-none text-sm"
            aria-label="Buscar jogos ou grupos"
          />
        </form>

        <div className="flex items-center gap-3 ml-auto relative">
          {!isLoadingSession && !isAuthenticated && (
            <Link
              href="/auth/signin"
              className="hidden sm:inline-block bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-white transition"
            >
              Entrar
            </Link>
          )}

          <Link
            href="/admin"
            aria-label="Ir para o painel administrativo"
            className="hidden sm:inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded text-white font-semibold transition"
          >
            Painel administrativo
          </Link>

          {isAuthenticated && (
            <Link
              href="/admin/grupos/novo"
              className="hidden sm:inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-white font-semibold transition"
            >
              Criar Grupo
            </Link>
          )}

          {isAuthenticated && (
            <Link
              href="/meus-grupos"
              className="hidden sm:inline-flex items-center gap-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 px-4 py-2 rounded text-white font-semibold transition"
            >
              Meus grupos
            </Link>
          )}

          {isAuthenticated && (
            <Link
              href="/wallet"
              className="hidden sm:inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded text-white font-semibold transition"
            >
              Minha carteira
            </Link>
          )}

          <button
            type="button"
            onClick={toggleNotificacoes}
            ref={botaoNotifRef}
            className="hidden sm:flex items-center justify-center h-10 w-10 rounded-full bg-gray-800 border border-gray-700 hover:bg-gray-700 transition"
            aria-label="Ver notificacoes"
            aria-expanded={notificacoesAberto}
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
              {notificacoesNaoLidas > 0 && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" aria-hidden />
              )}
            </span>
          </button>

          {notificacoesAberto && (
            <div
              ref={notifRef}
              className="absolute right-16 mt-3 w-80 bg-gray-800 rounded-lg shadow-lg text-white z-[9999] py-2 border border-gray-700"
            >
              <div className="px-4 pb-2 text-xs uppercase tracking-wide text-gray-400 flex justify-between items-center">
                <span>Notificacoes</span>
                {carregandoNotificacoes && <span className="text-[10px] text-gray-500">Carregando...</span>}
              </div>
              {(!notificacoes || notificacoes.length === 0) && (
                <p className="px-4 py-3 text-sm text-gray-300">Nenhuma notificacao.</p>
              )}
              {notificacoes?.map((notif) => (
                <Link
                  key={notif._id || notif.titulo}
                  href={notif.acao === 'validar_conta' ? '/verificacao' : '#'}
                  className="block px-4 py-3 hover:bg-gray-700"
                  onClick={() => setNotificacoesAberto(false)}
                >
                  <p className="text-sm font-semibold">{notif.titulo}</p>
                  <p className="text-xs text-gray-300 mt-1">{notif.mensagem}</p>
                </Link>
              ))}
              <div className="notification-dropdown__group__see-all border-t border-gray-700 mt-2 pt-2">
                <Link
                  href="/notificacoes?tab=todas"
                  className="block px-4 py-2 text-sm text-blue-200 hover:text-white hover:bg-gray-700 rounded-b-lg"
                  onClick={() => setNotificacoesAberto(false)}
                >
                  Ver todas as notificacoes
                </Link>
              </div>
            </div>
          )}

          {isLoadingSession && (
            <div className="hidden sm:block h-10 w-24 rounded bg-gray-800/70 animate-pulse" aria-hidden />
          )}

          <button
            onClick={() => setMenuAberto(!menuAberto)}
            ref={botaoMenuRef}
            className={`flex items-center gap-3 px-4 py-2 rounded focus:outline-none border border-gray-700 transition ${
              menuAberto ? 'bg-gray-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-white'
            }`}
            aria-haspopup="true"
            aria-expanded={menuAberto}
            aria-label="Abrir menu principal"
          >
            <div className="h-9 w-9 rounded-full overflow-hidden bg-blue-600 text-white flex items-center justify-center font-semibold text-sm">
              {isAuthenticated && session?.user?.image ? (
                <Image
                  src={session.user.image}
                  alt="Foto do usuario"
                  width={36}
                  height={36}
                  className="h-9 w-9 object-cover"
                />
              ) : (
                userInitial
              )}
            </div>
            <span className="relative block h-4 w-5" aria-hidden>
              <span
                className={`absolute left-0 top-0 h-[2px] w-5 bg-current transition ${
                  menuAberto ? 'rotate-45 translate-y-[7px]' : ''
                }`}
              />
              <span
                className={`absolute left-0 top-1/2 h-[2px] w-5 bg-current transition ${
                  menuAberto ? 'opacity-0' : ''
                }`}
              />
              <span
                className={`absolute left-0 bottom-0 h-[2px] w-5 bg-current transition ${
                  menuAberto ? '-rotate-45 -translate-y-[7px]' : ''
                }`}
              />
            </span>
            <span className="text-sm font-semibold">{menuAberto ? 'Fechar' : 'Menu'}</span>
          </button>

          {menuAberto && (
            <div
              ref={menuRef}
              className="absolute right-0 mt-3 w-64 bg-gray-800 rounded-lg shadow-lg text-white z-[9999] py-2 border border-gray-700"
            >
              {isAuthenticated ? (
                <>
                  <div className="px-4 pb-2 text-xs uppercase tracking-wide text-gray-400">Navegacao</div>
                  <Link
                    href="/"
                    className="block px-4 py-2 hover:bg-gray-700"
                    onClick={fecharMenu}
                  >
                    Inicio
                  </Link>
                  <Link
                    href="/meus-grupos"
                    className="block px-4 py-2 hover:bg-gray-700"
                    onClick={fecharMenu}
                  >
                    Meus grupos
                  </Link>
                  <Link
                    href="/wallet"
                    className="block px-4 py-2 hover:bg-gray-700"
                    onClick={fecharMenu}
                  >
                    Minha carteira
                  </Link>
                  <Link
                    href="/admin/grupos/novo"
                    className="block px-4 py-2 hover:bg-gray-700"
                    onClick={fecharMenu}
                  >
                    Criar grupo
                  </Link>
                  <Link
                    href="/admin"
                    className="block px-4 py-2 hover:bg-gray-700"
                    onClick={fecharMenu}
                  >
                    Painel administrativo
                  </Link>

                  <div className="px-4 pt-3 pb-2 text-xs uppercase tracking-wide text-gray-400">Minha conta</div>
                  {!session.user?.contaValidada && (
                    <Link
                      href="/verificacao"
                      className="block px-4 py-2 hover:bg-gray-700"
                      onClick={fecharMenu}
                    >
                      Verificar conta
                    </Link>
                  )}
                  <Link
                    href="/perfil"
                    className="block px-4 py-2 hover:bg-gray-700"
                    onClick={fecharMenu}
                  >
                    Meu perfil
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="block px-4 py-2 w-full text-left hover:bg-gray-700"
                  >
                    Sair
                  </button>
                </>
              ) : (
                <Link
                  href="/auth/signin"
                  className="block px-4 py-2 hover:bg-gray-700"
                  onClick={fecharMenu}
                >
                  Entrar
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
