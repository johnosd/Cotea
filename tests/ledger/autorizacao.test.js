// Permissão das visões do financeiro (002-ledger-segmentado, T028 · D-12, US3-AC3).
import { describe, it, expect } from 'vitest';
import { PERMISSIONS, hasRole } from '../../lib/authz.js';

const sessao = (systemRole, extras = {}) => ({ user: { email: `${systemRole}@exemplo.test`, systemRole, ...extras } });

describe('PERMISSIONS.LEDGER_FINANCEIRO', () => {
  it('aceita finance e admin', () => {
    expect(hasRole(sessao('finance'), PERMISSIONS.LEDGER_FINANCEIRO)).toBe(true);
    expect(hasRole(sessao('admin'), PERMISSIONS.LEDGER_FINANCEIRO)).toBe(true);
  });

  it('recusa support, user, sem sessão e conta bloqueada', () => {
    expect(hasRole(sessao('support'), PERMISSIONS.LEDGER_FINANCEIRO)).toBe(false);
    expect(hasRole(sessao('user'), PERMISSIONS.LEDGER_FINANCEIRO)).toBe(false);
    expect(hasRole(null, PERMISSIONS.LEDGER_FINANCEIRO)).toBe(false);
    expect(hasRole(sessao('admin', { isBlocked: true }), PERMISSIONS.LEDGER_FINANCEIRO)).toBe(false);
  });
});
