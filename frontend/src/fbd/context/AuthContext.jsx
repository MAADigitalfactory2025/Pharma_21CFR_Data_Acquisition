// AuthContext.jsx — FBD roles derived from the login project's session (ITADMIN -> ADMIN, everyone else -> OPERATOR).
import React, { createContext, useCallback, useContext } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ me, children }) {
  const role = me?.admin ? 'ADMIN' : 'OPERATOR';
  const user = { userId: me?.id || me?.username, name: me?.username, role };
  const canDo = useCallback((action) => {
    switch (action) {
      case 'REVIEW_ALARM':
      case 'QA_DECISION':
        return ['QA', 'ADMIN'].includes(role);
      case 'EDIT_LIMITS':
        return role === 'ADMIN' || (me?.effectivePermissions || me?.permissions || []).some(p => /MACHINE_PARAMETERS.MODIFY_LIMITS$/.test(p));
      case 'PROPOSE_LIMITS':
        return role === 'ADMIN' || (me?.effectivePermissions || me?.permissions || []).some(p => /MACHINE_PARAMETERS.PROPOSE_LIMIT_CHANGE$/.test(p));
      case 'APPROVE_LIMITS':
        return role === 'ADMIN' || (me?.effectivePermissions || me?.permissions || []).some(p => /MACHINE_PARAMETERS.APPROVE_LIMIT_CHANGE$/.test(p));
      case 'CREATE_BATCH':
        return role === 'ADMIN' || (me?.effectivePermissions || me?.permissions || []).some(p => /BATCH_MANAGEMENT.CREATE_BATCH$/.test(p));
      case 'CLOSE_BATCH':
        return role === 'ADMIN' || (me?.effectivePermissions || me?.permissions || []).some(p => /BATCH_MANAGEMENT.CLOSE_BATCH$/.test(p));
      default:
        return true;
    }
  }, [role, me]);
  return <AuthContext.Provider value={{ user, role, me, canDo }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
