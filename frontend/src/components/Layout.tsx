import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../lib/types';
import { BrandMark, Icon } from './Icon';
import { ChatWidget } from './chat/ChatWidget';

export const CLINIC = {
  name: 'Phòng khám Đa khoa An Tâm',
  shortName: 'An Tâm',
  hotline: '1900 0000',
  hotlineTel: '19000000',
  address: 'Số 123 đường Lê Lợi, phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
  hours: ['Thứ 2 – Thứ 7', 'Sáng 08:00 – 11:30', 'Chiều 13:30 – 17:00'],
};

function linksFor(role: Role | null): { to: string; label: string }[] {
  const publicLinks = [
    { to: '/bac-si', label: 'Bác sĩ' },
    { to: '/dat-lich', label: 'Đặt lịch khám' },
  ];
  if (role === 'PATIENT') return [...publicLinks, { to: '/lich-hen', label: 'Lịch hẹn của tôi' }];
  if (role === 'DOCTOR') return [{ to: '/lich-kham', label: 'Lịch khám' }];
  if (role === 'ADMIN') return [{ to: '/lich-kham', label: 'Lịch khám' }, { to: '/quan-tri', label: 'Quản trị' }];
  return publicLinks;
}

function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const links = linksFor(user?.role ?? null);

  const doLogout = () => {
    logout();
    setOpen(false);
    navigate('/');
  };

  return (
    <header className="nav">
      <div className="container">
        <div className="nav-inner">
          <Link to="/" className="brand" aria-label={`${CLINIC.name} – Trang chủ`}>
            <BrandMark />
            <span>{CLINIC.shortName}</span>
          </Link>
          <nav className="nav-links" aria-label="Điều hướng chính">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="nav-actions">
            {user ? (
              <>
                <span className="nav-user" title={user.fullName}>
                  {user.fullName}
                </span>
                <button type="button" className="btn btn-sm" onClick={doLogout}>
                  Đăng xuất
                </button>
              </>
            ) : (
              <Link to="/dang-nhap" className="btn btn-sm">
                Đăng nhập
              </Link>
            )}
            <button
              type="button"
              className="icon-btn nav-toggle"
              aria-label={open ? 'Đóng menu' : 'Mở menu'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name={open ? 'close' : 'menu'} />
            </button>
          </div>
        </div>
        {open && (
          <nav className="nav-drawer" aria-label="Menu">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <h3>{CLINIC.name}</h3>
          <p>{CLINIC.address}</p>
        </div>
        <div>
          <h3>Giờ khám bệnh</h3>
          {CLINIC.hours.map((h) => (
            <p key={h}>{h}</p>
          ))}
          <p>Đặt lịch online 24/7</p>
        </div>
        <div>
          <h3>Liên hệ</h3>
          <p>
            Hotline <a href={`tel:${CLINIC.hotlineTel}`}>{CLINIC.hotline}</a>
          </p>
          <p>Cấp cứu: gọi 115</p>
        </div>
      </div>
      <div className="container">
        <p className="caption" style={{ marginTop: 'var(--space-3)' }}>
          © {new Date().getFullYear()} {CLINIC.name}
        </p>
      </div>
    </footer>
  );
}

export function Layout() {
  return (
    <div className="app">
      <a href="#main" className="sr-only">
        Bỏ qua điều hướng
      </a>
      <NavBar />
      <main id="main" className="app-main">
        <Outlet />
      </main>
      <Footer />
      <ChatWidget />
    </div>
  );
}
