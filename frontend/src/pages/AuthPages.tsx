import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ErrorAlert } from '../components/common';
import { Logo } from '../components/Logo';
import { homeFor, useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';

interface FromState {
  from?: string;
  expired?: boolean;
}

function useRedirectTarget() {
  const location = useLocation();
  const state = (location.state ?? {}) as FromState;
  return { from: state.from && state.from !== '/dang-nhap' && state.from !== '/dang-ky' ? state.from : null, expired: state.expired ?? false };
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const { from, expired } = useRedirectTarget();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from ?? homeFor(user)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      navigate(from ?? homeFor(u), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container auth-page">
      <form className="card-elevated form auth-card" onSubmit={submit} noValidate>
        <div className="page-header">
          <span className="auth-logo">
            <Logo size={56} />
          </span>
          <h1 style={{ fontSize: 'var(--font-size-h2)' }}>Đăng nhập</h1>
          <p className="muted small">Đăng nhập để đặt lịch, xem lịch hẹn và trò chuyện với trợ lý.</p>
        </div>
        {expired && <p className="alert alert-info">Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.</p>}
        <ErrorAlert message={error} />
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Mật khẩu</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email || !password}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
        <p className="small muted">
          Chưa có tài khoản?{' '}
          <Link to="/dang-ky" state={from ? { from } : undefined}>
            Đăng ký
          </Link>
        </p>
      </form>
    </div>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const { from } = useRedirectTarget();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from ?? homeFor(user)} replace />;

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) {
      setError('Mật khẩu cần ít nhất 8 ký tự.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const u = await register({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      });
      navigate(from ?? homeFor(u), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container auth-page">
      <form className="card-elevated form auth-card" onSubmit={submit} noValidate>
        <div className="page-header">
          <span className="auth-logo">
            <Logo size={56} />
          </span>
          <h1 style={{ fontSize: 'var(--font-size-h2)' }}>Tạo tài khoản</h1>
          <p className="muted small">Tài khoản bệnh nhân để đặt và quản lý lịch khám.</p>
        </div>
        <ErrorAlert message={error} />
        <label className="field">
          <span className="field-label">Họ và tên</span>
          <input className="input" autoComplete="name" required value={form.fullName} onChange={set('fullName')} />
        </label>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </label>
        <label className="field">
          <span className="field-label">Số điện thoại (không bắt buộc)</span>
          <input className="input" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
        </label>
        <label className="field">
          <span className="field-label">Mật khẩu</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={set('password')}
          />
          <span className="field-hint">Tối thiểu 8 ký tự.</span>
        </label>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !form.fullName || !form.email || !form.password}>
          {busy ? 'Đang tạo tài khoản…' : 'Đăng ký'}
        </button>
        <p className="small muted">
          Đã có tài khoản? <Link to="/dang-nhap">Đăng nhập</Link>
        </p>
      </form>
    </div>
  );
}
