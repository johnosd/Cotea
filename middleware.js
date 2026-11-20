import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const PUBLIC_PATHS = [
  /^\/$/, // home
  /^\/grupos\/[^/]+\/?$/i, // detalhes do grupo
  /^\/api\/grupos(\/.*)?$/i, // APIs de grupos (para listar detalhes)
  /^\/api\/auth(\/.*)?$/i, // NextAuth
  /^\/api\/rotinas\/executar\/?$/i, // agendador externo; protegida por ROTINAS_SECRET na propria rota
  /^\/_next\/.*/i, // assets Next.js
  /^\/favicon\.ico$/i,
  /^\/auth\/signin$/i,
  /^\/auth\/error$/i,
  /^\/verificacao/i, // página de verificação (sempre acessível)
  /^\/cadastro/i,    // cadastro (sempre acessível)
  /^\/imagens\/.*/i,
  /^\/public\/.*/i,
];

// Rotas que exigem conta verificada (além de autenticação)
const VERIFIED_PATHS = [
  /^\/wallet(\/.*)?$/i,
  /^\/meus-grupos/i,
  /^\/assinatura(\/.*)?$/i,
  /^\/admin(\/.*)?$/i,
];

const isPublicPath = (pathname = '') => PUBLIC_PATHS.some((regex) => regex.test(pathname));
const requiresVerified = (pathname = '') => VERIFIED_PATHS.some((regex) => regex.test(pathname));

export async function middleware(req) {
  const { pathname, origin, search } = req.nextUrl;

  // libera caminhos publicos e assets
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const secret = process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET;
  // Em HTTPS o NextAuth grava o cookie como "__Secure-next-auth.session-token".
  // Sem NEXTAUTH_URL, o getToken só usaria esse nome se process.env.VERCEL estiver
  // visível no runtime do middleware — por isso o protocolo é informado explicitamente.
  const token = await getToken({ req, secret, secureCookie: req.nextUrl.protocol === 'https:' });

  if (!token) {
    const callbackUrl = pathname + (search || '');
    const signinUrl = new URL('/auth/signin', origin);
    signinUrl.searchParams.set('callbackUrl', callbackUrl || '/');
    return NextResponse.redirect(signinUrl);
  }

  // Conta autenticada mas não verificada tentando acessar rota sensível
  if (!token.contaValidada && requiresVerified(pathname)) {
    return NextResponse.redirect(new URL('/verificacao', origin));
  }

  return NextResponse.next();
}

// Aplica o middleware em todas as rotas (excecoes tratadas em isPublicPath)
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
