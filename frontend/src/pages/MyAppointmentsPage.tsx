import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { DateChips, SlotGrid } from '../components/SlotPicker';
import { Empty, ErrorAlert, Modal, Spinner, StatusBadge } from '../components/common';
import { useApp } from '../context/AppContext';
import { ApiError, api, errorMessage } from '../lib/api';
import { formatDateTime, formatMoney, todayVn, vnDate } from '../lib/time';
import type { Appointment, Slot } from '../lib/types';
import { useAsync } from '../lib/useAsync';

type Tab = 'upcoming' | 'past' | 'cancelled';
const TABS: { id: Tab; label: string }[] = [
  { id: 'upcoming', label: 'Sắp tới' },
  { id: 'past', label: 'Đã khám / đã qua' },
  { id: 'cancelled', label: 'Đã hủy' },
];
const CHANGE_LIMIT_MS = 2 * 60 * 60 * 1000;

function canChange(a: Appointment): boolean {
  return a.status === 'CONFIRMED' && new Date(a.startTime).getTime() - Date.now() >= CHANGE_LIMIT_MS;
}

function RescheduleDialog({ appointment, onClose, onDone }: { appointment: Appointment; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState(() => {
    const d = vnDate(appointment.startTime);
    return d >= todayVn() ? d : todayVn();
  });
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSlot = useCallback((s: Slot | null) => setSlot(s), []);

  const save = async () => {
    if (!slot) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/appointments/${appointment.id}/reschedule`, { startTime: slot.startTime });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'SLOT_TAKEN') {
        setSlot(null);
        setReloadKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Đổi lịch khám" onClose={onClose}>
      <p className="small muted">
        Bác sĩ {appointment.doctor.fullName} · Lịch hiện tại {formatDateTime(appointment.startTime)}
      </p>
      <DateChips
        value={date}
        onChange={(d) => {
          setDate(d);
          setSlot(null);
        }}
      />
      <SlotGrid doctorId={appointment.doctor.id} date={date} value={slot?.startTime ?? null} onChange={onSlot} reloadKey={reloadKey} />
      <ErrorAlert message={error} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Đóng
        </button>
        <button type="button" className="btn btn-primary" disabled={!slot || busy} onClick={save}>
          {busy ? 'Đang đổi…' : slot ? `Đổi sang ${slot.time}` : 'Chọn giờ mới'}
        </button>
      </div>
    </Modal>
  );
}

function CancelDialog({ appointment, onClose, onDone }: { appointment: Appointment; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/appointments/${appointment.id}/cancel`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Hủy lịch khám?" onClose={onClose}>
      <p>
        Lịch với bác sĩ {appointment.doctor.fullName} lúc {formatDateTime(appointment.startTime)} sẽ bị hủy và khung giờ được mở lại cho người khác.
      </p>
      <ErrorAlert message={error} />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Giữ lịch
        </button>
        <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={confirm}>
          {busy ? 'Đang hủy…' : 'Hủy lịch'}
        </button>
      </div>
    </Modal>
  );
}

export function MyAppointmentsPage() {
  const { appointmentsVersion, notifyAppointmentsChanged } = useApp();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  // Tải lại mỗi khi lịch hẹn thay đổi, kể cả khi đặt qua chat.
  const list = useAsync((signal) => api.get<{ appointments: Appointment[] }>('/appointments/me', undefined, signal), [appointmentsVersion]);

  const groups = useMemo(() => {
    const all = list.data?.appointments ?? [];
    const now = Date.now();
    const upcoming = all.filter((a) => a.status === 'CONFIRMED' && new Date(a.endTime).getTime() > now);
    upcoming.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return {
      upcoming,
      past: all.filter((a) => a.status === 'COMPLETED' || (a.status === 'CONFIRMED' && new Date(a.endTime).getTime() <= now)),
      cancelled: all.filter((a) => a.status === 'CANCELLED'),
    } satisfies Record<Tab, Appointment[]>;
  }, [list.data]);

  const done = () => {
    setRescheduling(null);
    setCancelling(null);
    notifyAppointmentsChanged();
  };

  const items = groups[tab];

  return (
    <div className="container page">
      <div className="row-between">
        <div className="page-header">
          <h1>Lịch hẹn của tôi</h1>
          <p className="muted">Đổi hoặc hủy lịch trước giờ khám ít nhất 2 giờ.</p>
        </div>
        <Link to="/dat-lich" className="btn btn-primary">
          Đặt lịch mới
        </Link>
      </div>

      <div className="segmented" role="tablist" aria-label="Lọc lịch hẹn">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label} ({groups[t.id].length})
          </button>
        ))}
      </div>

      {list.loading && !list.data && <Spinner />}
      <ErrorAlert message={list.error} />

      {list.data && items.length === 0 && (
        <Empty>{tab === 'upcoming' ? 'Bạn chưa có lịch hẹn sắp tới.' : 'Không có lịch hẹn nào.'}</Empty>
      )}

      <div className="stack">
        {items.map((a) => (
          <article key={a.id} className="card appt-card">
            <div className="stack" style={{ gap: 'var(--space-1)' }}>
              <div className="row">
                <StatusBadge status={a.status} />
                {a.createdVia === 'CHATBOT' && <span className="badge badge-neutral">Đặt qua trợ lý</span>}
              </div>
              <h3>{formatDateTime(a.startTime)}</h3>
              <p className="small">
                Bác sĩ {a.doctor.fullName} · {a.doctor.specialty.name} · {formatMoney(a.doctor.fee)}
              </p>
              <p className="small muted">Lý do khám: {a.reason}</p>
            </div>
            {a.status === 'CONFIRMED' && (
              <div className="row appt-actions">
                {canChange(a) ? (
                  <>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setRescheduling(a)}>
                      Đổi lịch
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => setCancelling(a)}>
                      Hủy lịch
                    </button>
                  </>
                ) : (
                  <span className="caption">Còn dưới 2 giờ nên không đổi/hủy được</span>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      {rescheduling && <RescheduleDialog appointment={rescheduling} onClose={() => setRescheduling(null)} onDone={done} />}
      {cancelling && <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} onDone={done} />}
    </div>
  );
}
