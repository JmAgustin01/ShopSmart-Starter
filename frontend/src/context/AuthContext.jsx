// Who is signed in. The session itself lives in an HttpOnly cookie set by the API;
// this context only keeps the public profile (id, name, email) for the page.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.me().then((data) => setUser(data.user)).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  const login = useCallback(async (credentials) => { const data = await api.login(credentials); setUser(data.user); return data.user; }, []);
  const register = useCallback(async (account) => { const data = await api.register(account); setUser(data.user); return data.user; }, []);
  const logout = useCallback(async () => { try { await api.logout(); } finally { setUser(null); } }, []);

  const value = useMemo(() => ({ user, checking, login, register, logout }), [user, checking, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
