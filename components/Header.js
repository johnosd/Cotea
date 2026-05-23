import Image from 'next/image';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import NotificationsDropdown from './NotificationsDropdown';
import ProfileMenu from './ProfileMenu';

export default function Header({ admin = false, valorBusca = '', onBuscar = () => {} }) {
  const { data: session, status } = useSession();
  const isLoadingSession = status === 'loading';
  const isAuthenticated = status === 'authenticated' && !!session;
  const userId = session?.user?.id;

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

        <div className="flex items-center gap-3 ml-auto">
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

          {isAuthenticated && <NotificationsDropdown userId={userId} />}

          <ProfileMenu
            session={session}
            isAuthenticated={isAuthenticated}
            isLoadingSession={isLoadingSession}
          />
        </div>
      </div>
    </header>
  );
}
