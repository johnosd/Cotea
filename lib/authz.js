const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const getUserRole = (session) => session?.user?.systemRole || 'user';

export const isUserBlocked = (session) => Boolean(session?.user?.isBlocked);

export const PERMISSIONS = {
  USERS_TAB: ['support', 'admin'],
  GROUPS_TAB: ['support', 'admin'],
  WITHDRAWALS_TAB: ['finance', 'admin'],
  AUDIT_TAB: ['admin'],
  ROLE_CHANGE: ['admin'],
};

export const isAccountVerified = (session) => Boolean(session?.user?.contaValidada);

// Retorna { status, error } se a sessão não satisfaz os requisitos; null se OK
export const requireVerifiedSession = (session) => {
  if (!session?.user) return { status: 401, error: 'Nao autenticado' };
  if (isUserBlocked(session)) return { status: 403, error: 'Conta bloqueada' };
  if (!isAccountVerified(session)) return { status: 403, error: 'Conta nao verificada. Confirme seu e-mail antes de continuar.' };
  return null;
};

export const hasRole = (session, allowedRoles = []) => {
  if (!session?.user) return false;
  if (isUserBlocked(session)) return false;

  const role = getUserRole(session);
  if (allowedRoles.includes(role)) return true;

  // Fallback por email para administradores antigos
  const email = (session.user.email || '').toLowerCase();
  const adminEmails = parseAdminEmails();
  if (allowedRoles.includes('admin') && adminEmails.includes(email)) return true;

  return false;
};
