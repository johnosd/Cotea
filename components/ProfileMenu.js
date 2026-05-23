import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';

export default function ProfileMenu({ session, isAuthenticated, isLoadingSession }) {
  const [aberto, setAberto] = useState(false);
  const menuRef = useRef(null);
  const botaoRef = useRef(null);

  const userInitial = session?.user?.name?.[0]?.toUpperCase() || 'U';

  const fechar = () => {
    setAberto(false);
    botaoRef.current?.focus();
  };

  const handleSignOut = () => signOut({ callbackUrl: '/' });

  useEffect(() => {
    if (!aberto) return;

    const onClickFora = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && !botaoRef.current?.contains(e.target)) {
        fechar();
      }
    };
    const onEsc = (e) => { if (e.key === 'Escape') fechar(); };

    document.addEventListener('mousedown', onClickFora);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickFora);
      document.removeEventListener('keydown', onEsc);
    };
  }, [aberto]);

  return (
    <div className="relative">
      {isLoadingSession && (
        <div className="hidden sm:block h-10 w-24 rounded bg-gray-800/70 animate-pulse" aria-hidden />
      )}

      <button
        ref={botaoRef}
        onClick={() => setAberto(!aberto)}
        className={`flex items-center gap-3 px-4 py-2 rounded focus:outline-none border border-gray-700 transition ${
          aberto ? 'bg-gray-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-white'
        }`}
        aria-haspopup="true"
        aria-expanded={aberto}
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
          <span className={`absolute left-0 top-0 h-[2px] w-5 bg-current transition ${aberto ? 'rotate-45 translate-y-[7px]' : ''}`} />
          <span className={`absolute left-0 top-1/2 h-[2px] w-5 bg-current transition ${aberto ? 'opacity-0' : ''}`} />
          <span className={`absolute left-0 bottom-0 h-[2px] w-5 bg-current transition ${aberto ? '-rotate-45 -translate-y-[7px]' : ''}`} />
        </span>
        <span className="text-sm font-semibold">{aberto ? 'Fechar' : 'Menu'}</span>
      </button>

      {aberto && (
        <div
          ref={menuRef}
          className="absolute right-0 mt-3 w-64 bg-gray-800 rounded-lg shadow-lg text-white z-[9999] py-2 border border-gray-700"
        >
          {isAuthenticated ? (
            <>
              <div className="px-4 pb-2 text-xs uppercase tracking-wide text-gray-400">Navegacao</div>
              <Link href="/" className="block px-4 py-2 hover:bg-gray-700" onClick={fechar}>Inicio</Link>
              <Link href="/meus-grupos" className="block px-4 py-2 hover:bg-gray-700" onClick={fechar}>Meus grupos</Link>
              <Link href="/wallet" className="block px-4 py-2 hover:bg-gray-700" onClick={fechar}>Minha carteira</Link>
              <Link href="/admin/grupos/novo" className="block px-4 py-2 hover:bg-gray-700" onClick={fechar}>Criar grupo</Link>
              <Link href="/admin" className="block px-4 py-2 hover:bg-gray-700" onClick={fechar}>Painel administrativo</Link>

              <div className="px-4 pt-3 pb-2 text-xs uppercase tracking-wide text-gray-400">Minha conta</div>
              {!session.user?.contaValidada && (
                <Link href="/verificacao" className="block px-4 py-2 hover:bg-gray-700" onClick={fechar}>Verificar conta</Link>
              )}
              <Link href="/perfil" className="block px-4 py-2 hover:bg-gray-700" onClick={fechar}>Meu perfil</Link>
              <button onClick={handleSignOut} className="block px-4 py-2 w-full text-left hover:bg-gray-700">
                Sair
              </button>
            </>
          ) : (
            <Link href="/auth/signin" className="block px-4 py-2 hover:bg-gray-700" onClick={fechar}>Entrar</Link>
          )}
        </div>
      )}
    </div>
  );
}
