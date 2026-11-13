import { useEffect, useRef, type ReactNode } from 'react';
import type { AppointmentStatus } from '../lib/types';

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  CONFIRMED: 'Đã xác nhận',
  COMPLETED: 'Đã khám',
  CANCELLED: 'Đã hủy',
  PENDING: 'Chờ xác nhận',
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

export function statusLabel(status: AppointmentStatus): string {
  return STATUS_LABEL[status];
}

export function Spinner({ label = 'Đang tải' }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="muted small">{label}…</span>
    </span>
  );
}

export function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="alert alert-error" role="alert">
      {message}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Hộp thoại: Esc để đóng, focus vào hộp thoại khi mở. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row-between">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" aria-label="Đóng" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return ((words.at(-2)?.[0] ?? '') + (words.at(-1)?.[0] ?? '')).toUpperCase();
}
