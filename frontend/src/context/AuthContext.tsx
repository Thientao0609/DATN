import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api, getToken, onUnauthorized, setToken } from '../lib/api';
import type { AuthResponse, User } from '../lib/types';

interface AuthState {
  user: User | null;
  /** Đang kiểm tra token đã lưu khi mở trang. */
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { email: string; password: string; fullName: string; phone?: string }) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => getToken() !== null);
  const navigate = useNavigate();
  const location = useLocation();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  // Gặp 401 khi đang đăng nhập: đăng xuất và về trang đăng nhập.
  useEffect(() => {
    onUnauthorized(() => {
      setToken(null);
      setUser(null);
      navigate('/dang-nhap', { replace: true, state: { from: location.pathname, expired: true } });
    });
    return () => onUnauthorized(null);
  }, [navigate, location.pathname]);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    api
      .get<{ user: User }>('/auth/me')
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) {
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<AuthResponse>('/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (input: { email: string; password: string; fullName: string; phone?: string }) => {
    const res = await api.post<AuthResponse>('/auth/register', input);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải dùng bên trong AuthProvider');
  return ctx;
}

/** Trang chủ theo vai trò sau khi đăng nhập. */
export function homeFor(user: User): string {
  if (user.role === 'ADMIN') return '/quan-tri';
  if (user.role === 'DOCTOR') return '/lich-kham';
  return '/lich-hen';
}
