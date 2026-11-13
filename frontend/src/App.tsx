import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/common';
import { useAuth } from './context/AuthContext';
import type { Role } from './lib/types';
import { AdminPage } from './pages/AdminPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { BookingPage } from './pages/BookingPage';
import { DoctorsPage } from './pages/DoctorsPage';
import { HomePage } from './pages/HomePage';
import { MyAppointmentsPage } from './pages/MyAppointmentsPage';
import { SchedulePage } from './pages/SchedulePage';

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="container page">
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/dang-nhap" replace state={{ from: location.pathname + location.search }} />;
  if (!roles.includes(user.role)) {
    return (
      <div className="container page">
        <h1>Không có quyền truy cập</h1>
        <p className="muted">Tài khoản của bạn không dùng được trang này.</p>
        <Link to="/">Về trang chủ</Link>
      </div>
    );
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="container page">
      <h1>Không tìm thấy trang</h1>
      <Link to="/">Về trang chủ</Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="dang-nhap" element={<LoginPage />} />
        <Route path="dang-ky" element={<RegisterPage />} />
        <Route path="bac-si" element={<DoctorsPage />} />
        <Route path="dat-lich" element={<BookingPage />} />
        <Route
          path="lich-hen"
          element={
            <RequireRole roles={['PATIENT']}>
              <MyAppointmentsPage />
            </RequireRole>
          }
        />
        <Route
          path="lich-kham"
          element={
            <RequireRole roles={['DOCTOR', 'ADMIN']}>
              <SchedulePage />
            </RequireRole>
          }
        />
        <Route
          path="quan-tri"
          element={
            <RequireRole roles={['ADMIN']}>
              <AdminPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
